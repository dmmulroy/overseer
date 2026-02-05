use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EventRecord {
    pub id: String,
    pub seq: i64,
    pub at: DateTime<Utc>,
    pub correlation_id: Option<String>,
    pub source: EventSource,
    pub body: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "PascalCase")]
pub enum EventSource {
    Cli,
    Mcp,
    Ui,
    Relay,
}
