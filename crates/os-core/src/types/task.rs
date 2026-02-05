use crate::types::enums::{Priority, TaskKind, TaskStatus};
use crate::types::gate::Gate;
use crate::types::help::HelpRequest;
use crate::types::ids::{AnyTaskId, RepoId};
use crate::types::learning::InheritedLearnings;
use crate::types::review::Review;
use crate::types::vcs::TaskVcs;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Task {
    pub id: AnyTaskId,
    pub repo_id: RepoId,
    pub parent_id: Option<AnyTaskId>,
    pub kind: TaskKind,
    pub description: String,
    pub context: Option<String>,
    pub priority: Priority,
    pub status: TaskStatus,
    pub blocked_by: Vec<AnyTaskId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TaskTree {
    pub task: Task,
    pub children: Vec<TaskTree>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TaskContext {
    pub own: Option<String>,
    pub parent: Option<String>,
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TaskWithContext {
    pub task: Task,
    pub context: TaskContext,
    pub learnings: InheritedLearnings,
    pub gates: Vec<Gate>,
    pub vcs: Option<TaskVcs>,
    pub review: Option<Review>,
    pub help_request: Option<HelpRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TaskProgress {
    pub total: u32,
    pub completed: u32,
    pub ready: u32,
    pub blocked: u32,
    pub in_progress: u32,
    pub in_review: u32,
    pub awaiting_human: u32,
}
