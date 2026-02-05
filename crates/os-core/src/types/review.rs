use crate::types::enums::{CommentAuthor, DiffSide, ReviewStatus};
use crate::types::ids::{AnyTaskId, CommentId, ReviewId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Review {
    pub id: ReviewId,
    pub task_id: AnyTaskId,
    pub status: ReviewStatus,
    pub submitted_at: DateTime<Utc>,
    pub gates_completed_at: Option<DateTime<Utc>>,
    pub agent_completed_at: Option<DateTime<Utc>>,
    pub human_completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReviewComment {
    pub id: CommentId,
    pub review_id: ReviewId,
    pub task_id: AnyTaskId,
    pub author: CommentAuthor,
    pub file_path: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub side: DiffSide,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}
