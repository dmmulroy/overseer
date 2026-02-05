use crate::backend::{Diff, VcsBackend, VcsError, VcsType};
use gix::bstr::ByteSlice;
use gix::diff::blob::intern::InternedInput;
use gix::diff::blob::sink::Counter;
use gix::diff::blob::sources::lines_with_terminator;
use gix::diff::blob::{Algorithm, UnifiedDiffBuilder};
use gix::object::tree::EntryKind as ObjectEntryKind;
use gix::objs::tree::{EntryKind as TreeEntryKind, EntryMode};
use gix::progress::Discard;
use gix::refs::transaction::{Change, LogChange, PreviousValue, RefEdit, RefLog};
use gix::refs::Target;
use gix::ObjectId;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

pub struct GitBackend;

impl VcsBackend for GitBackend {
    fn detect(repo_path: &Path) -> Result<VcsType, VcsError> {
        if repo_path.join(".git").exists() {
            Ok(VcsType::Git)
        } else {
            Err(VcsError::RepoNotFound)
        }
    }

    fn ensure_clean(repo_path: &Path) -> Result<(), VcsError> {
        let repo = open_repo(repo_path)?;
        let dirty = repo
            .status(Discard)
            .map_err(map_backend_error("status"))?
            .index_worktree_rewrites(None)
            .index_worktree_submodules(gix::status::Submodule::AsConfigured { check_dirty: true })
            .into_index_worktree_iter(Vec::new())
            .map_err(map_backend_error("status iter"))?
            .take_while(Result::is_ok)
            .next()
            .is_some();
        if dirty {
            return Err(VcsError::DirtyWorkingCopy);
        }
        Ok(())
    }

    fn head_commit(repo_path: &Path) -> Result<String, VcsError> {
        let repo = open_repo(repo_path)?;
        let commit = repo
            .head_commit()
            .map_err(map_backend_error("head commit"))?;
        Ok(commit.id().to_string())
    }

    fn create_ref(repo_path: &Path, name: &str) -> Result<String, VcsError> {
        let repo = open_repo(repo_path)?;
        let full_ref = ref_full_name(name);
        if repo.find_reference(&full_ref).is_ok() {
            return Err(VcsError::RefAlreadyExists {
                name: name.to_string(),
            });
        }
        let head = repo
            .head_commit()
            .map_err(map_backend_error("head commit"))?;
        repo.reference(
            full_ref,
            head.id(),
            PreviousValue::MustNotExist,
            "task start",
        )
        .map_err(map_backend_error("create ref"))?;
        Ok(name.to_string())
    }

    fn checkout_ref(repo_path: &Path, name: &str) -> Result<(), VcsError> {
        let repo = open_repo(repo_path)?;
        let full_ref = ref_full_name(name);
        let mut reference = repo
            .find_reference(&full_ref)
            .map_err(|_| VcsError::RefNotFound {
                name: name.to_string(),
            })?;
        let target = reference
            .peel_to_id()
            .map_err(map_backend_error("peel ref"))?;

        let head_name: gix::refs::FullName =
            "HEAD".try_into().map_err(map_backend_error("head name"))?;
        let branch_name: gix::refs::FullName = full_ref
            .try_into()
            .map_err(map_backend_error("branch name"))?;
        repo.edit_reference(RefEdit {
            change: Change::Update {
                log: LogChange {
                    mode: RefLog::AndReference,
                    force_create_reflog: false,
                    message: "checkout".into(),
                },
                expected: PreviousValue::Any,
                new: Target::Symbolic(branch_name),
            },
            name: head_name,
            deref: false,
        })
        .map_err(map_backend_error("update HEAD"))?;

        let workdir = repo.workdir().ok_or_else(|| VcsError::BackendError {
            reason: "bare repository".to_string(),
        })?;
        let tree_id = target
            .object()
            .map_err(map_backend_error("load target object"))?
            .peel_to_tree()
            .map_err(map_backend_error("peel tree"))?
            .id;
        let mut index = repo
            .index_from_tree(&tree_id)
            .map_err(map_backend_error("index from tree"))?;
        let options = repo
            .checkout_options(gix::worktree::stack::state::attributes::Source::IdMapping)
            .map_err(map_backend_error("checkout options"))?;
        let progress = Discard;
        let should_interrupt = AtomicBool::new(false);
        gix::worktree::state::checkout(
            &mut index,
            workdir,
            repo.objects
                .clone()
                .into_arc()
                .map_err(map_backend_error("odb"))?,
            &progress,
            &progress,
            &should_interrupt,
            options,
        )
        .map_err(map_backend_error("checkout"))?;
        index
            .write(Default::default())
            .map_err(map_backend_error("write index"))?;
        Ok(())
    }

