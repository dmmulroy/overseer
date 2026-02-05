use utoipa::OpenApi;

use crate::routes::agents::{CompleteSessionInput, RegisterAgentInput, StartSessionInput};
use crate::routes::events::EventsQuery;
use crate::routes::gates::GateListQuery;
use crate::routes::git_ai::GitAiReviewRequest;
use crate::routes::learnings::CreateLearningInput;
use crate::routes::repos::{RegisterRepoInput, RepoByPathQuery};
use crate::routes::tasks::{
    BlockerInput, NextReadyQuery, ProgressQuery, SetStatusInput, TreeQuery,
};
use crate::routes::vcs::TaskVcsQuery;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use os_core::types::enums::{
    CommentAuthor, DiffSide, GateStatus, HelpCategory, HelpRequestStatus, Priority, ReviewStatus,
    SessionStatus, TaskKind, TaskStatus, VcsType,
};
use os_core::types::gate::{Gate, GateResult, GateScope};
use os_core::types::git_ai::{GitAiReview, GitAiReviewOutput, GitAiReviewStatus};
use os_core::types::help::HelpRequest;
use os_core::types::ids::{
    AnyTaskId, CommentId, GateId, HelpRequestId, LearningId, MilestoneId, RepoId, ReviewId,
    SubtaskId, TaskId,
};
use os_core::types::io::{
    CreateCommentInput, CreateGateInput, CreateHelpRequestInput, CreateTaskInput,
    HelpResponseInput, RequestChangesInput, TaskFilter, UpdateGateInput, UpdateTaskInput,
};
use os_core::types::learning::{InheritedLearnings, Learning};
use os_core::types::repo::Repo;
use os_core::types::review::{Review, ReviewComment};
use os_core::types::session::{Harness, Session};
use os_core::types::task::{Task, TaskProgress, TaskTree, TaskWithContext};
use os_core::types::vcs::{Diff, TaskVcs};
use os_events::types::{EventRecord, EventSource};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::tasks::create_task,
        crate::routes::tasks::list_tasks,
        crate::routes::tasks::get_task,
        crate::routes::tasks::update_task,
        crate::routes::tasks::delete_task,
        crate::routes::tasks::start_task,
        crate::routes::tasks::submit_task,
        crate::routes::tasks::cancel_task,
        crate::routes::tasks::force_complete,
        crate::routes::tasks::set_status,
        crate::routes::tasks::add_blocker,
        crate::routes::tasks::remove_blocker,
        crate::routes::tasks::tree,
        crate::routes::tasks::progress,
        crate::routes::tasks::next_ready,
        crate::routes::reviews::get_review,
        crate::routes::reviews::get_active,
        crate::routes::reviews::list_reviews,
        crate::routes::reviews::add_comment,
        crate::routes::reviews::list_comments,
        crate::routes::reviews::resolve_comment,
        crate::routes::reviews::approve,
        crate::routes::reviews::request_changes,
        crate::routes::gates::add_gate,
        crate::routes::gates::list_gates,
        crate::routes::gates::effective_gates,
        crate::routes::gates::remove_gate,
        crate::routes::gates::update_gate,
        crate::routes::gates::results,
        crate::routes::gates::rerun,
        crate::routes::help::request_help,
        crate::routes::help::respond_help,
        crate::routes::help::resume_help,
        crate::routes::help::get_active,
        crate::routes::help::list_help,
        crate::routes::learnings::add_learning,
        crate::routes::learnings::list_learning,
        crate::routes::learnings::inherited,
        crate::routes::repos::register_repo,
        crate::routes::repos::get_repo,
        crate::routes::repos::get_by_path,
        crate::routes::repos::list_repos,
        crate::routes::repos::unregister_repo,
        crate::routes::vcs::get_task_vcs,
        crate::routes::vcs::list_task_vcs,
        crate::routes::vcs::archive,
        crate::routes::vcs::diff,
        crate::routes::events::list_events,
        crate::routes::events::replay,
        crate::routes::events::subscribe,
        crate::routes::events::stream,
        crate::routes::git_ai::run_review,
        crate::routes::git_ai::get_review,
        crate::routes::git_ai::get_result,
        crate::routes::agents::register_agent,
        crate::routes::agents::list_capabilities,
        crate::routes::agents::start_session,
        crate::routes::agents::heartbeat,
        crate::routes::agents::complete
    ),
    components(schemas(
        Task,
        TaskWithContext,
        TaskTree,
        TaskProgress,
        CreateTaskInput,
        UpdateTaskInput,
        TaskFilter,
        BlockerInput,
        SetStatusInput,
        ProgressQuery,
        NextReadyQuery,
        TreeQuery,
        Review,
        ReviewComment,
        CreateCommentInput,
        RequestChangesInput,
        Gate,
        GateScope,
        GateResult,
        CreateGateInput,
        UpdateGateInput,
        GateListQuery,
        HelpRequest,
        CreateHelpRequestInput,
        HelpResponseInput,
        Learning,
        InheritedLearnings,
        CreateLearningInput,
        Repo,
        RegisterRepoInput,
        RepoByPathQuery,
        TaskVcs,
        Diff,
        TaskVcsQuery,
        GitAiReview,
        GitAiReviewOutput,
        GitAiReviewStatus,
        GitAiReviewRequest,
        EventRecord,
        EventsQuery,
        Harness,
        Session,
        RegisterAgentInput,
        StartSessionInput,
        CompleteSessionInput,
        AnyTaskId,
        MilestoneId,
        TaskId,
        SubtaskId,
        RepoId,
        ReviewId,
        CommentId,
        GateId,
        HelpRequestId,
        LearningId,
        TaskKind,
        TaskStatus,
        Priority,
        ReviewStatus,
        GateStatus,
        HelpCategory,
        HelpRequestStatus,
        CommentAuthor,
        DiffSide,
        VcsType,
        SessionStatus,
        EventSource
    ))
)]
struct ApiDoc;

pub fn generate_spec() -> String {
    ApiDoc::openapi()
        .to_json()
        .unwrap_or_else(|_| "{}".to_string())
}

pub fn ensure_initialized() {
    let _ = ApiDoc::openapi();
}

pub fn router() -> Router {
    Router::new()
        .route("/openapi.json", get(openapi_json))
        .route("/docs", get(swagger_ui))
}

async fn openapi_json() -> impl IntoResponse {
    Json(ApiDoc::openapi())
}

async fn swagger_ui() -> impl IntoResponse {
    let html = r#"<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\">
    <title>Overseer API Docs</title>
    <link rel=\"stylesheet\" href=\"https://unpkg.com/swagger-ui-dist@5/swagger-ui.css\">
  </head>
  <body>
    <div id=\"swagger-ui\"></div>
    <script src=\"https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js\"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });
    </script>
  </body>
</html>
"#;
    (axum::http::StatusCode::OK, html)
}
