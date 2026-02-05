use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::extract::{Query, State};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use os_events::types::EventRecord;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, serde::Deserialize, ToSchema, IntoParams)]
pub struct EventsQuery {
    after: Option<i64>,
    limit: Option<u32>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/events", get(list_events))
        .route("/events/replay", get(replay))
        .route("/events/subscribe", get(subscribe))
        .route("/events/stream", get(stream))
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/api/events",
    params(EventsQuery),
    responses((status = 200, body = Vec<EventRecord>))
)]
pub(crate) async fn list_events(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.events().list(query.after, query.limit) {
        Ok(events) => Json(events).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/events/replay",
    params(EventsQuery),
    responses((status = 200, body = Vec<EventRecord>))
)]
pub(crate) async fn replay(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    match overseer.events().replay(query.after, query.limit) {
        Ok(events) => Json(events).into_response(),
        Err(err) => map_error(&err, None).into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/events/subscribe",
    params(EventsQuery),
    responses((status = 200))
)]
pub(crate) async fn subscribe(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    crate::sse::subscribe(state, query.after).await
}

#[utoipa::path(
    get,
    path = "/api/events/stream",
    params(EventsQuery),
    responses((status = 200))
)]
pub(crate) async fn stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(_query): Query<EventsQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_stream(socket, state))
}

async fn handle_stream(mut socket: WebSocket, state: AppState) {
    let mut receiver = state.event_bus.subscribe();
    while let Ok(event) = receiver.recv().await {
        let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        if socket.send(Message::Text(json.into())).await.is_err() {
            break;
        }
    }
}
