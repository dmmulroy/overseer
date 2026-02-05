use os_core::error::GitAiError;
use os_core::git_ai::GitAiRepository;
use os_core::types::git_ai::{GitAiReview, GitAiReviewInput, GitAiReviewOutput, GitAiReviewStatus};
use os_core::types::ids::ReviewId;
use rusqlite::Connection;

pub struct GitAiRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> GitAiRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> GitAiRepository for GitAiRepo<'a> {
    fn create(&self, input: GitAiReviewInput) -> Result<GitAiReview, GitAiError> {
        let now = chrono::Utc::now();
        let review_id = input.review_id.clone();
        let record = GitAiReview {
            review_id: review_id.clone(),
            task_id: input.task_id.clone(),
            status: GitAiReviewStatus::Pending,
            input: input.clone(),
            output: None,
            error: None,
            created_at: now,
            updated_at: now,
        };
        let sql = "INSERT INTO git_ai_reviews (review_id, task_id, status, input_json, output_json, error, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)";
        let params = (
            record.review_id.as_str(),
            record.task_id.as_str(),
            encode_status(record.status)?,
            encode_json(&record.input)?,
            Option::<String>::None,
            Option::<String>::None,
            to_rfc3339(&record.created_at),
            to_rfc3339(&record.updated_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GitAiError::Internal {
                message: err.to_string(),
            })?;
        Ok(record)
    }

    fn get(&self, review_id: &ReviewId) -> Result<Option<GitAiReview>, GitAiError> {
        let mut stmt = self
            .conn
            .prepare("SELECT review_id, task_id, status, input_json, output_json, error, created_at, updated_at FROM git_ai_reviews WHERE review_id = ?1")
            .map_err(|err| GitAiError::Internal {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([review_id.as_str()])
            .map_err(|err| GitAiError::Internal {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| GitAiError::Internal {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_row(&row).map(Some)
    }

    fn set_result(
        &self,
        review_id: &ReviewId,
        output: GitAiReviewOutput,
    ) -> Result<GitAiReview, GitAiError> {
        let now = chrono::Utc::now();
        let sql = "UPDATE git_ai_reviews SET status = ?1, output_json = ?2, error = NULL, updated_at = ?3 WHERE review_id = ?4";
        let params = (
            encode_status(GitAiReviewStatus::Completed)?,
            encode_json(&output)?,
            to_rfc3339(&now),
            review_id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GitAiError::Internal {
                message: err.to_string(),
            })?;
        self.get(review_id)?.ok_or(GitAiError::Internal {
            message: "git-ai review not found".to_string(),
        })
    }

    fn set_failed(&self, review_id: &ReviewId, error: String) -> Result<GitAiReview, GitAiError> {
        let now = chrono::Utc::now();
        let sql = "UPDATE git_ai_reviews SET status = ?1, error = ?2, updated_at = ?3 WHERE review_id = ?4";
        let params = (
            encode_status(GitAiReviewStatus::Failed)?,
            error,
            to_rfc3339(&now),
            review_id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GitAiError::Internal {
                message: err.to_string(),
            })?;
        self.get(review_id)?.ok_or(GitAiError::Internal {
            message: "git-ai review not found".to_string(),
        })
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> Result<GitAiReview, GitAiError> {
    let review_id: String = row.get(0).map_err(map_err)?;
    let task_id: String = row.get(1).map_err(map_err)?;
    let status: String = row.get(2).map_err(map_err)?;
    let input_json: String = row.get(3).map_err(map_err)?;
    let output_json: Option<String> = row.get(4).map_err(map_err)?;
    let error: Option<String> = row.get(5).map_err(map_err)?;
    let created_at: String = row.get(6).map_err(map_err)?;
    let updated_at: String = row.get(7).map_err(map_err)?;

    Ok(GitAiReview {
        review_id: ReviewId::new(review_id).map_err(|err| GitAiError::InvalidInput {
            message: err.to_string(),
        })?,
        task_id: os_core::types::AnyTaskId::parse(&task_id).map_err(|err| {
            GitAiError::InvalidInput {
                message: err.to_string(),
            }
        })?,
        status: decode_status(&status)?,
        input: decode_json(&input_json)?,
        output: output_json.map(|value| decode_json(&value)).transpose()?,
        error,
        created_at: parse_rfc3339(&created_at)?,
        updated_at: parse_rfc3339(&updated_at)?,
    })
}

fn encode_status(status: GitAiReviewStatus) -> Result<String, GitAiError> {
    let value = serde_json::to_value(status).map_err(map_err)?;
    let Some(text) = value.as_str() else {
        return Err(GitAiError::InvalidInput {
            message: "invalid status".to_string(),
        });
    };
    Ok(text.to_string())
}

fn decode_status(status: &str) -> Result<GitAiReviewStatus, GitAiError> {
    serde_json::from_str(&format!("\"{status}\"")).map_err(map_err)
}

fn encode_json<T: serde::Serialize>(value: &T) -> Result<String, GitAiError> {
    serde_json::to_string(value).map_err(map_err)
}

fn decode_json<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, GitAiError> {
    serde_json::from_str(value).map_err(map_err)
}

fn to_rfc3339(value: &chrono::DateTime<chrono::Utc>) -> String {
    value.to_rfc3339()
}

fn parse_rfc3339(value: &str) -> Result<chrono::DateTime<chrono::Utc>, GitAiError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&chrono::Utc))
        .map_err(map_err)
}

fn map_err<E: std::fmt::Display>(err: E) -> GitAiError {
    GitAiError::Internal {
        message: err.to_string(),
    }
}
