use crate::error::OverseerError;
use os_events::types::EventRecord;

pub trait EventRepository {
    fn append(&self, event: EventRecord) -> Result<EventRecord, OverseerError>;
    fn list(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError>;
    fn replay(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError>;
}
