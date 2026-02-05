use crate::backend::{Diff, VcsBackend, VcsError, VcsType};
use bstr::BStr;
use futures::StreamExt as _;
use jj_lib::config::StackedConfig;
use jj_lib::conflicts::{ConflictMarkerStyle, ConflictMaterializeOptions};
use jj_lib::copies::CopyRecords;
use jj_lib::diff_presentation::unified::{git_diff_part, unified_diff_hunks, DiffLineType};
use jj_lib::diff_presentation::LineCompareMode;
use jj_lib::gitignore::GitIgnoreFile;
use jj_lib::matchers::{EverythingMatcher, NothingMatcher};
use jj_lib::merge::Diff as JjDiff;
use jj_lib::object_id::ObjectId as _;
use jj_lib::op_store::RefTarget;
use jj_lib::ref_name::RefName;
use jj_lib::repo::{Repo, StoreFactories};
use jj_lib::settings::UserSettings;
use jj_lib::working_copy::SnapshotOptions;
use jj_lib::workspace::{default_working_copy_factories, Workspace};
use pollster::FutureExt as _;
use std::fmt::Write as _;
use std::path::Path;

pub struct JjBackend;

impl VcsBackend for JjBackend {
    fn detect(repo_path: &Path) -> Result<VcsType, VcsError> {
        if repo_path.join(".jj").exists() {
            Ok(VcsType::Jj)
        } else {
            Err(VcsError::RepoNotFound)
        }
    }

    fn ensure_clean(repo_path: &Path) -> Result<(), VcsError> {
        let (mut workspace, repo) = load_workspace_repo(repo_path)?;
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(workspace.workspace_name())
            .ok_or_else(|| VcsError::BackendError {
                reason: "missing working copy commit".to_string(),
            })?
            .clone();
        let wc_commit = repo
            .store()
            .get_commit(&wc_commit_id)
            .map_err(map_backend_error("load working copy commit"))?;

        let snapshot_options = SnapshotOptions {
            base_ignores: GitIgnoreFile::empty(),
            progress: None,
            start_tracking_matcher: &EverythingMatcher,
            force_tracking_matcher: &NothingMatcher,
            max_new_file_size: u64::MAX,
        };
        let mut locked = workspace
            .start_working_copy_mutation()
            .map_err(map_backend_error("lock working copy"))?;
        let (tree, stats) = locked
            .locked_wc()
            .snapshot(&snapshot_options)
            .block_on()
            .map_err(map_backend_error("snapshot working copy"))?;
        locked
            .finish(repo.op_id().clone())
            .map_err(map_backend_error("finish working copy"))?;

        if !stats.untracked_paths.is_empty() {
            return Err(VcsError::DirtyWorkingCopy);
        }

        if tree.tree_ids_and_labels() != wc_commit.tree().tree_ids_and_labels() {
            return Err(VcsError::DirtyWorkingCopy);
        }

        Ok(())
    }

    fn head_commit(repo_path: &Path) -> Result<String, VcsError> {
        let (workspace, repo) = load_workspace_repo(repo_path)?;
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(workspace.workspace_name())
            .ok_or_else(|| VcsError::BackendError {
                reason: "missing working copy commit".to_string(),
            })?;
        Ok(wc_commit_id.hex())
    }

    fn create_ref(repo_path: &Path, name: &str) -> Result<String, VcsError> {
        let (workspace, repo) = load_workspace_repo(repo_path)?;
        let ref_name = RefName::new(name);
        if repo.view().get_local_bookmark(ref_name).is_present() {
            return Err(VcsError::RefAlreadyExists {
                name: name.to_string(),
            });
        }
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(workspace.workspace_name())
            .ok_or_else(|| VcsError::BackendError {
                reason: "missing working copy commit".to_string(),
            })?
            .clone();
        let wc_commit = repo
            .store()
            .get_commit(&wc_commit_id)
            .map_err(map_backend_error("load working copy commit"))?;

        let mut tx = repo.start_transaction();
        tx.repo_mut()
            .set_local_bookmark_target(ref_name, RefTarget::normal(wc_commit.id().clone()));
        tx.commit(format!("create bookmark {name}"))
            .map_err(map_backend_error("commit bookmark"))?;

        Ok(wc_commit.change_id().hex())
    }

