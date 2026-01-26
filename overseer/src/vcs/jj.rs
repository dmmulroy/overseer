use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, TimeZone, Utc};
use jj_lib::backend::CommitId;
use jj_lib::config::{ConfigLayer, ConfigSource, StackedConfig};
use jj_lib::hex_util::encode_reverse_hex;
use jj_lib::object_id::ObjectId;
use jj_lib::op_store::RefTarget;
use jj_lib::ref_name::RefNameBuf;
use jj_lib::repo::{ReadonlyRepo, Repo, StoreFactories};
use jj_lib::settings::UserSettings;
use jj_lib::workspace::{default_working_copy_factories, Workspace};

use crate::vcs::backend::{
    ChangeType, CommitResult, DiffEntry, FileStatus, FileStatusKind, LogEntry, VcsBackend,
    VcsError, VcsResult, VcsStatus, VcsType,
};

pub struct JjBackend {
    root: PathBuf,
    settings: UserSettings,
}

impl JjBackend {
    pub fn open(path: &Path) -> VcsResult<Self> {
        let settings = create_user_settings()?;
        Ok(Self {
            root: path.to_path_buf(),
            settings,
        })
    }

    fn load_workspace(&self) -> VcsResult<Workspace> {
        Workspace::load(
            &self.settings,
            &self.root,
            &StoreFactories::default(),
            &default_working_copy_factories(),
        )
        .map_err(|e| VcsError::Jj(format!("load workspace: {e}")))
    }

    fn load_repo(&self) -> VcsResult<(Workspace, Arc<ReadonlyRepo>)> {
        let workspace = self.load_workspace()?;
        let repo = workspace
            .repo_loader()
            .load_at_head()
            .map_err(|e| VcsError::Jj(format!("load repo: {e}")))?;
        Ok((workspace, repo))
    }
}

fn create_user_settings() -> VcsResult<UserSettings> {
    let mut config = StackedConfig::with_defaults();

    let mut user_layer = ConfigLayer::empty(ConfigSource::User);
    user_layer
        .set_value("user.name", "overseer")
        .map_err(|e| VcsError::Jj(format!("set user.name: {e}")))?;
    user_layer
        .set_value("user.email", "overseer@localhost")
        .map_err(|e| VcsError::Jj(format!("set user.email: {e}")))?;
    config.add_layer(user_layer);

    UserSettings::from_config(config).map_err(|e| VcsError::Jj(format!("settings: {e}")))
}

fn timestamp_to_datetime(ts: &jj_lib::backend::Timestamp) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ts.timestamp.0)
        .single()
        .unwrap_or_else(Utc::now)
}

impl VcsBackend for JjBackend {
    fn vcs_type(&self) -> VcsType {
        VcsType::Jj
    }

    fn root(&self) -> &str {
        self.root.to_str().unwrap_or("")
    }

    fn status(&self) -> VcsResult<VcsStatus> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

        let change_id_full = encode_reverse_hex(commit.change_id().as_bytes());
        let working_copy_id = Some(change_id_full[..8.min(change_id_full.len())].to_string());

        let is_empty = commit
            .is_empty(repo.as_ref())
            .map_err(|e| VcsError::Jj(format!("check empty: {e}")))?;

        let has_conflict = commit.has_conflict();

        let files = if is_empty {
            Vec::new()
        } else {
            vec![FileStatus {
                path: "(working copy has changes)".to_string(),
                status: if has_conflict {
                    FileStatusKind::Conflict
                } else {
                    FileStatusKind::Modified
                },
            }]
        };

