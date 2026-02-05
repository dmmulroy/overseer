use crate::routes::error::map_error;
use crate::{build_overseer, AppState};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use futures::stream::{self, StreamExt};
use tokio_stream::wrappers::BroadcastStream;

pub async fn subscribe(state: AppState, after: Option<i64>) -> Response {
    let overseer = match build_overseer(&state) {
        Ok(overseer) => overseer,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let history = match overseer.events().list(after, None) {
        Ok(events) => events,
        Err(err) => return map_error(&err, None).into_response(),
    };
    let history_stream = stream::iter(history.into_iter().map(|event| {
        let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok::<Event, std::convert::Infallible>(Event::default().data(json))
    }));

    let live_stream = BroadcastStream::new(state.event_bus.subscribe()).filter_map(|item| async {
        match item {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                Some(Ok(Event::default().data(json)))
            }
            Err(_) => None,
        }
    });

    let stream = history_stream.chain(live_stream);
    Sse::new(stream).into_response()
}
