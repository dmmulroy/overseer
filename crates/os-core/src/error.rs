use crate::types::enums::{ReviewStatus, TaskStatus};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("task not found")]
    NotFound,
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    #[error("cycle detected")]
    CycleDetected,
    #[error("self block not allowed")]
    SelfBlock,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    #[error("conflict: {message}")]
    Conflict { message: String },
}

#[derive(Debug, Error)]
pub enum ReviewError {
    #[error("review not found")]
    ReviewNotFound,
    #[error("comment not found")]
    CommentNotFound,
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: ReviewStatus,
        to: ReviewStatus,
    },
    #[error("task not in review")]
    TaskNotInReview,
    #[error("gate not passed")]
    GateNotPassed,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
}

#[derive(Debug, Error)]
pub enum GateError {
    #[error("gate not found")]
    GateNotFound,
    #[error("name already exists")]
    NameConflict,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    #[error("review active in scope")]
    ReviewActive,
}

#[derive(Debug, Error)]
pub enum HelpError {
    #[error("help request not found")]
    HelpNotFound,
    #[error("invalid state: {message}")]
    InvalidState { message: String },
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
}

#[derive(Debug, Error)]
pub enum LearningError {
    #[error("learning not found")]
    LearningNotFound,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
}

#[derive(Debug, Error)]
pub enum RepoError {
    #[error("repo not found")]
    RepoNotFound,
    #[error("repo already registered")]
    RepoExists,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
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

#[derive(Debug, Error)]
pub enum GitAiError {
    #[error("provider unavailable")]
    ProviderUnavailable,
    #[error("invalid input: {message}")]
    InvalidInput { message: String },
    #[error("timeout")]
    Timeout,
    #[error("internal error: {message}")]
    Internal { message: String },
}

impl From<os_vcs::backend::VcsError> for VcsError {
    fn from(value: os_vcs::backend::VcsError) -> Self {
        match value {
            os_vcs::backend::VcsError::RepoNotFound => Self::RepoNotFound,
            os_vcs::backend::VcsError::DirtyWorkingCopy => Self::DirtyWorkingCopy,
            os_vcs::backend::VcsError::RefAlreadyExists { name } => Self::RefAlreadyExists { name },
            os_vcs::backend::VcsError::RefNotFound { name } => Self::RefNotFound { name },
            os_vcs::backend::VcsError::CommitFailed { reason } => Self::CommitFailed { reason },
            os_vcs::backend::VcsError::DiffFailed { reason } => Self::DiffFailed { reason },
            os_vcs::backend::VcsError::BackendError { reason } => Self::BackendError { reason },
        }
    }
}

#[derive(Debug, Error)]
pub enum OverseerError {
    #[error(transparent)]
    Task(#[from] TaskError),
    #[error(transparent)]
    Review(#[from] ReviewError),
    #[error(transparent)]
    Gate(#[from] GateError),
    #[error(transparent)]
    Help(#[from] HelpError),
    #[error(transparent)]
    Learning(#[from] LearningError),
    #[error(transparent)]
    Repo(#[from] RepoError),
    #[error(transparent)]
    Vcs(#[from] VcsError),
    #[error(transparent)]
    GitAi(#[from] GitAiError),
    #[error("internal error: {message}")]
    Internal { message: String },
}

impl From<os_vcs::backend::VcsError> for OverseerError {
    fn from(value: os_vcs::backend::VcsError) -> Self {
        OverseerError::Vcs(VcsError::from(value))
    }
}
