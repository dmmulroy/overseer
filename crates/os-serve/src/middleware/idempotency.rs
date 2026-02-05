use crate::correlation_id_from_request;
use crate::{AppState, IdempotencyLocks};
use axum::body::{Body, Bytes};
use axum::http::{Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::future::BoxFuture;
use os_db::idempotency::{IdempotencyRecord, IdempotencyStore};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::sync::Notify;
use tower::{Layer, Service};

const KEY_HEADER: &str = "idempotency-key";
const MAX_KEY_LEN: usize = 128;
const TTL_SECONDS: i64 = 24 * 60 * 60;

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    code: &'static str,
    message: String,
    correlation_id: Option<String>,
}

#[derive(Clone)]
pub struct IdempotencyLayer {
    state: AppState,
}

impl IdempotencyLayer {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

#[derive(Clone)]
pub struct IdempotencyService<S> {
    inner: S,
    state: AppState,
}

impl<S> Layer<S> for IdempotencyLayer {
    type Service = IdempotencyService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        IdempotencyService {
            inner,
            state: self.state.clone(),
        }
    }
}

impl<S> Service<Request<Body>> for IdempotencyService<S>
where
    S: Service<Request<Body>, Response = Response, Error = Infallible> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = Response;
    type Error = Infallible;
    type Future = BoxFuture<'static, Result<Response, Infallible>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let mut inner = self.inner.clone();
        let state = self.state.clone();
        Box::pin(async move { Ok(handle_request(state, request, &mut inner).await) })
    }
}

async fn handle_request<S>(
    state: AppState,
    request: Request<Body>,
    inner: &mut S,
) -> Response
where
    S: Service<Request<Body>, Response = Response, Error = Infallible> + Send,
    S::Future: Send,
{
    if !matches!(
        *request.method(),
        Method::POST | Method::PATCH | Method::DELETE
    ) {
        return match inner.call(request).await {
            Ok(response) => response,
            Err(err) => match err {},
        };
    }

    let key = match request.headers().get(KEY_HEADER) {
        Some(value) => match value.to_str() {
            Ok(text) if !text.trim().is_empty() => text.to_string(),
            _ => {
                return match inner.call(request).await {
                    Ok(response) => response,
                    Err(err) => match err {},
                };
            }
        },
        None => {
            return match inner.call(request).await {
                Ok(response) => response,
                Err(err) => match err {},
            };
        }
    };

    if !key.is_ascii() || key.len() > MAX_KEY_LEN {
        let correlation_id = correlation_id_from_request(&request);
        return error_response(
            StatusCode::BAD_REQUEST,
            "invalid_input",
            "invalid idempotency key".to_string(),
            correlation_id,
        );
    }

    let correlation_id = correlation_id_from_request(&request);
    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let query = request.uri().query().map(|value| value.to_string());
    let (parts, body) = request.into_parts();
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(_) => Bytes::new(),
    };
    let (query_hash, query_repo_id) = canonical_query(query.as_deref());
    let (body_hash, body_repo_id) = canonical_body(&body_bytes);
    let repo_id = query_repo_id.or(body_repo_id);
    let scope_source = format!("{}|{}|{}", method, path, repo_id.clone().unwrap_or_default());
    let scope_hash = hash_str(&scope_source);
    let request_source = format!("{}|{}", query_hash, body_hash);
    let request_hash = hash_str(&request_source);

    {
        let conn = match os_db::schema::open_and_migrate(&state.db_path) {
            Ok(conn) => conn,
            Err(err) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    err.to_string(),
                    correlation_id.clone(),
                );
            }
        };
        let store = IdempotencyStore::new(&conn);
        if let Ok(Some(record)) = store.get(&key, &scope_hash) {
            if record.request_hash != request_hash {
                return error_response(
                    StatusCode::CONFLICT,
                    "conflict",
                    "idempotency key conflict".to_string(),
                    correlation_id.clone(),
                );
            }
            let mut response = Response::builder()
                .status(StatusCode::from_u16(record.response_status as u16).unwrap_or_default())
                .body(Body::from(record.response_body))
                .unwrap_or_else(|_| Response::new(Body::empty()));
            response
                .headers_mut()
                .insert("content-type", "application/json".parse().unwrap());
            return response;
        }
    }

    let lock_key = format!("{}:{}", key, scope_hash);
    if wait_on_inflight(&state.idempotency, &lock_key).await {
        let conn = match os_db::schema::open_and_migrate(&state.db_path) {
            Ok(conn) => conn,
            Err(err) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    err.to_string(),
                    correlation_id.clone(),
                );
            }
        };
        let store = IdempotencyStore::new(&conn);
        if let Ok(Some(record)) = store.get(&key, &scope_hash) {
            if record.request_hash == request_hash {
                let mut response = Response::builder()
                    .status(StatusCode::from_u16(record.response_status as u16).unwrap_or_default())
                    .body(Body::from(record.response_body))
                    .unwrap_or_else(|_| Response::new(Body::empty()));
                response
                    .headers_mut()
                    .insert("content-type", "application/json".parse().unwrap());
                return response;
            }
        }
    }

    let request = Request::from_parts(parts, Body::from(body_bytes.clone()));
    let response = match inner.call(request).await {
        Ok(response) => response,
        Err(err) => match err {},
    };
    let (parts, body) = response.into_parts();
    let body_bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .unwrap_or_default();
    let status = parts.status;
    let response = Response::from_parts(parts, Body::from(body_bytes.clone()));

    let should_cache = status.is_success() || status.is_server_error();
    if should_cache {
        let now = chrono::Utc::now();
        let record = IdempotencyRecord {
            key: key.clone(),
            method: method.clone(),
            path: path.clone(),
            scope_hash,
            request_hash,
            response_status: status.as_u16() as i32,
            response_body: String::from_utf8_lossy(&body_bytes).to_string(),
            created_at: now,
            expires_at: now + chrono::Duration::seconds(TTL_SECONDS),
        };
        if let Ok(conn) = os_db::schema::open_and_migrate(&state.db_path) {
            let store = IdempotencyStore::new(&conn);
            let _ = store.insert(record);
        }
    }

    notify_inflight(&state.idempotency, &lock_key).await;
    response
}

