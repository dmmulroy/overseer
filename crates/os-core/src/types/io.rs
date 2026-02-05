use crate::types::enums::{CommentAuthor, DiffSide};
use crate::types::enums::{HelpCategory, Priority, TaskKind, TaskStatus};
use crate::types::gate::GateScope;
use crate::types::ids::{AnyTaskId, RepoId, ReviewId};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreateTaskInput {
    pub repo_id: RepoId,
    pub parent_id: Option<AnyTaskId>,
    pub kind: TaskKind,
    pub description: String,
    pub context: Option<String>,
    pub priority: Option<Priority>,
    pub blocked_by: Vec<AnyTaskId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<Priority>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, IntoParams)]
pub struct TaskFilter {
    pub repo_id: Option<RepoId>,
    pub parent_id: Option<Option<AnyTaskId>>,
    pub kind: Option<Vec<TaskKind>>,
    pub status: Option<Vec<TaskStatus>>,
    pub ready: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreateGateInput {
    pub scope: GateScope,
    pub name: String,
    pub command: String,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub poll_interval_secs: Option<u32>,
    pub max_pending_secs: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UpdateGateInput {
    pub command: Option<String>,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub poll_interval_secs: Option<u32>,
    pub max_pending_secs: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreateHelpRequestInput {
    pub task_id: AnyTaskId,
    pub category: HelpCategory,
    pub reason: String,
    pub suggested_options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct HelpResponseInput {
    pub response: String,
    pub chosen_option: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CreateCommentInput {
    pub review_id: ReviewId,
    pub task_id: AnyTaskId,
    pub author: CommentAuthor,
    pub file_path: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub side: DiffSide,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RequestChangesInput {
    pub review_id: ReviewId,
    pub comments: Vec<CreateCommentInput>,
    pub summary: Option<String>,
}