        Ok(VcsStatus {
            files,
            working_copy_id,
        })
    }

    fn log(&self, limit: usize) -> VcsResult<Vec<LogEntry>> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let mut entries = Vec::new();
        let mut current_ids = vec![wc_id.clone()];
        let mut visited = std::collections::HashSet::new();

        while entries.len() < limit && !current_ids.is_empty() {
            let commit_id = current_ids.remove(0);

            if !visited.insert(commit_id.clone()) {
                continue;
            }

            let commit = repo
                .store()
                .get_commit(&commit_id)
                .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

            let change_id_full = encode_reverse_hex(commit.change_id().as_bytes());
            let id = change_id_full[..12.min(change_id_full.len())].to_string();

            entries.push(LogEntry {
                id,
                description: commit.description().trim().to_string(),
                author: commit.author().name.clone(),
                timestamp: timestamp_to_datetime(&commit.author().timestamp),
            });

            for parent_id in commit.parent_ids() {
                current_ids.push(parent_id.clone());
            }
        }

        Ok(entries)
    }

    fn diff(&self, _base: Option<&str>) -> VcsResult<Vec<DiffEntry>> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

        let is_empty = commit
            .is_empty(repo.as_ref())
            .map_err(|e| VcsError::Jj(format!("check empty: {e}")))?;

        if is_empty {
            Ok(Vec::new())
        } else {
            Ok(vec![DiffEntry {
                path: "(working copy)".to_string(),
                change_type: ChangeType::Modified,
            }])
        }
    }

    fn commit(&self, message: &str) -> VcsResult<CommitResult> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

        let is_empty = commit
            .is_empty(repo.as_ref())
            .map_err(|e| VcsError::Jj(format!("check empty: {e}")))?;

        let has_description = !commit.description().trim().is_empty();

        if is_empty && has_description {
            return Err(VcsError::NothingToCommit);
        }

        let mut tx = repo.start_transaction();
        let mut_repo = tx.repo_mut();

        let new_commit = mut_repo
            .rewrite_commit(&commit)
            .set_description(message)
            .write()
            .map_err(|e| VcsError::Jj(format!("rewrite commit: {e}")))?;

        let change_id_full = encode_reverse_hex(new_commit.change_id().as_bytes());
        let id = change_id_full[..12.min(change_id_full.len())].to_string();

        // Rebase descendants after rewriting commit (required by jj-lib)
        mut_repo
            .rebase_descendants()
            .map_err(|e| VcsError::Jj(format!("rebase descendants: {e}")))?;

        if !is_empty || !has_description {
            let new_wc = mut_repo
                .new_commit(vec![new_commit.id().clone()], new_commit.tree())
                .write()
                .map_err(|e| VcsError::Jj(format!("create new commit: {e}")))?;

            mut_repo
                .set_wc_commit(workspace.workspace_name().into(), new_wc.id().clone())
                .map_err(|e| VcsError::Jj(format!("set wc commit: {e}")))?;
        }

        tx.commit(format!(
            "describe: {}",
            message.lines().next().unwrap_or("")
        ))
        .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(CommitResult {
            id,
            message: message.to_string(),
        })
    }

    fn current_commit_id(&self) -> VcsResult<String> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

        let change_id_full = encode_reverse_hex(commit.change_id().as_bytes());
        Ok(change_id_full[..12.min(change_id_full.len())].to_string())
    }

    fn create_bookmark(&self, name: &str, target: Option<&str>) -> VcsResult<()> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let ref_name: RefNameBuf = name.into();
        if view
            .local_bookmarks()
            .any(|(n, _)| n.as_str() == ref_name.as_str())
        {
            return Err(VcsError::BookmarkExists(name.to_string()));
        }

        let target_id = if let Some(target_str) = target {
            self.resolve_to_commit_id(&repo, target_str)?
        } else {
            view.wc_commit_ids()
                .get(workspace.workspace_name())
                .ok_or(VcsError::NoWorkingCopy)?
                .clone()
        };

        let mut tx = repo.start_transaction();
        tx.repo_mut()
            .set_local_bookmark_target(&ref_name, RefTarget::normal(target_id));

        tx.commit(format!("create bookmark: {name}"))
            .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(())
    }

    fn delete_bookmark(&self, name: &str) -> VcsResult<()> {
        let (_workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let ref_name: RefNameBuf = name.into();
        if !view
            .local_bookmarks()
            .any(|(n, _)| n.as_str() == ref_name.as_str())
        {
            return Err(VcsError::BookmarkNotFound(name.to_string()));
        }

        let mut tx = repo.start_transaction();
        tx.repo_mut()
            .set_local_bookmark_target(&ref_name, RefTarget::absent());

        tx.commit(format!("delete bookmark: {name}"))
            .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(())
    }

    fn list_bookmarks(&self, prefix: Option<&str>) -> VcsResult<Vec<String>> {
        let (_workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let bookmarks: Vec<String> = view
            .local_bookmarks()
            .filter_map(|(name, _target)| {
                let name_str = name.as_str();
                if let Some(p) = prefix {
                    if name_str.starts_with(p) {
                        Some(name_str.to_string())
                    } else {
                        None
                    }
                } else {
                    Some(name_str.to_string())
                }
            })
            .collect();

        Ok(bookmarks)
    }

    fn checkout(&self, target: &str) -> VcsResult<()> {
        let (workspace, repo) = self.load_repo()?;

        let target_id = self.resolve_to_commit_id(&repo, target)?;

        let commit = repo
            .store()
            .get_commit(&target_id)
            .map_err(|e| VcsError::Jj(format!("get commit: {e}")))?;

        let mut tx = repo.start_transaction();

        tx.repo_mut()
            .set_wc_commit(workspace.workspace_name().into(), commit.id().clone())
            .map_err(|e| VcsError::Jj(format!("set wc commit: {e}")))?;

        tx.commit(format!("checkout: {target}"))
            .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(())
    }

    fn squash(&self, message: &str) -> VcsResult<CommitResult> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let wc_commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get wc commit: {e}")))?;

        let parent_ids = wc_commit.parent_ids();
        if parent_ids.is_empty() {
            return Err(VcsError::Jj("working copy has no parent".to_string()));
        }

        let parent_id = &parent_ids[0];
        let parent_commit = repo
            .store()
            .get_commit(parent_id)
            .map_err(|e| VcsError::Jj(format!("get parent commit: {e}")))?;

        let mut tx = repo.start_transaction();
        let mut_repo = tx.repo_mut();

        let new_commit = mut_repo
            .rewrite_commit(&parent_commit)
            .set_tree(wc_commit.tree())
            .set_description(message)
            .write()
            .map_err(|e| VcsError::Jj(format!("rewrite commit: {e}")))?;

        let change_id_full = encode_reverse_hex(new_commit.change_id().as_bytes());
        let id = change_id_full[..12.min(change_id_full.len())].to_string();

        mut_repo
            .rebase_descendants()
            .map_err(|e| VcsError::Jj(format!("rebase descendants: {e}")))?;

        let new_wc = mut_repo
            .new_commit(vec![new_commit.id().clone()], new_commit.tree())
            .write()
            .map_err(|e| VcsError::Jj(format!("create new wc: {e}")))?;

        mut_repo
            .set_wc_commit(workspace.workspace_name().into(), new_wc.id().clone())
            .map_err(|e| VcsError::Jj(format!("set wc commit: {e}")))?;

        tx.commit(format!("squash: {}", message.lines().next().unwrap_or("")))
            .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(CommitResult {
            id,
            message: message.to_string(),
        })
    }

    fn rebase_onto(&self, target: &str) -> VcsResult<()> {
        let (workspace, repo) = self.load_repo()?;
        let view = repo.view();

        let target_id = self.resolve_to_commit_id(&repo, target)?;

        let wc_id = view
            .wc_commit_ids()
            .get(workspace.workspace_name())
            .ok_or(VcsError::NoWorkingCopy)?;

        let wc_commit = repo
            .store()
            .get_commit(wc_id)
            .map_err(|e| VcsError::Jj(format!("get wc commit: {e}")))?;

        let target_commit = repo
            .store()
            .get_commit(&target_id)
            .map_err(|e| VcsError::Jj(format!("get target commit: {e}")))?;

        let mut tx = repo.start_transaction();
        let mut_repo = tx.repo_mut();

        let rebased = mut_repo
            .rewrite_commit(&wc_commit)
            .set_parents(vec![target_commit.id().clone()])
            .write()
            .map_err(|e| VcsError::Jj(format!("rewrite commit: {e}")))?;

        if rebased.has_conflict() {
            return Err(VcsError::RebaseConflict);
        }

        mut_repo
            .rebase_descendants()
            .map_err(|e| VcsError::Jj(format!("rebase descendants: {e}")))?;

        mut_repo
            .set_wc_commit(workspace.workspace_name().into(), rebased.id().clone())
            .map_err(|e| VcsError::Jj(format!("set wc commit: {e}")))?;

        tx.commit(format!("rebase onto: {target}"))
            .map_err(|e| VcsError::Jj(format!("commit transaction: {e}")))?;

        Ok(())
    }
}