    fn commit_all(repo_path: &Path, message: &str) -> Result<String, VcsError> {
        let repo = open_repo(repo_path)?;
        let workdir = repo.workdir().ok_or_else(|| VcsError::BackendError {
            reason: "bare repository".to_string(),
        })?;
        let mut editor = repo
            .edit_tree(ObjectId::empty_tree(repo.object_hash()))
            .map_err(map_backend_error("edit tree"))?;
        let mut paths = Vec::new();
        collect_paths(workdir, &mut paths).map_err(map_backend_error("scan workdir"))?;
        for path in paths {
            let rel = path
                .strip_prefix(workdir)
                .map_err(map_backend_error("path prefix"))?;
            let rel_str = rel.to_str().ok_or_else(|| VcsError::BackendError {
                reason: "non-utf8 path".to_string(),
            })?;
            let data = std::fs::read(&path).map_err(map_backend_error("read file"))?;
            let blob_id = repo
                .write_blob(&data)
                .map_err(map_backend_error("write blob"))?;
            let is_exec = is_executable(&path)?;
            let kind = if is_exec {
                ObjectEntryKind::BlobExecutable
            } else {
                ObjectEntryKind::Blob
            };
            editor
                .upsert(rel_str, kind, blob_id.detach())
                .map_err(map_backend_error("update tree"))?;
        }
        let tree_id = editor
            .write()
            .map_err(map_backend_error("write tree"))?
            .detach();

        let parent = repo
            .head_commit()
            .map_err(map_backend_error("head commit"))?;
        let commit_id = repo
            .commit("HEAD", message, tree_id, [parent.id()])
            .map_err(map_backend_error("commit"))?;
        Ok(commit_id.to_string())
    }

    fn diff_range(repo_path: &Path, base: &str, head: &str) -> Result<Diff, VcsError> {
        let repo = open_repo(repo_path)?;
        let base_id =
            gix::ObjectId::from_hex(base.as_bytes()).map_err(map_backend_error("base id"))?;
        let head_id =
            gix::ObjectId::from_hex(head.as_bytes()).map_err(map_backend_error("head id"))?;
        let base_commit = repo
            .find_commit(base_id)
            .map_err(map_backend_error("load base commit"))?;
        let head_commit = repo
            .find_commit(head_id)
            .map_err(map_backend_error("load head commit"))?;
        let base_tree = base_commit.tree().map_err(map_backend_error("base tree"))?;
        let head_tree = head_commit.tree().map_err(map_backend_error("head tree"))?;

        let changes = repo
            .diff_tree_to_tree(&base_tree, &head_tree, None)
            .map_err(map_backend_error("tree diff"))?;
        let mut output = String::new();
        for change in changes {
            match change {
                gix::object::tree::diff::ChangeDetached::Addition {
                    location,
                    entry_mode,
                    id,
                    ..
                } => {
                    if !is_blob_entry(entry_mode) {
                        continue;
                    }
                    let path = location.to_str_lossy();
                    let new_text = blob_text(&repo, id)?;
                    append_unified_diff(&mut output, &path, &path, None, Some(new_text.as_str()))?;
                }
                gix::object::tree::diff::ChangeDetached::Deletion {
                    location,
                    entry_mode,
                    id,
                    ..
                } => {
                    if !is_blob_entry(entry_mode) {
                        continue;
                    }
                    let path = location.to_str_lossy();
                    let old_text = blob_text(&repo, id)?;
                    append_unified_diff(&mut output, &path, &path, Some(old_text.as_str()), None)?;
                }
                gix::object::tree::diff::ChangeDetached::Modification {
                    location,
                    previous_entry_mode,
                    entry_mode,
                    previous_id,
                    id,
                    ..
                } => {
                    if !is_blob_entry(entry_mode) || !is_blob_entry(previous_entry_mode) {
                        continue;
                    }
                    let path = location.to_str_lossy();
                    let old_text = blob_text(&repo, previous_id)?;
                    let new_text = blob_text(&repo, id)?;
                    append_unified_diff(
                        &mut output,
                        &path,
                        &path,
                        Some(old_text.as_str()),
                        Some(new_text.as_str()),
                    )?;
                }
                gix::object::tree::diff::ChangeDetached::Rewrite {
                    source_location,
                    location,
                    source_entry_mode,
                    entry_mode,
                    source_id,
                    id,
                    ..
                } => {
                    if !is_blob_entry(entry_mode) || !is_blob_entry(source_entry_mode) {
                        continue;
                    }
                    let old_path = source_location.to_str_lossy();
                    let new_path = location.to_str_lossy();
                    let old_text = blob_text(&repo, source_id)?;
                    let new_text = blob_text(&repo, id)?;
                    append_unified_diff(
                        &mut output,
                        &old_path,
                        &new_path,
                        Some(old_text.as_str()),
                        Some(new_text.as_str()),
                    )?;
                }
            }
        }

        Ok(Diff {
            base: base.to_string(),
            head: head.to_string(),
            unified: output,
        })
    }