    fn checkout_ref(repo_path: &Path, name: &str) -> Result<(), VcsError> {
        let (mut workspace, repo) = load_workspace_repo(repo_path)?;
        let ref_name = RefName::new(name);
        let target = repo.view().get_local_bookmark(ref_name);
        let Some(commit_id) = target.as_normal() else {
            return Err(VcsError::RefNotFound {
                name: name.to_string(),
            });
        };
        let commit = repo
            .store()
            .get_commit(commit_id)
            .map_err(map_backend_error("load bookmark commit"))?;
        let mut tx = repo.start_transaction();
        tx.repo_mut()
            .check_out(workspace.workspace_name().to_owned(), &commit)
            .map_err(map_backend_error("update working copy commit"))?;
        let repo = tx
            .commit(format!("checkout {name}"))
            .map_err(map_backend_error("commit checkout"))?;
        workspace
            .check_out(repo.op_id().clone(), None, &commit)
            .map_err(map_backend_error("checkout working copy"))?;
        Ok(())
    }

    fn commit_all(repo_path: &Path, message: &str) -> Result<String, VcsError> {
        let (mut workspace, repo) = load_workspace_repo(repo_path)?;
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(workspace.workspace_name())
            .ok_or_else(|| VcsError::BackendError {
                reason: "missing working copy commit".to_string(),
            })?
            .clone();
        let wc_commit = repo
            .store()
            .get_commit(&wc_commit_id)
            .map_err(map_backend_error("load working copy commit"))?;

        let snapshot_options = SnapshotOptions {
            base_ignores: GitIgnoreFile::empty(),
            progress: None,
            start_tracking_matcher: &EverythingMatcher,
            force_tracking_matcher: &NothingMatcher,
            max_new_file_size: u64::MAX,
        };
        let mut locked = workspace
            .start_working_copy_mutation()
            .map_err(map_backend_error("lock working copy"))?;
        let (tree, stats) = locked
            .locked_wc()
            .snapshot(&snapshot_options)
            .block_on()
            .map_err(map_backend_error("snapshot working copy"))?;
        locked
            .finish(repo.op_id().clone())
            .map_err(map_backend_error("finish working copy"))?;

        if !stats.untracked_paths.is_empty() {
            return Err(VcsError::CommitFailed {
                reason: "untracked files present".to_string(),
            });
        }

        let mut tx = repo.start_transaction();
        let new_commit = tx
            .repo_mut()
            .new_commit(wc_commit.parent_ids().to_vec(), tree)
            .set_description(message.to_string())
            .write()
            .map_err(map_backend_error("write commit"))?;

        let new_wc_commit = tx
            .repo_mut()
            .new_commit(vec![new_commit.id().clone()], new_commit.tree())
            .write()
            .map_err(map_backend_error("write working copy commit"))?;
        tx.repo_mut()
            .edit(workspace.workspace_name().to_owned(), &new_wc_commit)
            .map_err(map_backend_error("update working copy"))?;

        tx.commit(format!("commit {message}"))
            .map_err(map_backend_error("commit transaction"))?;

        Ok(new_commit.id().hex())
    }

