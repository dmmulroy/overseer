use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::vcs::{Diff, TaskVcs};
use os_core::types::{AnyTaskId, RepoId};
use os_events::types::EventSource;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct TaskVcsQuery {
    repo_id: RepoId,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/vcs/task/:id", get(get_task_vcs))
        .route("/vcs/task", get(list_task_vcs))
        .route("/vcs/task/:id/archive", post(archive))
        .route("/vcs/diff/:id", get(diff))
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/api/vcs/task/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = TaskVcs))
)]
pub(crate) async fn get_task_vcs(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Vcs(os_core::error::VcsError::BackendError {
                    reason: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.vcs().get_task_vcs(&task_id) {
        Ok(vcs) => Json(vcs).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/vcs/task",
    params(TaskVcsQuery),
    responses((status = 200, body = Vec<TaskVcs>))
)]
pub(crate) async fn list_task_vcs(State(state): State<AppState>, Query(query): Query<TaskVcsQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.vcs().list_task_vcs(&query.repo_id) {
        Ok(vcs) => Json(vcs).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/vcs/task/{id}/archive",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = TaskVcs))
)]
pub(crate) async fn archive(
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
                &os_core::OverseerError::Vcs(os_core::error::VcsError::BackendError {
                    reason: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.vcs().archive(&ctx, &task_id) {
        Ok(vcs) => Json(vcs).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/vcs/diff/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Diff))
)]
pub(crate) async fn diff(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Vcs(os_core::error::VcsError::BackendError {
                    reason: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.vcs().diff(&task_id) {
        Ok(diff) => Json(diff).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}
