use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::io::{CreateHelpRequestInput, HelpResponseInput};
use os_core::types::help::HelpRequest;
use os_core::types::task::Task;
use os_core::types::{AnyTaskId, HelpRequestId};
use os_events::types::EventSource;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/help", post(request_help))
        .route("/help/:id/respond", post(respond_help))
        .route("/help/:id/resume", post(resume_help))
        .route("/help/active/:id", get(get_active))
        .route("/help/:id", get(list_help))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/help",
    request_body = CreateHelpRequestInput,
    responses((status = 200, body = HelpRequest))
)]
pub(crate) async fn request_help(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<CreateHelpRequestInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.help().request(&ctx, input) {
        Ok(request) => Json(request).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/help/{id}/respond",
    params(("id" = String, Path, description = "Help ID")),
    request_body = HelpResponseInput,
    responses((status = 200, body = HelpRequest))
)]
pub(crate) async fn respond_help(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<HelpResponseInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let help_id = match HelpRequestId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Help(os_core::error::HelpError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.help().respond(&ctx, &help_id, input) {
        Ok(help) => Json(help).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/help/{id}/resume",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Task))
)]
pub(crate) async fn resume_help(
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
                &os_core::OverseerError::Help(os_core::error::HelpError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.help().resume(&ctx, &task_id) {
        Ok(task) => Json(task).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/help/active/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Option<HelpRequest>))
)]
pub(crate) async fn get_active(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Help(os_core::error::HelpError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.help().get_active(&task_id) {
        Ok(help) => Json(help).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/help/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Vec<HelpRequest>))
)]
pub(crate) async fn list_help(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Help(os_core::error::HelpError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.help().list(&task_id) {
        Ok(help) => Json(help).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}
