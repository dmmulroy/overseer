use crate::{build_overseer, AppState};
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use os_core::types::io::CreateCommentInput;
use os_core::types::session::Session;
use os_core::types::SessionStatus;
use os_events::types::EventSource;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use futures::{SinkExt, StreamExt};

#[derive(Clone)]
pub struct RelayState {
    harnesses: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>>,
    sessions: Arc<Mutex<HashMap<String, SessionRoute>>>,
    message_ids: Arc<Mutex<HashSet<String>>>,
}

impl RelayState {
    pub fn new() -> Self {
        Self {
            harnesses: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            message_ids: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

#[derive(Clone)]
struct SessionRoute {
    harness_id: String,
    ui_sender: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Deserialize)]
struct RelayMessage {
    #[serde(rename = "type")]
    kind: String,
    message_id: Option<String>,
    correlation_id: Option<String>,
    session_id: Option<String>,
    task_id: Option<String>,
    harness_id: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct AuthPayload {
    token: String,
}

#[derive(Debug, Deserialize)]
struct RegisterHarnessPayload {
    harness_id: String,
    capabilities: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SessionStartPayload {
    task_id: String,
    harness_id: String,
}

#[derive(Debug, Deserialize)]
struct SessionCompletePayload {
    status: String,
    error: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/relay/ws", get(ws_handler))
        .with_state(state)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(stream: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = false;
    let mut harness_id: Option<String> = None;

    while let Some(Ok(msg)) = receiver.next().await {
        let Message::Text(text) = msg else {
            continue;
        };
        let parsed: Result<RelayMessage, _> = serde_json::from_str(&text);
        let Ok(message) = parsed else {
            let _ = tx.send(text_message(error_payload("invalid_message")));
            continue;
        };

        if let Some(message_id) = &message.message_id {
            if is_duplicate(state.relay.as_ref(), message_id).await {
                continue;
            }
        }

        if message.kind == "auth" {
            let ok = match message.payload.and_then(|value| serde_json::from_value::<AuthPayload>(value).ok()) {
                Some(payload) => authenticate(&payload.token),
                None => false,
            };
            if !ok {
                let _ = tx.send(text_message(error_payload("auth_failed")));
                break;
            }
            authenticated = true;
            let _ = tx.send(text_message(serde_json::json!({ "type": "auth_ok" }).to_string()));
            continue;
        }

        if !authenticated {
            let _ = tx.send(text_message(error_payload("auth_required")));
            continue;
        }

        match message.kind.as_str() {
            "register_harness" => {
                let Some(payload) = message
                    .payload
                    .and_then(|value| serde_json::from_value::<RegisterHarnessPayload>(value).ok())
                else {
                    let _ = tx.send(text_message(error_payload("invalid_payload")));
                    continue;
                };
                let overseer = match build_overseer(&state) {
                    Ok(overseer) => overseer,
                    Err(_) => {
                        let _ = tx.send(text_message(error_payload("register_failed")));
                        continue;
                    }
                };
                let ctx = os_core::RequestContext::new(EventSource::Relay, None);
                let ok = overseer
                    .sessions()
                    .register_harness(&ctx, payload.harness_id.clone(), payload.capabilities.clone())
                    .is_ok();
                if ok {
                    harness_id = Some(payload.harness_id.clone());
                    state
                        .relay
                        .harnesses
                        .lock()
                        .await
                        .insert(payload.harness_id.clone(), tx.clone());
                    let _ = tx.send(text_message(
                        serde_json::json!({ "type": "harness_registered", "harness_id": payload.harness_id }).to_string(),
                    ));
                } else {
                    let _ = tx.send(text_message(error_payload("register_failed")));
                }
            }
            "session_start" => {
                let payload = message
                    .payload
                    .and_then(|value| serde_json::from_value::<SessionStartPayload>(value).ok())
                    .or_else(|| {
                        let task_id = message.task_id.clone()?;
                        let harness_id = message.harness_id.clone()?;
                        Some(SessionStartPayload { task_id, harness_id })
                    });
                let Some(payload) = payload else {
                    let _ = tx.send(text_message(error_payload("invalid_payload")));
                    continue;
                };
                let session = start_session(&state, &payload, message.correlation_id.clone()).await;
                match session {
                    Ok(session) => {
                        register_session_route(&state, &session, &payload.harness_id, tx.clone()).await;
                        let _ = forward_to_harness(
                            &state,
                            &payload.harness_id,
                            serde_json::json!({
                                "type": "session_start",
                                "session_id": session.id,
                                "task_id": session.task_id.as_str(),
                                "harness_id": payload.harness_id
                            })
                            .to_string(),
                        )
                        .await;
                    }
                    Err(message) => {
                        let _ = tx.send(text_message(error_payload(&message)));
                    }
                }
            }
            "session_heartbeat" => {
                if let Some(session_id) = message.session_id.as_deref() {
                    let _ = heartbeat_session(&state, session_id, message.correlation_id.clone()).await;
                }
            }
            "session_complete" => {
                if let Some(session_id) = message.session_id.as_deref() {
                    let payload = message
                        .payload
                        .and_then(|value| serde_json::from_value::<SessionCompletePayload>(value).ok());
                    let status = payload
                        .as_ref()
                        .map(|value| value.status.clone())
                        .unwrap_or_else(|| "failed".to_string());
                    let error = payload.and_then(|value| value.error);
                    let _ = complete_session(&state, session_id, &status, error, message.correlation_id.clone()).await;
                    if let Some(route) = session_route(&state, session_id).await {
                        let _ = route.ui_sender.send(text_message(
                            serde_json::json!({
                                "type": "session_complete",
                                "session_id": session_id,
                                "status": status
                            })
                            .to_string(),
                        ));
                    }
                }
            }
            "session_cancel" => {
                if let Some(session_id) = message.session_id.as_deref() {
                    let _ = complete_session(
                        &state,
                        session_id,
                        "cancelled",
                        Some("cancelled".to_string()),
                        message.correlation_id.clone(),
                    )
                    .await;
                }
            }
            "review_comment" => {
                if let Some(payload) = message.payload {
                    if let Ok(comment) = serde_json::from_value::<CreateCommentInput>(payload) {
                        let _ = add_review_comment(&state, comment, message.correlation_id.clone()).await;
                    }
                }
            }
            "session_progress" | "session_log" => {
                if let Some(session_id) = message.session_id.as_deref() {
                    if let Some(route) = session_route(&state, session_id).await {
                        let _ = route.ui_sender.send(text_message(text.to_string()));
                    }
                }
            }
            _ => {
                let _ = tx.send(text_message(error_payload("unknown_type")));
            }
        }
    }

    if let Some(id) = harness_id {
        let _ = disconnect_harness(&state, &id).await;
    }
}

fn authenticate(token: &str) -> bool {
    match std::env::var("OVERSEER_RELAY_TOKEN") {
        Ok(expected) => token == expected,
        Err(_) => true,
    }
}

async fn start_session(
    state: &AppState,
    payload: &SessionStartPayload,
    correlation_id: Option<String>,
) -> Result<Session, String> {
    let overseer = build_overseer(state).map_err(|err| err.to_string())?;
    let ctx = os_core::RequestContext::new(EventSource::Relay, correlation_id);
    let task_id = os_core::types::AnyTaskId::parse(&payload.task_id)
        .map_err(|err| err.to_string())?;
    overseer
        .sessions()
        .start_session(&ctx, &task_id, payload.harness_id.clone())
        .map_err(|err| err.to_string())
}

async fn heartbeat_session(
    state: &AppState,
    session_id: &str,
    correlation_id: Option<String>,
) -> Result<Session, String> {
    let overseer = build_overseer(state).map_err(|err| err.to_string())?;
    let ctx = os_core::RequestContext::new(EventSource::Relay, correlation_id);
    overseer
        .sessions()
        .heartbeat(&ctx, session_id)
        .map_err(|err| err.to_string())
}

async fn complete_session(
    state: &AppState,
    session_id: &str,
    status: &str,
    error: Option<String>,
    correlation_id: Option<String>,
) -> Result<Session, String> {
    let overseer = build_overseer(state).map_err(|err| err.to_string())?;
    let ctx = os_core::RequestContext::new(EventSource::Relay, correlation_id);
    let status = match status {
        "ok" | "completed" | "Completed" => SessionStatus::Completed,
        "cancelled" | "Cancelled" => SessionStatus::Cancelled,
        _ => SessionStatus::Failed,
    };
    overseer
        .sessions()
        .complete(&ctx, session_id, status, error)
        .map_err(|err| err.to_string())
}

async fn add_review_comment(
    state: &AppState,
    comment: CreateCommentInput,
    correlation_id: Option<String>,
) -> Result<(), String> {
    let overseer = build_overseer(state).map_err(|err| err.to_string())?;
    let ctx = os_core::RequestContext::new(EventSource::Relay, correlation_id);
    overseer
        .reviews()
        .add_comment(&ctx, comment)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

async fn register_session_route(
    state: &AppState,
    session: &Session,
    harness_id: &str,
    ui_sender: mpsc::UnboundedSender<Message>,
) {
    state.relay.sessions.lock().await.insert(
        session.id.clone(),
        SessionRoute {
            harness_id: harness_id.to_string(),
            ui_sender,
        },
    );
}

async fn session_route(state: &AppState, session_id: &str) -> Option<SessionRoute> {
    state
        .relay
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
}

async fn forward_to_harness(state: &AppState, harness_id: &str, message: String) -> Result<(), ()> {
    let harnesses = state.relay.harnesses.lock().await;
    if let Some(sender) = harnesses.get(harness_id) {
        let _ = sender.send(text_message(message));
        Ok(())
    } else {
        Err(())
    }
}

async fn disconnect_harness(state: &AppState, harness_id: &str) -> Result<(), ()> {
    let overseer = build_overseer(state).map_err(|_| ())?;
    let ctx = os_core::RequestContext::new(EventSource::Relay, None);
    let _ = overseer.sessions().set_harness_connected(&ctx, harness_id, false);
    let sessions = state.relay.sessions.lock().await.clone();
    for (session_id, route) in sessions {
        if route.harness_id == harness_id {
            let _ = overseer.sessions().complete(
                &ctx,
                &session_id,
                SessionStatus::Failed,
                Some("harness disconnected".to_string()),
            );
            let _ = route.ui_sender.send(text_message(
                serde_json::json!({
                    "type": "session_failed",
                    "session_id": session_id,
                    "error": "harness disconnected"
                })
                .to_string(),
            ));
        }
    }
    state.relay.harnesses.lock().await.remove(harness_id);
    Ok(())
}

async fn is_duplicate(state: &RelayState, message_id: &str) -> bool {
    let mut guard = state.message_ids.lock().await;
    if guard.contains(message_id) {
        return true;
    }
    if guard.len() > 10_000 {
        guard.clear();
    }
    guard.insert(message_id.to_string());
    false
}

fn error_payload(code: &str) -> String {
    serde_json::json!({ "type": "error", "code": code }).to_string()
}

fn text_message(value: String) -> Message {
    Message::Text(Utf8Bytes::from(value))
}
