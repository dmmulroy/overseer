use axum::http::StatusCode;
use axum::Json;
use os_core::error::{
    GateError, GitAiError, HelpError, LearningError, OverseerError, RepoError, ReviewError,
    TaskError, VcsError,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ErrorEnvelope {
    pub code: &'static str,
    pub message: String,
    pub correlation_id: Option<String>,
}

pub fn map_error(
    err: &OverseerError,
    correlation_id: Option<String>,
) -> (StatusCode, Json<ErrorEnvelope>) {
    let (status, code, message) = match err {
        OverseerError::Task(task) => map_task_error(task),
        OverseerError::Review(review) => map_review_error(review),
        OverseerError::Gate(gate) => map_gate_error(gate),
        OverseerError::GitAi(git_ai) => map_git_ai_error(git_ai),
        OverseerError::Help(help) => map_help_error(help),
        OverseerError::Learning(learning) => map_learning_error(learning),
        OverseerError::Repo(repo) => map_repo_error(repo),
        OverseerError::Vcs(vcs) => map_vcs_error(vcs),
        OverseerError::Internal { message } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            message.clone(),
        ),
    };

    (
        status,
        Json(ErrorEnvelope {
            code,
            message,
            correlation_id,
        }),
    )
}

fn map_task_error(err: &TaskError) -> (StatusCode, &'static str, String) {
    match err {
        TaskError::NotFound => (StatusCode::NOT_FOUND, "not_found", err.to_string()),
        TaskError::InvalidTransition { .. } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_state",
            err.to_string(),
        ),
        TaskError::CycleDetected | TaskError::SelfBlock => {
            (StatusCode::CONFLICT, "conflict", err.to_string())
        }
        TaskError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
        TaskError::Conflict { .. } => (StatusCode::CONFLICT, "conflict", err.to_string()),
    }
}

fn map_review_error(err: &ReviewError) -> (StatusCode, &'static str, String) {
    match err {
        ReviewError::ReviewNotFound | ReviewError::CommentNotFound => {
            (StatusCode::NOT_FOUND, "not_found", err.to_string())
        }
        ReviewError::InvalidTransition { .. } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_state",
            err.to_string(),
        ),
        ReviewError::TaskNotInReview | ReviewError::GateNotPassed => (
            StatusCode::PRECONDITION_FAILED,
            "precondition_failed",
            err.to_string(),
        ),
        ReviewError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
    }
}

fn map_gate_error(err: &GateError) -> (StatusCode, &'static str, String) {
    match err {
        GateError::GateNotFound => (StatusCode::NOT_FOUND, "not_found", err.to_string()),
        GateError::NameConflict => (StatusCode::CONFLICT, "conflict", err.to_string()),
        GateError::ReviewActive => (
            StatusCode::PRECONDITION_FAILED,
            "precondition_failed",
            err.to_string(),
        ),
        GateError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
    }
}

fn map_help_error(err: &HelpError) -> (StatusCode, &'static str, String) {
    match err {
        HelpError::HelpNotFound => (StatusCode::NOT_FOUND, "not_found", err.to_string()),
        HelpError::InvalidState { .. } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_state",
            err.to_string(),
        ),
        HelpError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
    }
}

fn map_learning_error(err: &LearningError) -> (StatusCode, &'static str, String) {
    match err {
        LearningError::LearningNotFound => (StatusCode::NOT_FOUND, "not_found", err.to_string()),
        LearningError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
    }
}

fn map_repo_error(err: &RepoError) -> (StatusCode, &'static str, String) {
    match err {
        RepoError::RepoNotFound => (StatusCode::NOT_FOUND, "not_found", err.to_string()),
        RepoError::RepoExists => (StatusCode::CONFLICT, "conflict", err.to_string()),
        RepoError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
    }
}

fn map_vcs_error(err: &VcsError) -> (StatusCode, &'static str, String) {
    match err {
        VcsError::RepoNotFound | VcsError::RefNotFound { .. } => {
            (StatusCode::NOT_FOUND, "not_found", err.to_string())
        }
        VcsError::DirtyWorkingCopy | VcsError::CommitFailed { .. } => (
            StatusCode::PRECONDITION_FAILED,
            "precondition_failed",
            err.to_string(),
        ),
        VcsError::RefAlreadyExists { .. } => (StatusCode::CONFLICT, "conflict", err.to_string()),
        VcsError::DiffFailed { .. } | VcsError::BackendError { .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            err.to_string(),
        ),
    }
}

fn map_git_ai_error(err: &GitAiError) -> (StatusCode, &'static str, String) {
    match err {
        GitAiError::ProviderUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "provider_unavailable",
            err.to_string(),
        ),
        GitAiError::InvalidInput { .. } => {
            (StatusCode::BAD_REQUEST, "invalid_input", err.to_string())
        }
        GitAiError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "timeout", err.to_string()),
        GitAiError::Internal { .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            err.to_string(),
        ),
    }
}