    fn delete_ref(repo_path: &Path, name: &str) -> Result<(), VcsError> {
        let repo = open_repo(repo_path)?;
        let full_ref = ref_full_name(name);
        let reference = repo
            .find_reference(&full_ref)
            .map_err(|_| VcsError::RefNotFound {
                name: name.to_string(),
            })?;
        reference
            .delete()
            .map_err(map_backend_error("delete ref"))?;
        Ok(())
    }
}

fn open_repo(repo_path: &Path) -> Result<gix::Repository, VcsError> {
    gix::open(repo_path).map_err(|_| VcsError::RepoNotFound)
}

fn ref_full_name(name: &str) -> String {
    format!("refs/heads/{name}")
}

fn map_backend_error<E: std::fmt::Display>(context: &'static str) -> impl FnOnce(E) -> VcsError {
    move |err| VcsError::BackendError {
        reason: format!("{context}: {err}"),
    }
}

fn is_blob_entry(mode: EntryMode) -> bool {
    matches!(
        TreeEntryKind::from(mode),
        TreeEntryKind::Blob | TreeEntryKind::BlobExecutable
    )
}

fn blob_text(repo: &gix::Repository, id: ObjectId) -> Result<String, VcsError> {
    let blob = repo.find_blob(id).map_err(map_backend_error("load blob"))?;
    Ok(String::from_utf8_lossy(&blob.data).to_string())
}

fn append_unified_diff(
    output: &mut String,
    old_path: &str,
    new_path: &str,
    old_text: Option<&str>,
    new_text: Option<&str>,
) -> Result<(), VcsError> {
    writeln!(output, "diff --git a/{old_path} b/{new_path}")
        .map_err(map_backend_error("write diff"))?;
    let left_header = if old_text.is_some() {
        format!("a/{old_path}")
    } else {
        "/dev/null".to_string()
    };
    let right_header = if new_text.is_some() {
        format!("b/{new_path}")
    } else {
        "/dev/null".to_string()
    };
    writeln!(output, "--- {left_header}").map_err(map_backend_error("write diff"))?;
    writeln!(output, "+++ {right_header}").map_err(map_backend_error("write diff"))?;

    let diff = diff_text(old_text, new_text);
    if !diff.wrapped.is_empty() {
        output.push_str(diff.wrapped.as_str());
        if !output.ends_with('\n') {
            output.push('\n');
        }
    }
    Ok(())
}

fn diff_text(old_text: Option<&str>, new_text: Option<&str>) -> Counter<String> {
    let input = InternedInput::new(
        lines_with_terminator(old_text.unwrap_or_default()),
        lines_with_terminator(new_text.unwrap_or_default()),
    );
    gix::diff::blob::diff(
        Algorithm::Histogram,
        &input,
        Counter::new(UnifiedDiffBuilder::new(&input)),
    )
}

fn collect_paths(root: &Path, out: &mut Vec<PathBuf>) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            collect_paths(&path, out)?;
        } else if metadata.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn is_executable(path: &Path) -> Result<bool, VcsError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let metadata = std::fs::metadata(path).map_err(map_backend_error("metadata"))?;
        Ok(metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(false)
    }
}