fn error_response(
    status: StatusCode,
    code: &'static str,
    message: String,
    correlation_id: Option<String>,
) -> Response {
    let body = ErrorEnvelope {
        code,
        message,
        correlation_id,
    };
    (status, axum::Json(body)).into_response()
}

async fn wait_on_inflight(locks: &IdempotencyLocks, key: &str) -> bool {
    let notify = {
        let mut guard = locks.inner.lock().await;
        if let Some(existing) = guard.get(key) {
            existing.clone()
        } else {
            let notify = Arc::new(Notify::new());
            guard.insert(key.to_string(), notify.clone());
            return false;
        }
    };
    notify.notified().await;
    true
}

async fn notify_inflight(locks: &IdempotencyLocks, key: &str) {
    let notify = {
        let mut guard = locks.inner.lock().await;
        guard.remove(key)
    };
    if let Some(notify) = notify {
        notify.notify_waiters();
    }
}

fn canonical_query(query: Option<&str>) -> (String, Option<String>) {
    let mut pairs = Vec::new();
    let mut repo_id = None;
    if let Some(query) = query {
        for part in query.split('&') {
            if part.is_empty() {
                continue;
            }
            let mut iter = part.splitn(2, '=');
            let key = iter.next().unwrap_or("");
            let value = iter.next().unwrap_or("");
            if key == "repo_id" && !value.is_empty() {
                repo_id = Some(value.to_string());
            }
            pairs.push((key.to_string(), value.to_string()));
        }
    }
    pairs.sort();
    let encoded = pairs
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    (encoded, repo_id)
}

fn canonical_body(bytes: &Bytes) -> (String, Option<String>) {
    if bytes.is_empty() {
        return (String::new(), None);
    }
    let parsed: Result<Value, _> = serde_json::from_slice(bytes);
    if let Ok(value) = parsed {
        let normalized = normalize_json(&value);
        let repo_id = normalized
            .get("repo_id")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let serialized = serde_json::to_string(&normalized).unwrap_or_default();
        (serialized, repo_id)
    } else {
        (
            String::from_utf8_lossy(bytes).to_string(),
            None,
        )
    }
}

fn normalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut ordered = BTreeMap::new();
            for (key, value) in map {
                ordered.insert(key.clone(), normalize_json(value));
            }
            Value::Object(ordered.into_iter().collect())
        }
        Value::Array(values) => Value::Array(values.iter().map(normalize_json).collect()),
        other => other.clone(),
    }
}

fn hash_str(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}
