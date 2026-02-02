use thiserror::Error;

use crate::id::{LearningId, TaskId};
use crate::vcs::VcsError;

/// Reason why a task cannot be started
#[derive(Debug, Clone)]
pub enum NotReadyReason {
    /// Task has incomplete children - must start the next ready child
    HasIncompleteChildren,
    /// Task is blocked by other tasks (blockers field used for diagnostics/tests)
    #[allow(dead_code)]
    Blocked { blockers: Vec<TaskId> },
    /// No ready tasks in subtree (all complete or blocked)
    NoReadyTasksInSubtree,
}

#[derive(Error, Debug)]
pub enum OsError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Task not found: {0}")]
    TaskNotFound(TaskId),

    #[error("Parent task not found: {0}")]
    ParentNotFound(TaskId),

    #[error("Blocker task not found: {0}")]
    BlockerNotFound(TaskId),

    #[error("Learning not found: {0}")]
    LearningNotFound(LearningId),

    #[error("Maximum depth exceeded: subtasks cannot have children")]
    MaxDepthExceeded,

    #[error("Cycle detected in parent chain")]
    ParentCycle,

    #[error("Cycle detected in blocker chain")]
    BlockerCycle,

    /// Cycle detected while following blockers during start resolution
    #[error("{message}")]
    BlockerCycleDetected { message: String, chain: Vec<TaskId> },

    /// No startable task found after exhausting all paths
    #[error("{message}")]
    NoStartableTask { message: String, requested: TaskId },

    /// Task cannot be started - not the next ready task
    #[error("{message}")]
    NotNextReady {
        message: String,
        requested: TaskId,
        next_ready: Option<TaskId>,
        reason: NotReadyReason,
    },

    /// Invalid blocker relation (self, ancestor, or descendant)
    #[error("{message}")]
    InvalidBlockerRelation {
        message: String,
        task_id: TaskId,
        blocker_id: TaskId,
    },

    #[error("Cannot complete task with pending children")]
    PendingChildren,

    #[error("Invalid priority: {0} (must be 1-5)")]
    InvalidPriority(i32),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Not in a repository - run `jj init` or `git init`")]
    NotARepository,

    #[error("Working copy has uncommitted changes - commit or stash first")]
    DirtyWorkingCopy,

    #[error("VCS error: {0}")]
    Vcs(VcsError),
}

impl From<VcsError> for OsError {
    fn from(err: VcsError) -> Self {
        match err {
            VcsError::NotARepository => OsError::NotARepository,
            VcsError::DirtyWorkingCopy => OsError::DirtyWorkingCopy,
            other => OsError::Vcs(other),
        }
    }
}

pub type Result<T> = std::result::Result<T, OsError>;
