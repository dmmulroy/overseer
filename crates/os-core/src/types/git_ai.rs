use crate::types::enums::ReviewDecision;
use crate::types::gate::GateResult;
use crate::types::ids::{AnyTaskId, ReviewId};
use crate::types::io::CreateCommentInput;
use crate::types::learning::InheritedLearnings;
use crate::types::task::TaskContext;
use crate::types::vcs::Diff;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GitAiReviewInput {
    pub task_id: AnyTaskId,
    pub review_id: ReviewId,
    pub diff: Diff,
    pub task_context: TaskContext,
    pub learnings: InheritedLearnings,
    pub gate_results: Vec<GateResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GitAiReviewOutput {
    pub decision: ReviewDecision,
    pub comments: Vec<CreateCommentInput>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "PascalCase")]
pub enum GitAiReviewStatus {
    Pending,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GitAiReview {
    pub review_id: ReviewId,
    pub task_id: AnyTaskId,
    pub status: GitAiReviewStatus,
    pub input: GitAiReviewInput,
    pub output: Option<GitAiReviewOutput>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
