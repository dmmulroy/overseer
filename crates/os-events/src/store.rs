use crate::types::EventRecord;
use rusqlite::{params, Connection, Result};

pub struct EventStore {
    conn: Connection,
}

impl EventStore {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn append(&self, event: &EventRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO events (id, seq, at, correlation_id, source, body_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                event.id,
                event.seq,
                event.at.to_rfc3339(),
                event.correlation_id,
                format!("{:?}", event.source),
                event.body.to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn list(&self, after: Option<i64>, limit: Option<u32>) -> Result<Vec<EventRecord>> {
        let mut sql =
            String::from("SELECT id, seq, at, correlation_id, source, body_json FROM events");
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(after_seq) = after {
            sql.push_str(" WHERE seq > ?");
            params_vec.push(after_seq.into());
        }
        sql.push_str(" ORDER BY seq ASC");
        if let Some(limit_val) = limit {
            sql.push_str(" LIMIT ?");
            params_vec.push(i64::from(limit_val).into());
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), row_to_event)?;

        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventRecord> {
    let at: String = row.get(2)?;
    let source: String = row.get(4)?;
    Ok(EventRecord {
        id: row.get(0)?,
        seq: row.get(1)?,
        at: chrono::DateTime::parse_from_rfc3339(&at)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    2,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?,
        correlation_id: row.get(3)?,
        source: match source.as_str() {
            "Cli" => crate::types::EventSource::Cli,
            "Mcp" => crate::types::EventSource::Mcp,
            "Ui" => crate::types::EventSource::Ui,
            "Relay" => crate::types::EventSource::Relay,
            _ => crate::types::EventSource::Cli,
        },
        body: serde_json::from_str(&row.get::<_, String>(5)?)
            .unwrap_or_else(|_| serde_json::json!({})),
    })
}
