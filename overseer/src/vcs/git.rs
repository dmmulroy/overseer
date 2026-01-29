use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{TimeZone, Utc};
use gix::bstr::ByteSlice;

use crate::vcs::backend::{
    ChangeType, CommitResult, DiffEntry, FileStatus, FileStatusKind, LogEntry, VcsBackend,
    VcsError, VcsResult, VcsStatus, VcsType,
};

pub struct GixBackend {
    root: PathBuf,
}

impl GixBackend {
    pub fn open(path: &Path) -> VcsResult<Self> {
        // Verify it's a valid git repo
        let repo =
            gix::discover(path).map_err(|e| VcsError::OperationFailed(format!("discover: {e}")))?;

        let root = repo.workdir().ok_or(VcsError::NoWorkingCopy)?.to_path_buf();

        Ok(Self { root })
    }

    fn open_repo(&self) -> VcsResult<gix::Repository> {
        gix::discover(&self.root).map_err(|e| VcsError::OperationFailed(format!("open repo: {e}")))
    }
}

impl VcsBackend for GixBackend {
    fn vcs_type(&self) -> VcsType {
        VcsType::Git
    }

    fn root(&self) -> &str {
        self.root.to_str().unwrap_or("")
    }

    fn status(&self) -> VcsResult<VcsStatus> {
        let repo = self.open_repo()?;

        // Get HEAD commit id
        let head = repo
            .head()
            .map_err(|e| VcsError::OperationFailed(format!("get head: {e}")))?;

        let working_copy_id = head.id().map(|id| id.to_string()[..8].to_string());

        let mut files = Vec::new();

        // Use gix status to get changes
        let status_platform = repo
            .status(gix::progress::Discard)
            .map_err(|e| VcsError::OperationFailed(format!("status: {e}")))?;

        let status_iter = status_platform
            .into_iter(Vec::new())
            .map_err(|e| VcsError::OperationFailed(format!("status iter: {e}")))?;

        for item in status_iter {
            let item = item.map_err(|e| VcsError::OperationFailed(format!("status item: {e}")))?;

            match item {
                gix::status::Item::IndexWorktree(worktree_item) => {
                    use gix::status::index_worktree::Item;

                    match worktree_item {
                        Item::Modification { rela_path, .. } => {
                            files.push(FileStatus {
                                path: rela_path.to_string(),
                                status: FileStatusKind::Modified,
                            });
                        }
                        Item::DirectoryContents { entry, .. } => {
                            files.push(FileStatus {
                                path: entry.rela_path.to_string(),
                                status: FileStatusKind::Untracked,
                            });
                        }
                        Item::Rewrite {
                            dirwalk_entry,
                            source,
                            ..
                        } => {
                            files.push(FileStatus {
                                path: format!(
                                    "{} -> {}",
                                    source.rela_path(),
                                    dirwalk_entry.rela_path
                                ),
                                status: FileStatusKind::Renamed,
                            });
                        }
                    }
                }
                gix::status::Item::TreeIndex(change) => {
                    // Staged changes (HEAD tree vs index) - include as dirty
                    let path = change.location().to_string();
                    files.push(FileStatus {
                        path,
                        status: FileStatusKind::Modified, // staged = modified from HEAD
                    });
                }
            }
        }

        Ok(VcsStatus {
            files,
            working_copy_id,
        })
    }

    fn log(&self, limit: usize) -> VcsResult<Vec<LogEntry>> {
        let repo = self.open_repo()?;

        let head_commit = repo
            .head_commit()
            .map_err(|e| VcsError::OperationFailed(format!("get head commit: {e}")))?;

        let mut entries = Vec::new();

        let commits = repo
            .rev_walk([head_commit.id])
            .all()
            .map_err(|e| VcsError::OperationFailed(format!("rev walk: {e}")))?;

        for commit_result in commits.take(limit) {
            let commit_info = commit_result
                .map_err(|e| VcsError::OperationFailed(format!("walk commit: {e}")))?;

            let commit_obj = commit_info
                .object()
                .map_err(|e| VcsError::OperationFailed(format!("get commit obj: {e}")))?;

            let decoded = commit_obj
                .decode()
                .map_err(|e| VcsError::OperationFailed(format!("decode commit: {e}")))?;

            let id = commit_obj.id.to_string()[..12].to_string();
            let description = decoded.message.to_str_lossy().trim().to_string();

            // Parse author and timestamp - author() returns Result in gix 0.77+
            let (author, timestamp) = match decoded.author() {
                Ok(author_ref) => {
                    let name = author_ref.name.to_str_lossy().to_string();
                    let ts = author_ref
                        .time()
                        .ok()
                        .and_then(|t| Utc.timestamp_opt(t.seconds, 0).single())
                        .unwrap_or_else(Utc::now);
                    (name, ts)
                }
                Err(_) => ("Unknown".to_string(), Utc::now()),
            };

            entries.push(LogEntry {
                id,
                description,
                author,
                timestamp,
            });
        }

        Ok(entries)
    }

