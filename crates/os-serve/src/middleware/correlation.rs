use axum::body::Body;
use axum::http::{HeaderName, HeaderValue, Request};
use axum::middleware::Next;
use axum::response::Response;
use ulid::Ulid;

#[derive(Clone, Debug)]
pub struct CorrelationId(pub String);

const HEADER_NAME: &str = "x-correlation-id";

pub async fn correlation_middleware(mut request: Request<Body>, next: Next) -> Response {
    let header = HeaderName::from_static(HEADER_NAME);
    let id = request
        .headers()
        .get(&header)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("corr_{}", Ulid::new()));

    request.extensions_mut().insert(CorrelationId(id.clone()));
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        response.headers_mut().insert(header, value);
    }
    response
}
