pub mod events;
pub mod error;
pub mod gates;
pub mod git_ai;
pub mod help;
pub mod learnings;
pub mod repos;
pub mod reviews;
pub mod tasks;
pub mod vcs;
pub mod agents;

use crate::middleware::correlation::correlation_middleware;
use crate::middleware::idempotency::IdempotencyLayer;
use crate::{openapi, relay, AppState};
use axum::middleware;
use axum::Router;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(tasks::router(state.clone()))
        .merge(agents::router(state.clone()))
        .merge(reviews::router(state.clone()))
        .merge(gates::router(state.clone()))
        .merge(git_ai::router(state.clone()))
        .merge(help::router(state.clone()))
        .merge(learnings::router(state.clone()))
        .merge(repos::router(state.clone()))
        .merge(vcs::router(state.clone()))
        .merge(events::router(state.clone()))
        .merge(openapi::router())
        .merge(relay::router(state.clone()))
        .layer(IdempotencyLayer::new(state.clone()))
        .route_layer(middleware::from_fn(correlation_middleware));

    Router::new().nest("/api", api)
}
