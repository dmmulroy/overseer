use crate::util::{from_rfc3339, to_rfc3339};
use os_core::error::LearningError;
use os_core::learnings::LearningRepository;
use os_core::types::ids::{AnyTaskId, LearningId};
use os_core::types::learning::{InheritedLearnings, Learning};
use rusqlite::Connection;
use ulid::Ulid;

pub struct LearningRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> LearningRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> LearningRepository for LearningRepo<'a> {
    fn add(&self, task_id: &AnyTaskId, content: String) -> Result<Learning, LearningError> {
        let now = chrono::Utc::now();
        let learning = Learning {
            id: new_learning_id()?,
            task_id: task_id.clone(),
            content,
            source_task_id: None,
            created_at: now,
        };
        let sql = "INSERT INTO learnings (id, task_id, content, source_task_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)";
        let params = (
            learning.id.as_str(),
            learning.task_id.as_str(),
            learning.content.clone(),
            learning.source_task_id.as_ref().map(AnyTaskId::as_str),
            to_rfc3339(&learning.created_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| LearningError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(learning)
    }

    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<Learning>, LearningError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, content, source_task_id, created_at FROM learnings WHERE task_id = ?1 ORDER BY created_at ASC")
            .map_err(|err| LearningError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows =
            stmt.query([task_id.as_str()])
                .map_err(|err| LearningError::InvalidInput {
                    message: err.to_string(),
                })?;
        let mut learnings = Vec::new();
        while let Some(row) = rows.next().map_err(|err| LearningError::InvalidInput {
            message: err.to_string(),
        })? {
            learnings.push(map_learning_row(row)?);
        }
        Ok(learnings)
    }

    fn get_inherited(&self, task_id: &AnyTaskId) -> Result<InheritedLearnings, LearningError> {
        let (parent_id, milestone_id) = load_parent_chain(&self.conn, task_id)?;
        let own = self.list(task_id)?;
        let parent = match parent_id {
            Some(parent_id) => self.list(&parent_id)?,
            None => Vec::new(),
        };
        let milestone = match milestone_id {
            Some(milestone_id) => self.list(&milestone_id)?,
            None => Vec::new(),
        };
        Ok(InheritedLearnings {
            own,
            parent,
            milestone,
        })
    }

    fn bubble(&self, from: &AnyTaskId, to: &AnyTaskId) -> Result<Vec<Learning>, LearningError> {
        let source = self.list(from)?;
        let mut created = Vec::new();
        for learning in source {
            let now = chrono::Utc::now();
            let bubbled = Learning {
                id: new_learning_id()?,
                task_id: to.clone(),
                content: learning.content,
                source_task_id: Some(from.clone()),
                created_at: now,
            };
            let sql = "INSERT INTO learnings (id, task_id, content, source_task_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)";
            let params = (
                bubbled.id.as_str(),
                bubbled.task_id.as_str(),
                bubbled.content.clone(),
                bubbled.source_task_id.as_ref().map(AnyTaskId::as_str),
                to_rfc3339(&bubbled.created_at),
            );
            self.conn
                .execute(sql, params)
                .map_err(|err| LearningError::InvalidInput {
                    message: err.to_string(),
                })?;
            created.push(bubbled);
        }
        Ok(created)
    }
}

fn new_learning_id() -> Result<LearningId, LearningError> {
    let value = format!("{}{}", LearningId::PREFIX, Ulid::new());
    LearningId::new(value).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })
}

fn map_learning_row(row: &rusqlite::Row<'_>) -> Result<Learning, LearningError> {
    let id: String = row.get(0).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id: String = row.get(1).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let content: String = row.get(2).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let source_task_id: Option<String> = row.get(3).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(4).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = LearningId::new(id).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id = AnyTaskId::parse(&task_id).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let source_task_id = match source_task_id {
        Some(value) => {
            Some(
                AnyTaskId::parse(&value).map_err(|err| LearningError::InvalidInput {
                    message: err.to_string(),
                })?,
            )
        }
        None => None,
    };

    Ok(Learning {
        id,
        task_id,
        content,
        source_task_id,
        created_at: from_rfc3339(&created_at).map_err(|err| LearningError::InvalidInput {
            message: err.to_string(),
        })?,
    })
}

fn load_parent_chain(
    conn: &Connection,
    task_id: &AnyTaskId,
) -> Result<(Option<AnyTaskId>, Option<AnyTaskId>), LearningError> {
    let mut stmt = conn
        .prepare("SELECT parent_id FROM tasks WHERE id = ?1")
        .map_err(|err| LearningError::InvalidInput {
            message: err.to_string(),
        })?;
    let mut rows = stmt
        .query([task_id.as_str()])
        .map_err(|err| LearningError::InvalidInput {
            message: err.to_string(),
        })?;
    let Some(row) = rows.next().map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?
    else {
        return Ok((None, None));
    };
    let parent_id: Option<String> = row.get(0).map_err(|err| LearningError::InvalidInput {
        message: err.to_string(),
    })?;
    let parent_id = match parent_id {
        Some(value) => {
            Some(
                AnyTaskId::parse(&value).map_err(|err| LearningError::InvalidInput {
                    message: err.to_string(),
                })?,
            )
        }
        None => None,
    };

    let milestone_id = if let Some(parent) = &parent_id {
        let mut stmt = conn
            .prepare("SELECT parent_id FROM tasks WHERE id = ?1")
            .map_err(|err| LearningError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows =
            stmt.query([parent.as_str()])
                .map_err(|err| LearningError::InvalidInput {
                    message: err.to_string(),
                })?;
        let Some(row) = rows.next().map_err(|err| LearningError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok((parent_id, None));
        };
        let parent_parent: Option<String> =
            row.get(0).map_err(|err| LearningError::InvalidInput {
                message: err.to_string(),
            })?;
        match parent_parent {
            Some(value) => {
                Some(
                    AnyTaskId::parse(&value).map_err(|err| LearningError::InvalidInput {
                        message: err.to_string(),
                    })?,
                )
            }
            None => Some(parent.clone()),
        }
    } else {
        None
    };

    Ok((parent_id, milestone_id))
}
