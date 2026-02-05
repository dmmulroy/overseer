use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::git_ai::{GitAiReview, GitAiReviewOutput};
use os_core::types::ReviewId;
use os_events::types::EventSource;
use utoipa::ToSchema;

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct GitAiReviewRequest {
    review_id: ReviewId,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/git-ai/review", post(run_review))
        .route("/git-ai/review/:id", get(get_review))
        .route("/git-ai/review/:id/result", get(get_result))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/git-ai/review",
    request_body = GitAiReviewRequest,
    responses((status = 200, body = GitAiReview))
)]
pub(crate) async fn run_review(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<GitAiReviewRequest>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.git_ai().review(&ctx, &input.review_id) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/git-ai/review/{id}",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Option<GitAiReview>))
)]
pub(crate) async fn get_review(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::GitAi(os_core::error::GitAiError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.git_ai().get(&review_id) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/git-ai/review/{id}/result",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Option<GitAiReviewOutput>))
)]
pub(crate) async fn get_result(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::GitAi(os_core::error::GitAiError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.git_ai().result(&review_id) {
        Ok(result) => Json(result).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}
