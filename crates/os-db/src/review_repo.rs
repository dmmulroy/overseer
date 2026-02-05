use crate::util::{decode_enum, encode_enum, from_rfc3339, to_rfc3339};
use os_core::error::ReviewError;
use os_core::reviews::ReviewRepository;
use os_core::types::enums::{CommentAuthor, DiffSide, ReviewStatus};
use os_core::types::ids::{AnyTaskId, CommentId, ReviewId};
use os_core::types::io::CreateCommentInput;
use os_core::types::review::{Review, ReviewComment};
use rusqlite::Connection;
use ulid::Ulid;

pub struct ReviewRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> ReviewRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> ReviewRepository for ReviewRepo<'a> {
    fn create(&self, task_id: &AnyTaskId) -> Result<Review, ReviewError> {
        let now = chrono::Utc::now();
        let id = new_review_id()?;
        let review = Review {
            id,
            task_id: task_id.clone(),
            status: ReviewStatus::GatesPending,
            submitted_at: now,
            gates_completed_at: None,
            agent_completed_at: None,
            human_completed_at: None,
            created_at: now,
            updated_at: now,
        };

        let sql = "INSERT INTO reviews (id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";
        let params = (
            review.id.as_str(),
            review.task_id.as_str(),
            encode_enum(&review.status).map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&review.submitted_at),
            review.gates_completed_at.map(|value| to_rfc3339(&value)),
            review.agent_completed_at.map(|value| to_rfc3339(&value)),
            review.human_completed_at.map(|value| to_rfc3339(&value)),
            to_rfc3339(&review.created_at),
            to_rfc3339(&review.updated_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(review)
    }

    fn get(&self, id: &ReviewId) -> Result<Option<Review>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at FROM reviews WHERE id = ?1")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_review_row(row).map(Some)
    }

    fn get_active_for_task(&self, task_id: &AnyTaskId) -> Result<Option<Review>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at FROM reviews WHERE task_id = ?1 AND status IN ('GatesPending', 'GatesEscalated', 'AgentPending', 'HumanPending') ORDER BY created_at DESC LIMIT 1")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([task_id.as_str()])
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_review_row(row).map(Some)
    }

    fn list_for_task(&self, task_id: &AnyTaskId) -> Result<Vec<Review>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at FROM reviews WHERE task_id = ?1 ORDER BY created_at DESC")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([task_id.as_str()])
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut reviews = Vec::new();
        while let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })? {
            reviews.push(map_review_row(row)?);
        }
        Ok(reviews)
    }

    fn list_by_status(&self, status: ReviewStatus) -> Result<Vec<Review>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at FROM reviews WHERE status = ?1 ORDER BY created_at DESC")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let status = encode_enum(&status).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?;
        let mut rows = stmt
            .query([status])
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut reviews = Vec::new();
        while let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })? {
            reviews.push(map_review_row(row)?);
        }
        Ok(reviews)
    }

    fn update_status(&self, id: &ReviewId, status: ReviewStatus) -> Result<Review, ReviewError> {
        let mut review = self.get(id)?.ok_or(ReviewError::ReviewNotFound)?;
        review.status = status;
        let now = chrono::Utc::now();
        review.updated_at = now;
        if matches!(
            status,
            ReviewStatus::AgentPending
                | ReviewStatus::HumanPending
                | ReviewStatus::Approved
                | ReviewStatus::ChangesRequested
                | ReviewStatus::GatesEscalated
        ) && review.gates_completed_at.is_none()
        {
            review.gates_completed_at = Some(now);
        }
        if matches!(
            status,
            ReviewStatus::HumanPending | ReviewStatus::Approved | ReviewStatus::ChangesRequested
        ) && review.agent_completed_at.is_none()
        {
            review.agent_completed_at = Some(now);
        }
        if matches!(
            status,
            ReviewStatus::Approved | ReviewStatus::ChangesRequested
        ) && review.human_completed_at.is_none()
        {
            review.human_completed_at = Some(now);
        }

        let sql = "UPDATE reviews SET status = ?1, gates_completed_at = ?2, agent_completed_at = ?3, human_completed_at = ?4, updated_at = ?5 WHERE id = ?6";
        let params = (
            encode_enum(&review.status).map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
            review.gates_completed_at.map(|value| to_rfc3339(&value)),
            review.agent_completed_at.map(|value| to_rfc3339(&value)),
            review.human_completed_at.map(|value| to_rfc3339(&value)),
            to_rfc3339(&review.updated_at),
            review.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(review)
    }

    fn add_comment(&self, input: CreateCommentInput) -> Result<ReviewComment, ReviewError> {
        let now = chrono::Utc::now();
        let id = new_comment_id()?;
        let comment = ReviewComment {
            id,
            review_id: input.review_id,
            task_id: input.task_id,
            author: input.author,
            file_path: input.file_path,
            line_start: input.line_start,
            line_end: input.line_end,
            side: input.side,
            body: input.body,
            created_at: now,
            resolved_at: None,
        };

        let sql = "INSERT INTO review_comments (id, review_id, task_id, author, file_path, line_start, line_end, side, body, created_at, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)";
        let params = (
            comment.id.as_str(),
            comment.review_id.as_str(),
            comment.task_id.as_str(),
            encode_enum(&comment.author).map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
            comment.file_path.clone(),
            comment.line_start.map(i64::from),
            comment.line_end.map(i64::from),
            encode_enum(&comment.side).map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
            comment.body.clone(),
            to_rfc3339(&comment.created_at),
            comment.resolved_at.map(|value| to_rfc3339(&value)),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(comment)
    }

    fn list_comments(&self, review_id: &ReviewId) -> Result<Vec<ReviewComment>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, review_id, task_id, author, file_path, line_start, line_end, side, body, created_at, resolved_at FROM review_comments WHERE review_id = ?1 ORDER BY created_at ASC")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows =
            stmt.query([review_id.as_str()])
                .map_err(|err| ReviewError::InvalidInput {
                    message: err.to_string(),
                })?;
        let mut comments = Vec::new();
        while let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })? {
            comments.push(map_comment_row(row)?);
        }
        Ok(comments)
    }

    fn resolve_comment(&self, id: &CommentId) -> Result<ReviewComment, ReviewError> {
        let mut comment = self.get_comment(id)?.ok_or(ReviewError::CommentNotFound)?;
        comment.resolved_at = Some(chrono::Utc::now());
        let sql = "UPDATE review_comments SET resolved_at = ?1 WHERE id = ?2";
        self.conn
            .execute(
                sql,
                (
                    comment.resolved_at.map(|value| to_rfc3339(&value)),
                    comment.id.as_str(),
                ),
            )
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(comment)
    }
}

