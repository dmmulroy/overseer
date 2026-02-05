use crate::util::{decode_json, encode_json, from_rfc3339, to_rfc3339};
use os_core::error::OverseerError;
use os_core::events::EventRepository;
use os_events::types::{EventRecord, EventSource};
use rusqlite::Connection;
use ulid::Ulid;

pub struct EventRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> EventRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> EventRepository for EventRepo<'a> {
    fn append(&self, mut event: EventRecord) -> Result<EventRecord, OverseerError> {
        let seq = next_seq(&self.conn).map_err(|err| OverseerError::Task(err))?;
        let id = format!("evt_{}", Ulid::new());
        event.seq = seq;
        event.id = id;
        let sql = "INSERT INTO events (id, seq, at, correlation_id, source, body_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";
        let params = (
            event.id.clone(),
            event.seq,
            to_rfc3339(&event.at),
            event.correlation_id.clone(),
            encode_event_source(event.source).map_err(|err| OverseerError::Internal {
                message: err.to_string(),
            })?,
            encode_json(&event.body).map_err(|err| OverseerError::Internal {
                message: err.to_string(),
            })?,
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        Ok(event)
    }

    fn list(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError> {
        list_events(&self.conn, after, limit)
    }

    fn replay(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError> {
        list_events(&self.conn, after, limit)
    }
}

fn list_events(
    conn: &Connection,
    after: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<EventRecord>, OverseerError> {
    let mut sql = "SELECT id, seq, at, correlation_id, source, body_json FROM events".to_string();
    if after.is_some() {
        sql.push_str(" WHERE seq > ?1");
    }
    sql.push_str(" ORDER BY seq ASC");
    if limit.is_some() {
        sql.push_str(" LIMIT ?2");
    }

    let mut stmt = conn.prepare(&sql).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let mut rows = match (after, limit) {
        (Some(after), Some(limit)) => {
            stmt.query(rusqlite::params![after, limit]).map_err(|err| {
                OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                })
            })?
        }
        (Some(after), None) => stmt.query(rusqlite::params![after]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
        (None, Some(limit)) => stmt.query(rusqlite::params![limit]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
        (None, None) => stmt.query([]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
    };
    let mut events = Vec::new();
    while let Some(row) = rows.next().map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })? {
        events.push(map_event_row(row)?);
    }
    Ok(events)
}

fn map_event_row(row: &rusqlite::Row<'_>) -> Result<EventRecord, OverseerError> {
    let id: String = row.get(0).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let seq: i64 = row.get(1).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let at: String = row.get(2).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let correlation_id: Option<String> = row.get(3).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let source: String = row.get(4).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let body_json: String = row.get(5).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;

    Ok(EventRecord {
        id,
        seq,
        at: from_rfc3339(&at).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
        correlation_id,
        source: decode_event_source(&source).map_err(|err| OverseerError::Task(err))?,
        body: decode_json(&body_json).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
    })
}

fn next_seq(conn: &Connection) -> Result<i64, os_core::error::TaskError> {
    let mut stmt = conn
        .prepare("SELECT COALESCE(MAX(seq), 0) FROM events")
        .map_err(|err| os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })?;
    let seq: i64 = stmt.query_row([], |row| row.get(0)).map_err(|err| {
        os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        }
    })?;
    Ok(seq + 1)
}

fn encode_event_source(source: EventSource) -> Result<String, os_core::error::TaskError> {
    let json =
        serde_json::to_value(source).map_err(|err| os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })?;
    match json {
        serde_json::Value::String(value) => Ok(value),
        other => Err(os_core::error::TaskError::InvalidInput {
            message: format!("invalid event source: {other}"),
        }),
    }
}

fn decode_event_source(value: &str) -> Result<EventSource, os_core::error::TaskError> {
    let json = serde_json::Value::String(value.to_string());
    serde_json::from_value(json).map_err(|err| os_core::error::TaskError::InvalidInput {
        message: err.to_string(),
    })
}