    fn diff(&self, _base: Option<&str>) -> VcsResult<Vec<DiffEntry>> {
        let repo = self.open_repo()?;
        let mut entries = Vec::new();

        // Use status API to get working directory changes
        let status_platform = repo
            .status(gix::progress::Discard)
            .map_err(|e| VcsError::OperationFailed(format!("status: {e}")))?;

        let status_iter = status_platform
            .into_iter(Vec::new())
            .map_err(|e| VcsError::OperationFailed(format!("status iter: {e}")))?;

        for item in status_iter {
            let item = item.map_err(|e| VcsError::OperationFailed(format!("status item: {e}")))?;

            match item {
                gix::status::Item::IndexWorktree(worktree_item) => {
                    use gix::status::index_worktree::Item;

                    match worktree_item {
                        Item::Modification { rela_path, .. } => {
                            entries.push(DiffEntry {
                                path: rela_path.to_string(),
                                change_type: ChangeType::Modified,
                            });
                        }
                        Item::DirectoryContents { entry, .. } => {
                            entries.push(DiffEntry {
                                path: entry.rela_path.to_string(),
                                change_type: ChangeType::Added,
                            });
                        }
                        Item::Rewrite {
                            dirwalk_entry,
                            source,
                            ..
                        } => {
                            entries.push(DiffEntry {
                                path: format!(
                                    "{} -> {}",
                                    source.rela_path(),
                                    dirwalk_entry.rela_path
                                ),
                                change_type: ChangeType::Renamed,
                            });
                        }
                    }
                }
                gix::status::Item::TreeIndex(change) => {
                    // Staged changes (HEAD tree vs index) - include in diff
                    let path = change.location().to_string();
                    entries.push(DiffEntry {
                        path,
                        change_type: ChangeType::Modified,
                    });
                }
            }
        }

        Ok(entries)
    }

    fn commit(&self, message: &str) -> VcsResult<CommitResult> {
        // Use git CLI for commit since gix's staging/commit API is still unstable.
        // This is the git fallback backend, so having git CLI available is reasonable.

        // Check if there's anything to commit first (using porcelain for locale-independence)
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::OperationFailed(format!("failed to run git status: {e}")))?;

        if !status_output.status.success() {
            let stderr = String::from_utf8_lossy(&status_output.stderr);
            return Err(VcsError::OperationFailed(format!(
                "git status failed: {stderr}"
            )));
        }

        let status_str = String::from_utf8_lossy(&status_output.stdout);
        if status_str.trim().is_empty() {
            return Err(VcsError::NothingToCommit);
        }