impl JjBackend {
    fn resolve_to_commit_id(&self, repo: &Arc<ReadonlyRepo>, target: &str) -> VcsResult<CommitId> {
        use jj_lib::object_id::{HexPrefix, PrefixResolution};
        use jj_lib::repo::Repo;

        let view = repo.view();

        // Try bookmark first
        for (name, bookmark_target) in view.local_bookmarks() {
            if name.as_str() == target {
                if let Some(id) = bookmark_target.as_normal() {
                    return Ok(id.clone());
                }
            }
        }

        // Try change ID prefix (reverse hex format used by jj)
        if let Some(prefix) = HexPrefix::try_from_reverse_hex(target) {
            if let Ok(resolution) = repo.resolve_change_id_prefix(&prefix) {
                match resolution {
                    PrefixResolution::SingleMatch(entries) => {
                        if let Some((commit_id, _)) = entries.targets.first() {
                            return Ok(commit_id.clone());
                        }
                    }
                    PrefixResolution::AmbiguousMatch => {
                        // Could return first match, but for safety return error
                        return Err(VcsError::Jj(format!(
                            "ambiguous change ID prefix: {target}"
                        )));
                    }
                    PrefixResolution::NoMatch => {}
                }
            }
        }

        Err(VcsError::TargetNotFound(target.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{JjTestRepo, TestRepo};

    // === Basic operations (migrated from init_jj_repo) ===

    #[test]
    fn test_open_jj_repo() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        assert_eq!(backend.vcs_type(), VcsType::Jj);
    }

    #[test]
    fn test_status_empty_repo() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let status = backend.status().unwrap();
        assert!(status.working_copy_id.is_some());
        assert!(status.files.is_empty());
    }

    #[test]
    fn test_log_empty_repo() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let log = backend.log(10).unwrap();
        assert!(!log.is_empty());
    }

