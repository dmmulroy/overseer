use crate::types::enums::SessionStatus;
use crate::types::ids::AnyTaskId;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Session {
    pub id: String,
    pub task_id: AnyTaskId,
    pub harness_id: String,
    pub status: SessionStatus,
    pub started_at: DateTime<Utc>,
    pub last_heartbeat_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Harness {
    pub id: String,
    pub capabilities: Vec<String>,
    pub connected: bool,
    pub last_seen_at: DateTime<Utc>,
}
