use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diff {
    pub base: String,
    pub head: String,
    pub unified: String,
}

#[derive(Debug, Error)]
pub enum VcsError {
    #[error("repo not found")]
    RepoNotFound,
    #[error("dirty working copy")]
    DirtyWorkingCopy,
    #[error("ref already exists: {name}")]
    RefAlreadyExists { name: String },
    #[error("ref not found: {name}")]
    RefNotFound { name: String },
    #[error("commit failed: {reason}")]
    CommitFailed { reason: String },
    #[error("diff failed: {reason}")]
    DiffFailed { reason: String },
    #[error("backend error: {reason}")]
    BackendError { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VcsType {
    Jj,
    Git,
}

pub trait VcsBackend {
    fn detect(repo_path: &Path) -> Result<VcsType, VcsError>;
    fn ensure_clean(repo_path: &Path) -> Result<(), VcsError>;
    fn head_commit(repo_path: &Path) -> Result<String, VcsError>;
    fn create_ref(repo_path: &Path, name: &str) -> Result<String, VcsError>;
    fn checkout_ref(repo_path: &Path, name: &str) -> Result<(), VcsError>;
    fn commit_all(repo_path: &Path, message: &str) -> Result<String, VcsError>;
    fn diff_range(repo_path: &Path, base: &str, head: &str) -> Result<Diff, VcsError>;
    fn delete_ref(repo_path: &Path, name: &str) -> Result<(), VcsError>;
}
