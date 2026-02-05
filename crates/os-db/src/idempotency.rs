use crate::util::{from_rfc3339, to_rfc3339};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub struct IdempotencyStore<'a> {
    pub conn: &'a Connection,
}

impl<'a> IdempotencyStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdempotencyRecord {
    pub key: String,
    pub method: String,
    pub path: String,
    pub scope_hash: String,
    pub request_hash: String,
    pub response_status: i32,
    pub response_body: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

impl<'a> IdempotencyStore<'a> {
    pub fn get(&self, key: &str, scope_hash: &str) -> Result<Option<IdempotencyRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, method, path, scope_hash, request_hash, response_status, response_body, created_at, expires_at FROM idempotency_keys WHERE key = ?1 AND scope_hash = ?2")
            .map_err(|err| err.to_string())?;
        let mut rows = stmt
            .query([key, scope_hash])
            .map_err(|err| err.to_string())?;
        let Some(row) = rows.next().map_err(|err| err.to_string())? else {
            return Ok(None);
        };
        Ok(Some(map_record_row(row)?))
    }

    pub fn insert(&self, record: IdempotencyRecord) -> Result<(), String> {
        let sql = "INSERT INTO idempotency_keys (key, method, path, scope_hash, request_hash, response_status, response_body, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";
        let params = (
            record.key,
            record.method,
            record.path,
            record.scope_hash,
            record.request_hash,
            record.response_status,
            record.response_body,
            to_rfc3339(&record.created_at),
            to_rfc3339(&record.expires_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn cleanup(&self, now: chrono::DateTime<chrono::Utc>) -> Result<u64, String> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM idempotency_keys WHERE expires_at < ?1",
                [to_rfc3339(&now)],
            )
            .map_err(|err| err.to_string())?;
        Ok(affected as u64)
    }
}

fn map_record_row(row: &rusqlite::Row<'_>) -> Result<IdempotencyRecord, String> {
    let key: String = row.get(0).map_err(|err| err.to_string())?;
    let method: String = row.get(1).map_err(|err| err.to_string())?;
    let path: String = row.get(2).map_err(|err| err.to_string())?;
    let scope_hash: String = row.get(3).map_err(|err| err.to_string())?;
    let request_hash: String = row.get(4).map_err(|err| err.to_string())?;
    let response_status: i32 = row.get(5).map_err(|err| err.to_string())?;
    let response_body: String = row.get(6).map_err(|err| err.to_string())?;
    let created_at: String = row.get(7).map_err(|err| err.to_string())?;
    let expires_at: String = row.get(8).map_err(|err| err.to_string())?;
    Ok(IdempotencyRecord {
        key,
        method,
        path,
        scope_hash,
        request_hash,
        response_status,
        response_body,
        created_at: from_rfc3339(&created_at).map_err(|err| err.to_string())?,
        expires_at: from_rfc3339(&expires_at).map_err(|err| err.to_string())?,
    })
}
