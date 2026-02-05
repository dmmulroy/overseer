use crate::types::{
    AnyTaskId, Gate, GateId, GateResult, HelpRequest, Learning, Repo, RepoId, Review,
    ReviewComment, ReviewId, Task, TaskStatus,
};
use chrono::{DateTime, Utc};
use os_events::types::EventSource;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Event {
    pub id: String,
    pub seq: i64,
    pub at: DateTime<Utc>,
    pub correlation_id: Option<String>,
    pub source: EventSource,
    pub body: EventBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", content = "payload")]
pub enum EventBody {
    TaskCreated {
        task: Task,
    },
    TaskUpdated {
        task: Task,
    },
    TaskStarted {
        task: Task,
    },
    TaskSubmitted {
        task: Task,
        review_id: ReviewId,
    },
    TaskCompleted {
        task: Task,
    },
    TaskCancelled {
        task: Task,
    },
    TaskDeleted {
        task_id: AnyTaskId,
    },
    TaskStatusChanged {
        task: Task,
        from: TaskStatus,
        to: TaskStatus,
    },

    ReviewCreated {
        review: Review,
    },
    CommentAdded {
        comment: ReviewComment,
    },
    CommentResolved {
        comment: ReviewComment,
    },
    ChangesRequested {
        review: Review,
        comments: Vec<ReviewComment>,
    },
    ReviewApproved {
        review: Review,
    },

    GateAdded {
        gate: Gate,
    },
    GateUpdated {
        gate: Gate,
    },
    GateRemoved {
        gate_id: GateId,
    },
    GateStarted {
        gate_id: GateId,
        task_id: AnyTaskId,
        review_id: ReviewId,
    },
    GatePassed {
        gate_id: GateId,
        result: GateResult,
    },
    GateFailed {
        gate_id: GateId,
        result: GateResult,
    },
    GateEscalated {
        gate_id: GateId,
        result: GateResult,
    },

    HelpRequested {
        help_request: HelpRequest,
    },
    HelpResponded {
        help_request: HelpRequest,
    },
    HelpResumed {
        task: Task,
        help_request: HelpRequest,
    },

    RefCreated {
        task_id: AnyTaskId,
        ref_name: String,
    },
    Committed {
        task_id: AnyTaskId,
        rev: String,
    },
    TaskArchived {
        task_id: AnyTaskId,
    },

    HarnessConnected {
        harness_id: String,
    },
    HarnessDisconnected {
        harness_id: String,
    },
    SessionStarted {
        session_id: String,
        task_id: AnyTaskId,
        harness_id: String,
    },
    SessionCompleted {
        session_id: String,
    },
    SessionFailed {
        session_id: String,
        error: String,
    },

    BlockerAdded {
        task_id: AnyTaskId,
        blocker_id: AnyTaskId,
    },
    BlockerRemoved {
        task_id: AnyTaskId,
        blocker_id: AnyTaskId,
    },

    LearningAdded {
        learning: Learning,
    },
    LearningBubbled {
        from: AnyTaskId,
        to: AnyTaskId,
    },

    RepoRegistered {
        repo: Repo,
    },
    RepoUnregistered {
        repo_id: RepoId,
    },

    GitAiStarted {
        task_id: AnyTaskId,
        review_id: ReviewId,
    },
    GitAiCompleted {
        task_id: AnyTaskId,
        review_id: ReviewId,
    },
    GitAiFailed {
        task_id: AnyTaskId,
        review_id: ReviewId,
        error: String,
    },
}
