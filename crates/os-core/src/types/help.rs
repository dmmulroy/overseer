use crate::types::enums::{HelpCategory, HelpRequestStatus, TaskStatus};
use crate::types::ids::{AnyTaskId, HelpRequestId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct HelpRequest {
    pub id: HelpRequestId,
    pub task_id: AnyTaskId,
    pub from_status: TaskStatus,
    pub category: HelpCategory,
    pub reason: String,
    pub suggested_options: Vec<String>,
    pub status: HelpRequestStatus,
    pub response: Option<String>,
    pub chosen_option: Option<usize>,
    pub created_at: DateTime<Utc>,
    pub responded_at: Option<DateTime<Utc>>,
    pub resumed_at: Option<DateTime<Utc>>,
}
