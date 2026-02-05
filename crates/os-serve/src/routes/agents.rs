use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::SessionStatus;
use os_core::types::session::{Harness, Session};
use os_events::types::EventSource;
use utoipa::ToSchema;

#[derive(Debug, serde::Deserialize, ToSchema, utoipa::IntoParams)]
pub struct RegisterAgentInput {
    harness_id: String,
    capabilities: Vec<String>,
}

#[derive(Debug, serde::Deserialize, ToSchema, utoipa::IntoParams)]
pub struct StartSessionInput {
    task_id: String,
    harness_id: String,
}

#[derive(Debug, serde::Deserialize, ToSchema, utoipa::IntoParams)]
pub struct CompleteSessionInput {
    status: SessionStatus,
    error: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/agents/register", post(register_agent))
        .route("/agents/capabilities", get(list_capabilities))
        .route("/sessions", post(start_session))
        .route("/sessions/:id/heartbeat", post(heartbeat))
        .route("/sessions/:id/complete", post(complete))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/agents/register",
    request_body = RegisterAgentInput,
    responses((status = 200, body = Harness))
)]
pub(crate) async fn register_agent(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<RegisterAgentInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer
        .sessions()
        .register_harness(&ctx, input.harness_id, input.capabilities)
    {
        Ok(harness) => Json(harness).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/agents/capabilities",
    responses((status = 200, body = Vec<Harness>))
)]
pub(crate) async fn list_capabilities(State(state): State<AppState>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.sessions().list_harnesses() {
        Ok(harnesses) => Json(harnesses).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/sessions",
    request_body = StartSessionInput,
    responses((status = 200, body = Session))
)]
pub(crate) async fn start_session(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<StartSessionInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match os_core::types::AnyTaskId::parse(&input.task_id) {
        Ok(id) => id,
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
        .sessions()
        .start_session(&ctx, &task_id, input.harness_id)
    {
        Ok(session) => Json(session).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/sessions/{id}/heartbeat",
    params(("id" = String, Path, description = "Session ID")),
    responses((status = 200, body = Session))
)]
pub(crate) async fn heartbeat(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.sessions().heartbeat(&ctx, &id) {
        Ok(session) => Json(session).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/sessions/{id}/complete",
    params(("id" = String, Path, description = "Session ID")),
    request_body = CompleteSessionInput,
    responses((status = 200, body = Session))
)]
pub(crate) async fn complete(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<CompleteSessionInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer
        .sessions()
        .complete(&ctx, &id, input.status, input.error)
    {
        Ok(session) => Json(session).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}
