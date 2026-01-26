use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::learning_repo::Learning;
use crate::id::TaskId;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub own: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedLearnings {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub milestone: Vec<Learning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parent: Vec<Learning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: TaskId,
    pub parent_id: Option<TaskId>,
    pub description: String,
    #[serde(default, skip_serializing)]
    pub context: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_chain: Option<TaskContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub learnings: Option<InheritedLearnings>,
    pub result: Option<String>,
    pub priority: i32,
    pub completed: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<TaskId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct CreateTaskInput {
    pub description: String,
    pub context: Option<String>,
    pub parent_id: Option<TaskId>,
    pub priority: Option<i32>,
    pub blocked_by: Vec<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<i32>,
    pub parent_id: Option<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct ListTasksFilter {
    pub parent_id: Option<TaskId>,
    pub ready: bool,
    pub completed: Option<bool>,
}
