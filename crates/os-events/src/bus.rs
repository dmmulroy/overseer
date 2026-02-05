use crate::types::EventRecord;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<EventRecord>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventRecord> {
        self.sender.subscribe()
    }

    pub fn publish(
        &self,
        event: EventRecord,
    ) -> Result<(), broadcast::error::SendError<EventRecord>> {
        self.sender.send(event).map(|_| ())
    }
}
