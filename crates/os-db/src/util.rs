use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("json encode failed: {message}")]
    JsonEncode { message: String },
    #[error("json decode failed: {message}")]
    JsonDecode { message: String },
    #[error("invalid enum value: {value}")]
    InvalidEnum { value: String },
    #[error("invalid timestamp: {value}")]
    InvalidTimestamp { value: String },
}

pub fn to_rfc3339(value: &DateTime<Utc>) -> String {
    value.to_rfc3339()
}

pub fn from_rfc3339(value: &str) -> Result<DateTime<Utc>, DbError> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| DbError::InvalidTimestamp {
            value: value.to_string(),
        })
}

pub fn encode_json<T: Serialize>(value: &T) -> Result<String, DbError> {
    serde_json::to_string(value).map_err(|err| DbError::JsonEncode {
        message: err.to_string(),
    })
}

pub fn decode_json<T: DeserializeOwned>(value: &str) -> Result<T, DbError> {
    serde_json::from_str(value).map_err(|err| DbError::JsonDecode {
        message: err.to_string(),
    })
}

pub fn encode_enum<T: Serialize>(value: &T) -> Result<String, DbError> {
    let json = serde_json::to_value(value).map_err(|err| DbError::JsonEncode {
        message: err.to_string(),
    })?;
    match json {
        Value::String(value) => Ok(value),
        other => Err(DbError::InvalidEnum {
            value: other.to_string(),
        }),
    }
}

pub fn decode_enum<T: DeserializeOwned>(value: &str) -> Result<T, DbError> {
    let json = Value::String(value.to_string());
    serde_json::from_value(json).map_err(|err| DbError::JsonDecode {
        message: err.to_string(),
    })
}
