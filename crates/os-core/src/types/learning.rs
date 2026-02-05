use crate::types::ids::{AnyTaskId, LearningId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Learning {
    pub id: LearningId,
    pub task_id: AnyTaskId,
    pub content: String,
    pub source_task_id: Option<AnyTaskId>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InheritedLearnings {
    pub own: Vec<Learning>,
    pub parent: Vec<Learning>,
    pub milestone: Vec<Learning>,
}
