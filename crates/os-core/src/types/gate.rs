use crate::types::enums::GateStatus;
use crate::types::ids::{AnyTaskId, GateId, RepoId, ReviewId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Gate {
    pub id: GateId,
    pub scope: GateScope,
    pub name: String,
    pub command: String,
    pub timeout_secs: u32,
    pub max_retries: u32,
    pub poll_interval_secs: u32,
    pub max_pending_secs: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", content = "id", rename_all = "PascalCase")]
pub enum GateScope {
    Repo(RepoId),
    Task(AnyTaskId),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GateResult {
    pub gate_id: GateId,
    pub task_id: AnyTaskId,
    pub review_id: ReviewId,
    pub status: GateStatus,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub attempt: u32,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}
