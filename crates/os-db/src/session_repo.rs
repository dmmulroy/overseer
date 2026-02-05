use crate::util::{decode_json, encode_json, from_rfc3339, to_rfc3339};
use os_core::error::OverseerError;
use os_core::sessions::{HarnessRepository, SessionRepository};
use os_core::types::enums::SessionStatus;
use os_core::types::ids::AnyTaskId;
use os_core::types::session::{Harness, Session};
use rusqlite::Connection;
use ulid::Ulid;

pub struct SessionRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> SessionRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> SessionRepository for SessionRepo<'a> {
    fn get(&self, id: &str) -> Result<Session, OverseerError> {
        self.get_session(id)
    }

    fn get_active_for_task(&self, task_id: &AnyTaskId) -> Result<Option<Session>, OverseerError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, task_id, harness_id, status, started_at, last_heartbeat_at, completed_at, error FROM sessions WHERE task_id = ?1 AND status IN ('Pending', 'Active') ORDER BY started_at DESC LIMIT 1",
            )
            .map_err(|err| {
                OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                })
            })?;
        let mut rows = stmt.query([task_id.as_str()]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        let Some(row) = rows.next().map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?
        else {
            return Ok(None);
        };
        map_session_row(row).map(Some)
    }

    fn create(&self, task_id: &AnyTaskId, harness_id: String) -> Result<Session, OverseerError> {
        let now = chrono::Utc::now();
        let session = Session {
            id: new_session_id(),
            task_id: task_id.clone(),
            harness_id,
            status: SessionStatus::Pending,
            started_at: now,
            last_heartbeat_at: None,
            completed_at: None,
            error: None,
        };
        let sql = "INSERT INTO sessions (id, task_id, harness_id, status, started_at, last_heartbeat_at, completed_at, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)";
        let params = (
            session.id.clone(),
            session.task_id.as_str(),
            session.harness_id.clone(),
            encode_status(session.status)?,
            to_rfc3339(&session.started_at),
            session.last_heartbeat_at.map(|value| to_rfc3339(&value)),
            session.completed_at.map(|value| to_rfc3339(&value)),
            session.error.clone(),
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        Ok(session)
    }

    fn heartbeat(&self, id: &str) -> Result<Session, OverseerError> {
        let mut session = self.get_session(id)?;
        session.last_heartbeat_at = Some(chrono::Utc::now());
        if session.status == SessionStatus::Pending {
            session.status = SessionStatus::Active;
        }
        let sql = "UPDATE sessions SET status = ?1, last_heartbeat_at = ?2 WHERE id = ?3";
        let params = (
            encode_status(session.status)?,
            session.last_heartbeat_at.map(|value| to_rfc3339(&value)),
            session.id.clone(),
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        Ok(session)
    }

    fn complete(
        &self,
        id: &str,
        status: SessionStatus,
        error: Option<String>,
    ) -> Result<Session, OverseerError> {
        let mut session = self.get_session(id)?;
        session.status = status;
        session.error = error;
        session.completed_at = Some(chrono::Utc::now());
        let sql = "UPDATE sessions SET status = ?1, completed_at = ?2, error = ?3 WHERE id = ?4";
        let params = (
            encode_status(session.status)?,
            session.completed_at.map(|value| to_rfc3339(&value)),
            session.error.clone(),
            session.id.clone(),
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        Ok(session)
    }
}

impl<'a> HarnessRepository for SessionRepo<'a> {
    fn get(&self, harness_id: &str) -> Result<Harness, OverseerError> {
        self.get_harness(harness_id)
    }

    fn register(
        &self,
        harness_id: String,
        capabilities: Vec<String>,
    ) -> Result<Harness, OverseerError> {
        let now = chrono::Utc::now();
        let harness = Harness {
            id: harness_id,
            capabilities,
            connected: true,
            last_seen_at: now,
        };
        let sql = "INSERT INTO harnesses (id, capabilities_json, connected, last_seen_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET capabilities_json = excluded.capabilities_json, connected = excluded.connected, last_seen_at = excluded.last_seen_at";
        let params = (
            harness.id.clone(),
            encode_json(&harness.capabilities).map_err(|err| {
                OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                })
            })?,
            if harness.connected { 1 } else { 0 },
            to_rfc3339(&harness.last_seen_at),
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        Ok(harness)
    }

    fn list(&self) -> Result<Vec<Harness>, OverseerError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, capabilities_json, connected, last_seen_at FROM harnesses ORDER BY id ASC")
            .map_err(|err| OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            }))?;
        let mut rows = stmt.query([]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        let mut harnesses = Vec::new();
        while let Some(row) = rows.next().map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })? {
            harnesses.push(map_harness_row(row)?);
        }
        Ok(harnesses)
    }

    fn set_connected(&self, harness_id: &str, connected: bool) -> Result<Harness, OverseerError> {
        let last_seen_at = chrono::Utc::now();
        let sql = "UPDATE harnesses SET connected = ?1, last_seen_at = ?2 WHERE id = ?3";
        let params = (
            if connected { 1 } else { 0 },
            to_rfc3339(&last_seen_at),
            harness_id,
        );
        self.conn.execute(sql, params).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        self.get_harness(harness_id)
    }
}