    #[test]
    fn test_current_commit_id() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let id = backend.current_commit_id().unwrap();
        assert!(!id.is_empty());
    }

    // === Status with modified/added/deleted files ===

    #[test]
    fn test_status_with_modified_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("test.txt", "initial").unwrap();
        repo.commit("initial commit").unwrap();

        repo.write_file("test.txt", "modified").unwrap();
        repo.snapshot().unwrap(); // snapshot to detect working copy changes

        let backend = repo.backend().unwrap();
        let status = backend.status().unwrap();
        assert!(!status.files.is_empty());
        assert_eq!(status.files[0].status, FileStatusKind::Modified);
    }

    #[test]
    fn test_status_with_added_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("new_file.txt", "new content").unwrap();
        repo.snapshot().unwrap(); // snapshot to detect working copy changes

        let backend = repo.backend().unwrap();
        let status = backend.status().unwrap();
        assert!(!status.files.is_empty());
    }

    #[test]
    fn test_status_with_deleted_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("to_delete.txt", "content").unwrap();
        repo.commit("add file").unwrap();

        repo.delete_file("to_delete.txt").unwrap();
        repo.snapshot().unwrap(); // snapshot to detect working copy changes

        let backend = repo.backend().unwrap();
        let status = backend.status().unwrap();
        assert!(!status.files.is_empty());
    }

    // === Log with multiple commits ===

    #[test]
    fn test_log_with_multiple_commits() {
        let repo = JjTestRepo::new().unwrap();

        repo.write_file("file1.txt", "first").unwrap();
        repo.commit("first commit").unwrap();

        repo.write_file("file2.txt", "second").unwrap();
        repo.commit("second commit").unwrap();

        repo.write_file("file3.txt", "third").unwrap();
        repo.commit("third commit").unwrap();

        let backend = repo.backend().unwrap();
        let log = backend.log(10).unwrap();

        assert!(log.len() >= 3);

        let descriptions: Vec<_> = log.iter().map(|e| e.description.as_str()).collect();
        assert!(descriptions.contains(&"third commit"));
        assert!(descriptions.contains(&"second commit"));
        assert!(descriptions.contains(&"first commit"));
    }

    #[test]
    fn test_log_limit() {
        let repo = JjTestRepo::new().unwrap();

        for i in 0..5 {
            repo.write_file(&format!("file{i}.txt"), &format!("content{i}"))
                .unwrap();
            repo.commit(&format!("commit {i}")).unwrap();
        }

        let backend = repo.backend().unwrap();
        let log = backend.log(2).unwrap();
        assert_eq!(log.len(), 2);
    }

    // === Diff with various change types ===

    #[test]
    fn test_diff_empty_working_copy() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let diff = backend.diff(None).unwrap();
        assert!(diff.is_empty());
    }

    #[test]
    fn test_diff_with_changes() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("changed.txt", "some content").unwrap();
        repo.snapshot().unwrap(); // snapshot to detect working copy changes

        let backend = repo.backend().unwrap();
        let diff = backend.diff(None).unwrap();
        assert!(!diff.is_empty());
        assert_eq!(diff[0].change_type, ChangeType::Modified);
    }

    // === Commit workflow ===

    #[test]
    fn test_commit_workflow() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();

        let id_before = backend.current_commit_id().unwrap();

        repo.write_file("new.txt", "content").unwrap();
        let result = backend.commit("test commit").unwrap();

        assert_eq!(result.message, "test commit");
        assert!(!result.id.is_empty());

        let id_after = backend.current_commit_id().unwrap();
        assert_ne!(id_before, id_after);
    }

    #[test]
    fn test_commit_nothing_to_commit() {
        let repo = JjTestRepo::new().unwrap();

        // Describe empty commit without creating new (via jj CLI)
        std::process::Command::new("jj")
            .args(["describe", "-m", "existing description"])
            .current_dir(repo.path())
            .output()
            .unwrap();

        // Now @ is empty but has description - should fail
        let backend = repo.backend().unwrap();
        let result = backend.commit("new description");

        assert!(matches!(result, Err(VcsError::NothingToCommit)));
    }

    #[test]
    fn test_current_commit_id_changes_after_commit() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();

        let id1 = backend.current_commit_id().unwrap();

        repo.write_file("a.txt", "a").unwrap();
        backend.commit("commit a").unwrap();

        let backend = repo.backend().unwrap();
        let id2 = backend.current_commit_id().unwrap();
        assert_ne!(id1, id2);

        repo.write_file("b.txt", "b").unwrap();
        backend.commit("commit b").unwrap();

        let backend = repo.backend().unwrap();
        let id3 = backend.current_commit_id().unwrap();
        assert_ne!(id2, id3);
    }

    // === Root path ===

    #[test]
    fn test_root_path() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let root = backend.root();
        assert!(!root.is_empty());
        assert!(std::path::Path::new(root).exists());
    }

    // === Nested directories ===

    #[test]
    fn test_nested_file_operations() {
        let repo = JjTestRepo::new().unwrap();

        repo.write_file("src/main.rs", "fn main() {}").unwrap();
        repo.write_file("src/lib/mod.rs", "// module").unwrap();
        repo.commit("add source files").unwrap();

        let backend = repo.backend().unwrap();
        let log = backend.log(5).unwrap();
        assert!(log.iter().any(|e| e.description == "add source files"));
    }
}
