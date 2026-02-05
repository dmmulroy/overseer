use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::io::{CreateTaskInput, TaskFilter, UpdateTaskInput};
use os_core::types::task::{Task, TaskProgress, TaskTree, TaskWithContext};
use os_core::types::{AnyTaskId, MilestoneId, RepoId, TaskStatus};
use os_events::types::EventSource;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct BlockerInput {
    blocker_id: AnyTaskId,
}

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct SetStatusInput {
    status: TaskStatus,
}

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct ProgressQuery {
    repo_id: RepoId,
    root_id: Option<AnyTaskId>,
}

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct NextReadyQuery {
    repo_id: RepoId,
    milestone_id: Option<MilestoneId>,
}

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct TreeQuery {
    root_id: Option<AnyTaskId>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/tasks", post(create_task).get(list_tasks))
        .route(
            "/tasks/:id",
            get(get_task).patch(update_task).delete(delete_task),
        )
        .route("/tasks/:id/start", post(start_task))
        .route("/tasks/:id/submit", post(submit_task))
        .route("/tasks/:id/cancel", post(cancel_task))
        .route("/tasks/:id/force-complete", post(force_complete))
        .route("/tasks/:id/set-status", post(set_status))
        .route("/tasks/:id/block", post(add_blocker))
        .route("/tasks/:id/unblock", post(remove_blocker))
        .route("/tasks/tree", get(tree))
        .route("/tasks/progress", get(progress))
        .route("/tasks/next-ready", get(next_ready))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/tasks",
    request_body = CreateTaskInput,
    responses((status = 200, body = Task))
)]
pub(crate) async fn create_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<CreateTaskInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().create(&ctx, input) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks",
    params(TaskFilter),
    responses((status = 200, body = Vec<Task>))
)]
pub(crate) async fn list_tasks(
    State(state): State<AppState>,
    Query(filter): Query<TaskFilter>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.tasks().list(filter) {
        Ok(tasks) => Json(tasks).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = TaskWithContext))
)]
pub(crate) async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.tasks().get(&task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    patch,
    path = "/api/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    request_body = UpdateTaskInput,
    responses((status = 200, body = Task))
)]
pub(crate) async fn update_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<UpdateTaskInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().update(&ctx, &task_id, input) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    delete,
    path = "/api/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200))
)]
pub(crate) async fn delete_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().delete(&ctx, &task_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/start",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Task))
)]
pub(crate) async fn start_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().start(&ctx, &task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/submit",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Task))
)]
pub(crate) async fn submit_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().submit(&ctx, &task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/cancel",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Task))
)]
pub(crate) async fn cancel_task(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().cancel(&ctx, &task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/force-complete",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Task))
)]
pub(crate) async fn force_complete(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().force_complete(&ctx, &task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/set-status",
    params(("id" = String, Path, description = "Task ID")),
    request_body = SetStatusInput,
    responses((status = 200, body = Task))
)]
pub(crate) async fn set_status(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<SetStatusInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.tasks().set_status(&ctx, &task_id, input.status) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/block",
    params(("id" = String, Path, description = "Task ID")),
    request_body = BlockerInput,
    responses((status = 200))
)]
pub(crate) async fn add_blocker(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<BlockerInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer
        .tasks()
        .add_blocker(&ctx, &task_id, &input.blocker_id)
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/unblock",
    params(("id" = String, Path, description = "Task ID")),
    request_body = BlockerInput,
    responses((status = 200))
)]
pub(crate) async fn remove_blocker(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<BlockerInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer
        .tasks()
        .remove_blocker(&ctx, &task_id, &input.blocker_id)
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/tree",
    params(TreeQuery),
    responses((status = 200, body = TaskTree))
)]
pub(crate) async fn tree(State(state): State<AppState>, Query(query): Query<TreeQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.tasks().tree(query.root_id.as_ref()) {
        Ok(tree) => Json(tree).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/progress",
    params(ProgressQuery),
    responses((status = 200, body = TaskProgress))
)]
pub(crate) async fn progress(State(state): State<AppState>, Query(query): Query<ProgressQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.tasks().progress(&query.repo_id, query.root_id.as_ref()) {
        Ok(progress) => Json(progress).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/next-ready",
    params(NextReadyQuery),
    responses((status = 200, body = Option<TaskWithContext>))
)]
pub(crate) async fn next_ready(State(state): State<AppState>, Query(query): Query<NextReadyQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer
        .tasks()
        .next_ready(&query.repo_id, query.milestone_id.as_ref())
    {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}