        // Stage all changes (git add -A)
        let add_output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::OperationFailed(format!("failed to run git add: {e}")))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(VcsError::OperationFailed(format!(
                "git add -A failed: {stderr}"
            )));
        }

        // Create commit (with --no-gpg-sign to avoid GPG agent issues in automation)
        let commit_output = Command::new("git")
            .args(["commit", "--no-gpg-sign", "-m", message])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::OperationFailed(format!("failed to run git commit: {e}")))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            return Err(VcsError::OperationFailed(format!(
                "git commit failed: {stderr}"
            )));
        }

        // Get the commit ID
        let rev_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::OperationFailed(format!("failed to run git rev-parse: {e}")))?;

        if !rev_output.status.success() {
            let stderr = String::from_utf8_lossy(&rev_output.stderr);
            return Err(VcsError::OperationFailed(format!(
                "git rev-parse HEAD failed: {stderr}"
            )));
        }

        let full_id = String::from_utf8_lossy(&rev_output.stdout)
            .trim()
            .to_string();
        let id = full_id[..12.min(full_id.len())].to_string();

        Ok(CommitResult {
            id,
            message: message.to_string(),
        })
    }

    fn current_commit_id(&self) -> VcsResult<String> {
        let repo = self.open_repo()?;

        let head_commit = repo
            .head_commit()
            .map_err(|e| VcsError::OperationFailed(format!("get head commit: {e}")))?;

        Ok(head_commit.id.to_string()[..12].to_string())
    }

    fn create_bookmark(&self, name: &str, target: Option<&str>) -> VcsResult<()> {
        // Check if branch already exists using gix
        let repo = self.open_repo()?;
        let references = repo
            .references()
            .map_err(|e| VcsError::Git(e.to_string()))?;

        let branch_ref = format!("refs/heads/{}", name);
        for reference in references.all().map_err(|e| VcsError::Git(e.to_string()))? {
            let reference = reference.map_err(|e| VcsError::Git(e.to_string()))?;
            if reference.name().as_bstr().to_str_lossy() == branch_ref {
                return Err(VcsError::BookmarkExists(name.to_string()));
            }
        }

        // Use git CLI to create branch
        let mut args = vec!["branch".to_string(), name.to_string()];
        if let Some(t) = target {
            args.push(t.to_string());
        }

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git branch: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("not a valid object name") || stderr.contains("unknown revision") {
                return Err(VcsError::TargetNotFound(
                    target.unwrap_or("HEAD").to_string(),
                ));
            }
            return Err(VcsError::Git(format!("git branch failed: {stderr}")));
        }

        Ok(())
    }

    fn delete_bookmark(&self, name: &str) -> VcsResult<()> {
        // Check if branch exists using gix
        let repo = self.open_repo()?;
        let references = repo
            .references()
            .map_err(|e| VcsError::Git(e.to_string()))?;

        let branch_ref = format!("refs/heads/{}", name);
        let mut found = false;
        for reference in references.all().map_err(|e| VcsError::Git(e.to_string()))? {
            let reference = reference.map_err(|e| VcsError::Git(e.to_string()))?;
            if reference.name().as_bstr().to_str_lossy() == branch_ref {
                found = true;
                break;
            }
        }

        if !found {
            return Err(VcsError::BookmarkNotFound(name.to_string()));
        }

        // Use git CLI to delete branch
        let output = Command::new("git")
            .args(["branch", "-d", name])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git branch -d: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Try force delete if branch is not fully merged
            if stderr.contains("not fully merged") {
                let output = Command::new("git")
                    .args(["branch", "-D", name])
                    .current_dir(&self.root)
                    .output()
                    .map_err(|e| VcsError::Git(format!("failed to run git branch -D: {e}")))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(VcsError::Git(format!("git branch -D failed: {stderr}")));
                }
            } else {
                return Err(VcsError::Git(format!("git branch -d failed: {stderr}")));
            }
        }

        Ok(())
    }

    fn list_bookmarks(&self, prefix: Option<&str>) -> VcsResult<Vec<String>> {
        let repo = self.open_repo()?;
        let references = repo
            .references()
            .map_err(|e| VcsError::Git(e.to_string()))?;

        let mut branches = Vec::new();

        for reference in references.all().map_err(|e| VcsError::Git(e.to_string()))? {
            let reference = reference.map_err(|e| VcsError::Git(e.to_string()))?;
            let name = reference.name().as_bstr().to_str_lossy();

            if name.starts_with("refs/heads/") {
                let branch_name = name.strip_prefix("refs/heads/").unwrap_or(&name);
                if prefix.is_none() || branch_name.starts_with(prefix.unwrap()) {
                    branches.push(branch_name.to_string());
                }
            }
        }

        branches.sort();
        Ok(branches)
    }

    fn checkout(&self, target: &str) -> VcsResult<()> {
        // Check for dirty working copy
        if !self.is_clean()? {
            return Err(VcsError::DirtyWorkingCopy);
        }

        let output = Command::new("git")
            .args(["checkout", target])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git checkout: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("did not match any")
                || stderr.contains("pathspec")
                || stderr.contains("not a valid object name")
            {
                return Err(VcsError::TargetNotFound(target.to_string()));
            }
            return Err(VcsError::Git(format!("git checkout failed: {stderr}")));
        }

        Ok(())
    }

    fn squash(&self, message: &str) -> VcsResult<CommitResult> {
        // Count commits to squash (from HEAD to first parent branch point or root)
        // For simplicity, we'll squash all commits on the current branch back to HEAD~N
        // where N is determined by counting commits

        let repo = self.open_repo()?;
        let head_commit = repo
            .head_commit()
            .map_err(|e| VcsError::OperationFailed(format!("get head commit: {e}")))?;

        // Guard: cannot squash merge commits
        let parent_count = head_commit.parent_ids().count();
        if parent_count > 1 {
            return Err(VcsError::OperationFailed(
                "Cannot squash merge commits".to_string(),
            ));
        }

        // Count commits from HEAD to root (or merge base)
        let mut count = 0;
        let commits = repo
            .rev_walk([head_commit.id])
            .all()
            .map_err(|e| VcsError::OperationFailed(format!("rev walk: {e}")))?;

        for commit_result in commits {
            let _ = commit_result.map_err(|e| VcsError::OperationFailed(format!("walk: {e}")))?;
            count += 1;
            if count > 1 {
                break; // We only need to know if there's more than 1 commit
            }
        }

        if count < 2 {
            return Err(VcsError::OperationFailed(
                "Not enough commits to squash".to_string(),
            ));
        }

        // Soft reset to HEAD~1 to squash the last 2 commits
        let output = Command::new("git")
            .args(["reset", "--soft", "HEAD~1"])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git reset: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VcsError::Git(format!("git reset --soft failed: {stderr}")));
        }

        // Commit with new message
        let output = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git commit: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VcsError::Git(format!("git commit failed: {stderr}")));
        }

        // Get new commit id
        let rev_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git rev-parse: {e}")))?;

        if !rev_output.status.success() {
            let stderr = String::from_utf8_lossy(&rev_output.stderr);
            return Err(VcsError::Git(format!("git rev-parse failed: {stderr}")));
        }

        let full_id = String::from_utf8_lossy(&rev_output.stdout)
            .trim()
            .to_string();
        let id = full_id[..12.min(full_id.len())].to_string();

        Ok(CommitResult {
            id,
            message: message.to_string(),
        })
    }

    fn rebase_onto(&self, target: &str) -> VcsResult<()> {
        // Check for dirty working copy
        if !self.is_clean()? {
            return Err(VcsError::DirtyWorkingCopy);
        }

        // Verify target exists
        let output = Command::new("git")
            .args(["rev-parse", "--verify", target])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git rev-parse: {e}")))?;

        if !output.status.success() {
            return Err(VcsError::TargetNotFound(target.to_string()));
        }

        let output = Command::new("git")
            .args(["rebase", target])
            .current_dir(&self.root)
            .output()
            .map_err(|e| VcsError::Git(format!("failed to run git rebase: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT") || stderr.contains("could not apply") {
                // Abort the rebase
                let _ = Command::new("git")
                    .args(["rebase", "--abort"])
                    .current_dir(&self.root)
                    .output();
                return Err(VcsError::RebaseConflict);
            }
            return Err(VcsError::Git(format!("git rebase failed: {stderr}")));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{GitTestRepo, TestRepo};
    use crate::vcs::backend::VcsType;

    #[test]
    fn test_open_git_repo() {
        let repo = GitTestRepo::new().unwrap();
        let backend = GixBackend::open(repo.path()).unwrap();
        assert_eq!(backend.vcs_type(), VcsType::Git);
    }

    #[test]
    fn test_status_empty_repo() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let status = backend.status().unwrap();
        assert!(status.working_copy_id.is_some());
        assert!(status.files.is_empty());
    }

    #[test]
    fn test_status_with_modified_file() {
        let repo = GitTestRepo::new().unwrap();
        repo.write_file("test.txt", "initial").unwrap();
        repo.commit("initial commit").unwrap();

        repo.write_file("test.txt", "modified").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let status = backend.status().unwrap();
        assert!(!status.files.is_empty());
        assert_eq!(status.files[0].status, FileStatusKind::Modified);
    }

    #[test]
    fn test_status_with_untracked_file() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();
        repo.write_file("new_file.txt", "new content").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let status = backend.status().unwrap();
        assert!(!status.files.is_empty());
        assert_eq!(status.files[0].status, FileStatusKind::Untracked);
    }

    #[test]
    fn test_log_empty_repo() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let log = backend.log(10).unwrap();
        assert!(!log.is_empty());
        assert_eq!(log[0].description, "initial commit");
    }

    #[test]
    fn test_log_multiple_commits() {
        let repo = GitTestRepo::new().unwrap();

        repo.write_file("file1.txt", "first").unwrap();
        repo.commit("first commit").unwrap();

        repo.write_file("file2.txt", "second").unwrap();
        repo.commit("second commit").unwrap();

        repo.write_file("file3.txt", "third").unwrap();
        repo.commit("third commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let log = backend.log(10).unwrap();

        assert!(log.len() >= 3);

        let descriptions: Vec<_> = log.iter().map(|e| e.description.as_str()).collect();
        assert!(descriptions.contains(&"third commit"));
        assert!(descriptions.contains(&"second commit"));
        assert!(descriptions.contains(&"first commit"));
    }

    #[test]
    fn test_log_limit() {
        let repo = GitTestRepo::new().unwrap();

        for i in 0..5 {
            repo.write_file(&format!("file{i}.txt"), &format!("content{i}"))
                .unwrap();
            repo.commit(&format!("commit {i}")).unwrap();
        }

        let backend = GixBackend::open(repo.path()).unwrap();
        let log = backend.log(2).unwrap();
        assert_eq!(log.len(), 2);
    }

    #[test]
    fn test_diff_empty_working_copy() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let diff = backend.diff(None).unwrap();
        assert!(diff.is_empty());
    }

    #[test]
    fn test_diff_with_modified_file() {
        let repo = GitTestRepo::new().unwrap();
        repo.write_file("test.txt", "initial").unwrap();
        repo.commit("initial commit").unwrap();

        repo.write_file("test.txt", "modified").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let diff = backend.diff(None).unwrap();
        assert!(!diff.is_empty());
        assert_eq!(diff[0].change_type, ChangeType::Modified);
    }

    #[test]
    fn test_diff_with_added_file() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();
        repo.write_file("new_file.txt", "new content").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let diff = backend.diff(None).unwrap();
        assert!(!diff.is_empty());
        assert_eq!(diff[0].change_type, ChangeType::Added);
    }

    #[test]
    fn test_commit_workflow() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
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
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let result = backend.commit("should fail");

        assert!(matches!(result, Err(VcsError::NothingToCommit)));
    }

    #[test]
    fn test_current_commit_id() {
        let repo = GitTestRepo::new().unwrap();
        let commit_hash = repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let id = backend.current_commit_id().unwrap();
        assert!(!id.is_empty());
        assert_eq!(id.len(), 12);
        assert!(commit_hash.starts_with(&id));
    }

    #[test]
    fn test_current_commit_id_changes_after_commit() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let id1 = backend.current_commit_id().unwrap();

        repo.write_file("a.txt", "a").unwrap();
        backend.commit("commit a").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let id2 = backend.current_commit_id().unwrap();
        assert_ne!(id1, id2);

        repo.write_file("b.txt", "b").unwrap();
        backend.commit("commit b").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let id3 = backend.current_commit_id().unwrap();
        assert_ne!(id2, id3);
    }

    #[test]
    fn test_root_path() {
        let repo = GitTestRepo::new().unwrap();
        let backend = GixBackend::open(repo.path()).unwrap();
        let root = backend.root();
        assert!(!root.is_empty());
        assert!(std::path::Path::new(root).exists());
    }

    #[test]
    fn test_nested_file_operations() {
        let repo = GitTestRepo::new().unwrap();
        repo.commit("initial commit").unwrap();

        repo.write_file("src/main.rs", "fn main() {}").unwrap();
        repo.write_file("src/lib/mod.rs", "// module").unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        backend.commit("add source files").unwrap();

        let log = backend.log(5).unwrap();
        assert!(log.iter().any(|e| e.description == "add source files"));
    }

    #[test]
    fn test_status_with_staged_changes() {
        let repo = GitTestRepo::new().unwrap();
        repo.write_file("test.txt", "initial").unwrap();
        repo.commit("initial commit").unwrap();

        // Modify and stage the file
        repo.write_file("test.txt", "modified").unwrap();
        std::process::Command::new("git")
            .args(["add", "test.txt"])
            .current_dir(repo.path())
            .output()
            .unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();
        let status = backend.status().unwrap();

        // Staged changes should be detected as dirty
        assert!(
            !status.files.is_empty(),
            "Status should include staged changes"
        );
    }

    #[test]
    fn test_is_clean_false_with_staged_changes() {
        let repo = GitTestRepo::new().unwrap();
        repo.write_file("test.txt", "initial").unwrap();
        repo.commit("initial commit").unwrap();

        // Modify and stage the file
        repo.write_file("test.txt", "modified").unwrap();
        std::process::Command::new("git")
            .args(["add", "test.txt"])
            .current_dir(repo.path())
            .output()
            .unwrap();

        let backend = GixBackend::open(repo.path()).unwrap();

        // is_clean should return false when there are staged changes
        assert!(
            !backend.is_clean().unwrap(),
            "is_clean should return false with staged changes"
        );
    }
}
