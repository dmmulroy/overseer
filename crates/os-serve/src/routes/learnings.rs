use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::learning::{InheritedLearnings, Learning};
use os_core::types::AnyTaskId;
use os_events::types::EventSource;
use utoipa::ToSchema;

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct CreateLearningInput {
    content: String,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/learnings/:id", post(add_learning).get(list_learning))
        .route("/learnings/:id/inherited", get(inherited))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/learnings/{id}",
    params(("id" = String, Path, description = "Task ID")),
    request_body = CreateLearningInput,
    responses((status = 200, body = Learning))
)]
pub(crate) async fn add_learning(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<CreateLearningInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Learning(os_core::error::LearningError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.learnings().add(&ctx, &task_id, input.content) {
        Ok(learning) => Json(learning).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/learnings/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Vec<Learning>))
)]
pub(crate) async fn list_learning(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Learning(os_core::error::LearningError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.learnings().list(&task_id) {
        Ok(list) => Json(list).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/learnings/{id}/inherited",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = InheritedLearnings))
)]
pub(crate) async fn inherited(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Learning(os_core::error::LearningError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.learnings().inherited(&task_id) {
        Ok(list) => Json(list).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}
