use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::io::{CreateCommentInput, RequestChangesInput};
use os_core::types::review::{Review, ReviewComment};
use os_core::types::{AnyTaskId, CommentId, ReviewId};
use os_events::types::EventSource;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/reviews/:id", get(get_review))
        .route("/tasks/:id/reviews/active", get(get_active))
        .route("/tasks/:id/reviews", get(list_reviews))
        .route("/reviews/:id/comments", post(add_comment).get(list_comments))
        .route("/comments/:id/resolve", post(resolve_comment))
        .route("/reviews/:id/approve", post(approve))
        .route("/reviews/:id/request-changes", post(request_changes))
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/api/reviews/{id}",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Review))
)]
pub(crate) async fn get_review(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.reviews().get(&review_id) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/{id}/reviews/active",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Option<Review>))
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
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.reviews().get_active_for_task(&task_id) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/tasks/{id}/reviews",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Vec<Review>))
)]
pub(crate) async fn list_reviews(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.reviews().list_for_task(&task_id) {
        Ok(reviews) => Json(reviews).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/reviews/{id}/comments",
    request_body = CreateCommentInput,
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = ReviewComment))
)]
pub(crate) async fn add_comment(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<CreateCommentInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.reviews().add_comment(&ctx, input) {
        Ok(comment) => Json(comment).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/reviews/{id}/comments",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Vec<ReviewComment>))
)]
pub(crate) async fn list_comments(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.reviews().list_comments(&review_id) {
        Ok(comments) => Json(comments).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/comments/{id}/resolve",
    params(("id" = String, Path, description = "Comment ID")),
    responses((status = 200, body = ReviewComment))
)]
pub(crate) async fn resolve_comment(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let comment_id = match CommentId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.reviews().resolve_comment(&ctx, &comment_id) {
        Ok(comment) => Json(comment).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/reviews/{id}/approve",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Review))
)]
pub(crate) async fn approve(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.reviews().approve(&ctx, &review_id) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/reviews/{id}/request-changes",
    params(("id" = String, Path, description = "Review ID")),
    request_body = RequestChangesInput,
    responses((status = 200, body = Review))
)]
pub(crate) async fn request_changes(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(mut input): Json<RequestChangesInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Review(os_core::error::ReviewError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    input.review_id = review_id;
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.reviews().request_changes(&ctx, input) {
        Ok(review) => Json(review).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}
