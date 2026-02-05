use crate::error::OverseerError;
use crate::types::{Harness, Session, SessionStatus};

pub trait SessionRepository {
    fn get(&self, id: &str) -> Result<Session, OverseerError>;
    fn get_active_for_task(
        &self,
        task_id: &crate::types::AnyTaskId,
    ) -> Result<Option<Session>, OverseerError>;
    fn create(
        &self,
        task_id: &crate::types::AnyTaskId,
        harness_id: String,
    ) -> Result<Session, OverseerError>;
    fn heartbeat(&self, id: &str) -> Result<Session, OverseerError>;
    fn complete(
        &self,
        id: &str,
        status: SessionStatus,
        error: Option<String>,
    ) -> Result<Session, OverseerError>;
}

pub trait HarnessRepository {
    fn get(&self, harness_id: &str) -> Result<Harness, OverseerError>;
    fn register(
        &self,
        harness_id: String,
        capabilities: Vec<String>,
    ) -> Result<Harness, OverseerError>;
    fn list(&self) -> Result<Vec<Harness>, OverseerError>;
    fn set_connected(&self, harness_id: &str, connected: bool) -> Result<Harness, OverseerError>;
}
