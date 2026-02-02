use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum VcsError {
    #[error("Not a repository")]
    NotARepository,

    #[error("No working copy")]
    NoWorkingCopy,

    #[error("Operation failed: {0}")]
    OperationFailed(String),

    #[error("Nothing to commit")]
    NothingToCommit,

    #[error("Bookmark not found: {0}")]
    BookmarkNotFound(String),

    #[error("Bookmark already exists: {0}")]
    BookmarkExists(String),

    #[error("Target not found: {0}")]
    TargetNotFound(String),

    #[error("Working copy has uncommitted changes")]
    DirtyWorkingCopy,

    #[error("JJ error: {0}")]
    Jj(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type VcsResult<T> = Result<T, VcsError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VcsType {
    Jj,
    Git,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsInfo {
    #[serde(rename = "type")]
    pub vcs_type: VcsType,
    pub root: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub status: FileStatusKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsStatus {
    pub files: Vec<FileStatus>,
    pub working_copy_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub description: String,
    pub author: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub path: String,
    pub change_type: ChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub id: String,
    pub message: String,
}

/// VCS backend trait - implemented by jj (primary) and git (fallback).
pub trait VcsBackend: Send + Sync {
    /// Returns the VCS type (used in tests for backend verification)
    #[allow(dead_code)]
    fn vcs_type(&self) -> VcsType;
    /// Returns the repository root path (used in tests)
    #[allow(dead_code)]
    fn root(&self) -> &str;
    fn status(&self) -> VcsResult<VcsStatus>;
    fn log(&self, limit: usize) -> VcsResult<Vec<LogEntry>>;
    fn diff(&self, base: Option<&str>) -> VcsResult<Vec<DiffEntry>>;
    fn commit(&self, message: &str) -> VcsResult<CommitResult>;
    fn current_commit_id(&self) -> VcsResult<String>;

    // Bookmark/branch management
    fn create_bookmark(&self, name: &str, target: Option<&str>) -> VcsResult<()>;
    fn delete_bookmark(&self, name: &str) -> VcsResult<()>;
    fn list_bookmarks(&self, prefix: Option<&str>) -> VcsResult<Vec<String>>;

    // Navigation
    fn checkout(&self, target: &str) -> VcsResult<()>;

    // Working copy safety
    fn is_clean(&self) -> VcsResult<bool> {
        self.status().map(|s| s.files.is_empty())
    }
}
