use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use os_core::types::repo::Repo;
use os_core::types::RepoId;
use os_events::types::EventSource;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct RegisterRepoInput {
    path: String,
}

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct RepoByPathQuery {
    path: String,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/repos", post(register_repo).get(list_repos))
        .route("/repos/:id", get(get_repo).delete(unregister_repo))
        .route("/repos/by-path", get(get_by_path))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/repos",
    request_body = RegisterRepoInput,
    responses((status = 200, body = Repo))
)]
pub(crate) async fn register_repo(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<RegisterRepoInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.repos().register(&ctx, input.path.into()) {
        Ok(repo) => Json(repo).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/repos/{id}",
    params(("id" = String, Path, description = "Repo ID")),
    responses((status = 200, body = Repo))
)]
pub(crate) async fn get_repo(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let repo_id = match RepoId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Repo(os_core::error::RepoError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.repos().get(&repo_id) {
        Ok(repo) => Json(repo).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/repos/by-path",
    params(RepoByPathQuery),
    responses((status = 200, body = Option<Repo>))
)]
pub(crate) async fn get_by_path(State(state): State<AppState>, Query(query): Query<RepoByPathQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.repos().get_by_path(query.path.as_ref()) {
        Ok(repo) => Json(repo).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/repos",
    responses((status = 200, body = Vec<Repo>))
)]
pub(crate) async fn list_repos(State(state): State<AppState>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.repos().list() {
        Ok(repos) => Json(repos).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    delete,
    path = "/api/repos/{id}",
    params(("id" = String, Path, description = "Repo ID")),
    responses((status = 200))
)]
pub(crate) async fn unregister_repo(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let repo_id = match RepoId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Repo(os_core::error::RepoError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.repos().unregister(&ctx, &repo_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}
