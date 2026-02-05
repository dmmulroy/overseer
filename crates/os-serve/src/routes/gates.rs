use crate::middleware::correlation::CorrelationId;
use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use os_core::types::gate::GateScope;
use os_core::types::io::{CreateGateInput, UpdateGateInput};
use os_core::types::gate::{Gate, GateResult};
use os_core::types::{AnyTaskId, GateId, RepoId, ReviewId};
use os_events::types::EventSource;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct GateListQuery {
    scope: String,
    id: String,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/gates", post(add_gate).get(list_gates))
        .route("/gates/effective/:id", get(effective_gates))
        .route("/gates/:id", delete(remove_gate).patch(update_gate))
        .route("/gates/results/:id", get(results))
        .route("/gates/rerun/:id", post(rerun))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/gates",
    request_body = CreateGateInput,
    responses((status = 200, body = Gate))
)]
pub(crate) async fn add_gate(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Json(input): Json<CreateGateInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.gates().add(&ctx, input) {
        Ok(gate) => Json(gate).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/gates",
    params(GateListQuery),
    responses((status = 200, body = Vec<Gate>))
)]
pub(crate) async fn list_gates(State(state): State<AppState>, Query(query): Query<GateListQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let scope = match query.scope.as_str() {
        "repo" | "Repo" => {
            let repo_id = match RepoId::new(query.id) {
                Ok(value) => value,
                Err(err) => {
                    return map_error(
                        &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                            message: err.to_string(),
                        }),
                        None,
                    )
                    .into_response()
                }
            };
            GateScope::Repo(repo_id)
        }
        "task" | "Task" => {
            let task_id = match AnyTaskId::parse(&query.id) {
                Ok(value) => value,
                Err(err) => {
                    return map_error(
                        &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                            message: err.to_string(),
                        }),
                        None,
                    )
                    .into_response()
                }
            };
            GateScope::Task(task_id)
        }
        other => {
            return map_error(
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: format!("invalid scope: {other}"),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.gates().list(&scope) {
        Ok(gates) => Json(gates).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/gates/effective/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses((status = 200, body = Vec<Gate>))
)]
pub(crate) async fn effective_gates(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let task_id = match AnyTaskId::parse(&id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.gates().effective(&task_id) {
        Ok(gates) => Json(gates).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    delete,
    path = "/api/gates/{id}",
    params(("id" = String, Path, description = "Gate ID")),
    responses((status = 200))
)]
pub(crate) async fn remove_gate(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let gate_id = match GateId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.gates().remove(&ctx, &gate_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    patch,
    path = "/api/gates/{id}",
    params(("id" = String, Path, description = "Gate ID")),
    request_body = UpdateGateInput,
    responses((status = 200, body = Gate))
)]
pub(crate) async fn update_gate(
    State(state): State<AppState>,
    Extension(correlation): Extension<CorrelationId>,
    Path(id): Path<String>,
    Json(input): Json<UpdateGateInput>,
) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, Some(correlation.0)).into_response(),
    };
    let gate_id = match GateId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.gates().update(&ctx, &gate_id, input) {
        Ok(gate) => Json(gate).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/gates/results/{id}",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200, body = Vec<GateResult>))
)]
pub(crate) async fn results(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let review_id = match ReviewId::new(id) {
        Ok(value) => value,
        Err(err) => {
            return map_error(
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: err.to_string(),
                }),
                None,
            )
            .into_response()
        }
    };
    match overseer.gates().results(&review_id) {
        Ok(results) => Json(results).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/gates/rerun/{id}",
    params(("id" = String, Path, description = "Review ID")),
    responses((status = 200))
)]
pub(crate) async fn rerun(
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
                &os_core::OverseerError::Gate(os_core::error::GateError::InvalidInput {
                    message: err.to_string(),
                }),
                Some(correlation.0),
            )
            .into_response()
        }
    };
    let ctx = os_core::RequestContext::new(EventSource::Ui, Some(correlation.0));
    match overseer.gates().rerun(&ctx, &review_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(err) => map_error(&err, ctx.correlation_id).into_response(),
    }
}