    fn diff_range(repo_path: &Path, base: &str, head: &str) -> Result<Diff, VcsError> {
        let (_workspace, repo) = load_workspace_repo(repo_path)?;
        let base_commit = repo
            .store()
            .get_commit(&parse_commit_id(base)?)
            .map_err(map_backend_error("load base commit"))?;
        let head_commit = repo
            .store()
            .get_commit(&parse_commit_id(head)?)
            .map_err(map_backend_error("load head commit"))?;

        let base_tree = base_commit.tree();
        let head_tree = head_commit.tree();
        let copy_records = CopyRecords::default();
        let diff_stream =
            base_tree.diff_stream_with_copies(&head_tree, &EverythingMatcher, &copy_records);
        let conflict_labels = JjDiff::new(base_tree.labels(), head_tree.labels());
        let store = repo.store();
        let materialize_options = ConflictMaterializeOptions {
            marker_style: ConflictMarkerStyle::Diff,
            marker_len: None,
            merge: store.merge_options().clone(),
        };

        let mut output = String::new();
        let mut stream =
            jj_lib::conflicts::materialized_diff_stream(store, diff_stream, conflict_labels);
        while let Some(entry) = stream.next().block_on() {
            let values = entry
                .values
                .map_err(map_backend_error("materialize diff"))?;
            let path = entry.path;
            let left_path = path.source();
            let right_path = path.target();
            let left_path_string = left_path.as_internal_file_string();
            let right_path_string = right_path.as_internal_file_string();
            let left_part = git_diff_part(left_path, values.before, &materialize_options)
                .map_err(map_backend_error("diff left part"))?;
            let right_part = git_diff_part(right_path, values.after, &materialize_options)
                .map_err(map_backend_error("diff right part"))?;

            writeln!(
                output,
                "diff --git a/{left_path_string} b/{right_path_string}"
            )
            .map_err(map_backend_error("write diff"))?;
            match (left_part.mode, right_part.mode) {
                (None, Some(right_mode)) => {
                    writeln!(output, "new file mode {right_mode}")
                        .map_err(map_backend_error("write diff"))?;
                }
                (Some(left_mode), None) => {
                    writeln!(output, "deleted file mode {left_mode}")
                        .map_err(map_backend_error("write diff"))?;
                }
                (Some(left_mode), Some(right_mode)) => {
                    if left_mode != right_mode {
                        writeln!(output, "old mode {left_mode}")
                            .map_err(map_backend_error("write diff"))?;
                        writeln!(output, "new mode {right_mode}")
                            .map_err(map_backend_error("write diff"))?;
                    }
                }
                (None, None) => {}
            }

            if left_part.content.contents == right_part.content.contents {
                continue;
            }

            let left_path = match left_part.mode {
                Some(_) => format!("a/{left_path_string}"),
                None => "/dev/null".to_string(),
            };
            let right_path = match right_part.mode {
                Some(_) => format!("b/{right_path_string}"),
                None => "/dev/null".to_string(),
            };
            if left_part.content.is_binary || right_part.content.is_binary {
                writeln!(output, "Binary files {left_path} and {right_path} differ")
                    .map_err(map_backend_error("write diff"))?;
                continue;
            }

            writeln!(output, "--- {left_path}").map_err(map_backend_error("write diff"))?;
            writeln!(output, "+++ {right_path}").map_err(map_backend_error("write diff"))?;

            for hunk in unified_diff_hunks(
                JjDiff::new(&left_part.content.contents, &right_part.content.contents)
                    .map(BStr::new),
                3,
                LineCompareMode::Exact,
            ) {
                let old_start = if hunk.left_line_range.is_empty() {
                    hunk.left_line_range.start
                } else {
                    hunk.left_line_range.start + 1
                };
                let new_start = if hunk.right_line_range.is_empty() {
                    hunk.right_line_range.start
                } else {
                    hunk.right_line_range.start + 1
                };
                writeln!(
                    output,
                    "@@ -{old_start},{} +{new_start},{} @@",
                    hunk.left_line_range.len(),
                    hunk.right_line_range.len()
                )
                .map_err(map_backend_error("write diff"))?;
                for (line_type, tokens) in hunk.lines {
                    let sigil = match line_type {
                        DiffLineType::Context => ' ',
                        DiffLineType::Removed => '-',
                        DiffLineType::Added => '+',
                    };
                    output.push(sigil);
                    for (_token_type, content) in tokens {
                        output.push_str(&String::from_utf8_lossy(content));
                    }
                    if !output.ends_with('\n') {
                        output.push('\n');
                        output.push_str("\\ No newline at end of file\n");
                    }
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
        let (_workspace, repo) = load_workspace_repo(repo_path)?;
        let ref_name = RefName::new(name);
        if !repo.view().get_local_bookmark(ref_name).is_present() {
            return Err(VcsError::RefNotFound {
                name: name.to_string(),
            });
        }
        let mut tx = repo.start_transaction();
        tx.repo_mut()
            .set_local_bookmark_target(ref_name, RefTarget::absent());
        tx.commit(format!("delete bookmark {name}"))
            .map_err(map_backend_error("commit bookmark delete"))?;
        Ok(())
    }
}

fn load_workspace_repo(
    repo_path: &Path,
) -> Result<(Workspace, std::sync::Arc<jj_lib::repo::ReadonlyRepo>), VcsError> {
    let settings = UserSettings::from_config(StackedConfig::with_defaults())
        .map_err(map_backend_error("load settings"))?;
    let workspace = Workspace::load(
        &settings,
        repo_path,
        &StoreFactories::default(),
        &default_working_copy_factories(),
    )
    .map_err(|err| match err {
        jj_lib::workspace::WorkspaceLoadError::NoWorkspaceHere(_) => VcsError::RepoNotFound,
        _ => VcsError::BackendError {
            reason: format!("load workspace: {err}"),
        },
    })?;
    let repo = workspace
        .repo_loader()
        .load_at_head()
        .map_err(map_backend_error("load repo"))?;
    Ok((workspace, repo))
}

fn map_backend_error<E: std::fmt::Display>(context: &'static str) -> impl FnOnce(E) -> VcsError {
    move |err| VcsError::BackendError {
        reason: format!("{context}: {err}"),
    }
}

fn parse_commit_id(hex: &str) -> Result<jj_lib::backend::CommitId, VcsError> {
    jj_lib::backend::CommitId::try_from_hex(hex).ok_or_else(|| VcsError::BackendError {
        reason: "invalid commit id".to_string(),
    })
}