impl<'a> SessionRepo<'a> {
    fn get_session(&self, id: &str) -> Result<Session, OverseerError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, harness_id, status, started_at, last_heartbeat_at, completed_at, error FROM sessions WHERE id = ?1")
            .map_err(|err| OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            }))?;
        let mut rows = stmt.query([id]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        let Some(row) = rows.next().map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?
        else {
            return Err(OverseerError::Task(os_core::error::TaskError::NotFound));
        };
        map_session_row(row)
    }

    fn get_harness(&self, id: &str) -> Result<Harness, OverseerError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, capabilities_json, connected, last_seen_at FROM harnesses WHERE id = ?1")
            .map_err(|err| OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            }))?;
        let mut rows = stmt.query([id]).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        let Some(row) = rows.next().map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?
        else {
            return Err(OverseerError::Task(os_core::error::TaskError::NotFound));
        };
        map_harness_row(row)
    }
}

fn new_session_id() -> String {
    format!("sess_{}", Ulid::new())
}

fn encode_status(status: SessionStatus) -> Result<String, OverseerError> {
    let json = serde_json::to_value(status).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    match json {
        serde_json::Value::String(value) => Ok(value),
        other => Err(OverseerError::Task(
            os_core::error::TaskError::InvalidInput {
                message: format!("invalid session status: {other}"),
            },
        )),
    }
}

fn decode_status(value: &str) -> Result<SessionStatus, OverseerError> {
    let json = serde_json::Value::String(value.to_string());
    serde_json::from_value(json).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })
}

fn map_session_row(row: &rusqlite::Row<'_>) -> Result<Session, OverseerError> {
    let id: String = row.get(0).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let task_id: String = row.get(1).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let harness_id: String = row.get(2).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let status: String = row.get(3).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let started_at: String = row.get(4).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let last_heartbeat_at: Option<String> = row.get(5).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let completed_at: Option<String> = row.get(6).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let error: Option<String> = row.get(7).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;

    let task_id = AnyTaskId::parse(&task_id).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let status = decode_status(&status)?;

    Ok(Session {
        id,
        task_id,
        harness_id,
        status,
        started_at: from_rfc3339(&started_at).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
        last_heartbeat_at: last_heartbeat_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| {
                OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                })
            })?,
        completed_at: completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| {
                OverseerError::Task(os_core::error::TaskError::InvalidInput {
                    message: err.to_string(),
                })
            })?,
        error,
    })
}

fn map_harness_row(row: &rusqlite::Row<'_>) -> Result<Harness, OverseerError> {
    let id: String = row.get(0).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let capabilities_json: String = row.get(1).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let connected: i64 = row.get(2).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let last_seen_at: String = row.get(3).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    let capabilities: Vec<String> = decode_json(&capabilities_json).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })?;
    Ok(Harness {
        id,
        capabilities,
        connected: connected != 0,
        last_seen_at: from_rfc3339(&last_seen_at).map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?,
    })
}
