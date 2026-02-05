use crate::{build_overseer, AppState};
use os_core::RequestContext;
use os_events::types::EventSource;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 5;

pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    loop {
        interval.tick().await;
        let overseer = match build_overseer(&state) {
            Ok(overseer) => overseer,
            Err(_) => continue,
        };
        let ctx = RequestContext::new(EventSource::Ui, None);
        let _ = overseer.gates().poll_pending(&ctx);
    }
}
