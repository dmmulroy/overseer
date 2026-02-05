pub mod middleware;
pub mod gate_polling;
pub mod openapi;
pub mod relay;
pub mod routes;
pub mod sse;
pub mod static_files;

use axum::http::Request;
use axum::Router;
use middleware::correlation::CorrelationId;
use os_core::{Overseer, OverseerError};
use os_db::schema;
use os_db::store::DbStore;
use os_events::bus::EventBus;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
pub struct IdempotencyLocks {
    inner: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

impl IdempotencyLocks {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db_path: String,
    pub event_bus: EventBus,
    pub idempotency: IdempotencyLocks,
    pub relay: Arc<relay::RelayState>,
}

pub fn build_overseer(state: &AppState) -> Result<Overseer<DbStore>, OverseerError> {
    let conn = schema::open_and_migrate(&state.db_path)
        .map_err(|err| OverseerError::Internal { message: err.to_string() })?;
    let store = DbStore::new(conn);
    Ok(Overseer::new(store, state.event_bus.clone()))
}

pub fn correlation_id_from_request<B>(request: &Request<B>) -> Option<String> {
    request
        .extensions()
        .get::<CorrelationId>()
        .map(|value| value.0.clone())
}

pub fn app(state: AppState) -> Router {
    routes::router(state)
}

pub async fn serve(state: AppState, addr: std::net::SocketAddr) -> Result<(), std::io::Error> {
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app(state)).await
}