impl<'a> ReviewRepo<'a> {
    fn get_comment(&self, id: &CommentId) -> Result<Option<ReviewComment>, ReviewError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, review_id, task_id, author, file_path, line_start, line_end, side, body, created_at, resolved_at FROM review_comments WHERE id = ?1")
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_comment_row(row).map(Some)
    }
}

fn new_review_id() -> Result<ReviewId, ReviewError> {
    let value = format!("{}{}", ReviewId::PREFIX, Ulid::new());
    ReviewId::new(value).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })
}

fn new_comment_id() -> Result<CommentId, ReviewError> {
    let value = format!("{}{}", CommentId::PREFIX, Ulid::new());
    CommentId::new(value).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })
}

fn map_review_row(row: &rusqlite::Row<'_>) -> Result<Review, ReviewError> {
    let id: String = row.get(0).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id: String = row.get(1).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: String = row.get(2).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let submitted_at: String = row.get(3).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let gates_completed_at: Option<String> =
        row.get(4).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?;
    let agent_completed_at: Option<String> =
        row.get(5).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?;
    let human_completed_at: Option<String> =
        row.get(6).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?;
    let created_at: String = row.get(7).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let updated_at: String = row.get(8).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = ReviewId::new(id).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id = AnyTaskId::parse(&task_id).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: ReviewStatus = decode_enum(&status).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;

    Ok(Review {
        id,
        task_id,
        status,
        submitted_at: from_rfc3339(&submitted_at).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?,
        gates_completed_at: gates_completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
        agent_completed_at: agent_completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
        human_completed_at: human_completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
        created_at: from_rfc3339(&created_at).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?,
    })
}

fn map_comment_row(row: &rusqlite::Row<'_>) -> Result<ReviewComment, ReviewError> {
    let id: String = row.get(0).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let review_id: String = row.get(1).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id: String = row.get(2).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let author: String = row.get(3).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let file_path: String = row.get(4).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let line_start: Option<i64> = row.get(5).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let line_end: Option<i64> = row.get(6).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let side: String = row.get(7).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let body: String = row.get(8).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(9).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let resolved_at: Option<String> = row.get(10).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = CommentId::new(id).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let review_id = ReviewId::new(review_id).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id = AnyTaskId::parse(&task_id).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let author: CommentAuthor = decode_enum(&author).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;
    let side: DiffSide = decode_enum(&side).map_err(|err| ReviewError::InvalidInput {
        message: err.to_string(),
    })?;

    Ok(ReviewComment {
        id,
        review_id,
        task_id,
        author,
        file_path,
        line_start: line_start.map(|value| value as u32),
        line_end: line_end.map(|value| value as u32),
        side,
        body,
        created_at: from_rfc3339(&created_at).map_err(|err| ReviewError::InvalidInput {
            message: err.to_string(),
        })?,
        resolved_at: resolved_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| ReviewError::InvalidInput {
                message: err.to_string(),
            })?,
    })
}
