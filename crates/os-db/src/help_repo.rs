use crate::util::{decode_enum, decode_json, encode_enum, encode_json, from_rfc3339, to_rfc3339};
use os_core::error::HelpError;
use os_core::help::HelpRepository;
use os_core::types::enums::{HelpCategory, HelpRequestStatus, TaskStatus};
use os_core::types::help::HelpRequest;
use os_core::types::ids::{AnyTaskId, HelpRequestId, RepoId};
use os_core::types::io::{CreateHelpRequestInput, HelpResponseInput};
use os_core::types::task::Task;
use rusqlite::Connection;
use ulid::Ulid;

pub struct HelpRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> HelpRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> HelpRepository for HelpRepo<'a> {
    fn request(&self, input: CreateHelpRequestInput) -> Result<HelpRequest, HelpError> {
        let task = load_task(&self.conn, &input.task_id)?;
        let now = chrono::Utc::now();
        let request = HelpRequest {
            id: new_help_id()?,
            task_id: input.task_id,
            from_status: task.status,
            category: input.category,
            reason: input.reason,
            suggested_options: input.suggested_options,
            status: HelpRequestStatus::Pending,
            response: None,
            chosen_option: None,
            created_at: now,
            responded_at: None,
            resumed_at: None,
        };
        let sql = "INSERT INTO help_requests (id, task_id, from_status, category, reason, options, status, response, chosen_option, created_at, responded_at, resumed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)";
        let params = (
            request.id.as_str(),
            request.task_id.as_str(),
            encode_enum(&request.from_status).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            encode_enum(&request.category).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            request.reason.clone(),
            encode_json(&request.suggested_options).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            encode_enum(&request.status).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            request.response.clone(),
            request.chosen_option.map(|value| value as i64),
            to_rfc3339(&request.created_at),
            request.responded_at.map(|value| to_rfc3339(&value)),
            request.resumed_at.map(|value| to_rfc3339(&value)),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(request)
    }

    fn get_active(&self, task_id: &AnyTaskId) -> Result<Option<HelpRequest>, HelpError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, from_status, category, reason, options, status, response, chosen_option, created_at, responded_at, resumed_at FROM help_requests WHERE task_id = ?1 AND status IN ('Pending', 'Responded') ORDER BY created_at DESC LIMIT 1")
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([task_id.as_str()])
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_help_row(row).map(Some)
    }

    fn get(&self, id: &HelpRequestId) -> Result<Option<HelpRequest>, HelpError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, from_status, category, reason, options, status, response, chosen_option, created_at, responded_at, resumed_at FROM help_requests WHERE id = ?1")
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_help_row(row).map(Some)
    }

    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<HelpRequest>, HelpError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, task_id, from_status, category, reason, options, status, response, chosen_option, created_at, responded_at, resumed_at FROM help_requests WHERE task_id = ?1 ORDER BY created_at DESC")
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([task_id.as_str()])
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut requests = Vec::new();
        while let Some(row) = rows.next().map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })? {
            requests.push(map_help_row(row)?);
        }
        Ok(requests)
    }

    fn respond(
        &self,
        id: &HelpRequestId,
        input: HelpResponseInput,
    ) -> Result<HelpRequest, HelpError> {
        let mut request = self.get(id)?.ok_or(HelpError::HelpNotFound)?;
        request.status = HelpRequestStatus::Responded;
        request.response = Some(input.response);
        request.chosen_option = input.chosen_option;
        request.responded_at = Some(chrono::Utc::now());
        let sql = "UPDATE help_requests SET status = ?1, response = ?2, chosen_option = ?3, responded_at = ?4 WHERE id = ?5";
        let params = (
            encode_enum(&request.status).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            request.response.clone(),
            request.chosen_option.map(|value| value as i64),
            request.responded_at.map(|value| to_rfc3339(&value)),
            request.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(request)
    }

    fn resume(&self, task_id: &AnyTaskId) -> Result<Task, HelpError> {
        let request = self.get_active(task_id)?.ok_or(HelpError::HelpNotFound)?;
        if request.status != HelpRequestStatus::Responded {
            return Err(HelpError::InvalidState {
                message: "help request not responded".to_string(),
            });
        }
        let resumed_at = chrono::Utc::now();
        let sql = "UPDATE help_requests SET status = ?1, resumed_at = ?2 WHERE id = ?3";
        self.conn
            .execute(
                sql,
                (
                    encode_enum(&HelpRequestStatus::Resolved).map_err(|err| {
                        HelpError::InvalidInput {
                            message: err.to_string(),
                        }
                    })?,
                    to_rfc3339(&resumed_at),
                    request.id.as_str(),
                ),
            )
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?;
        update_task_status(&self.conn, task_id, request.from_status)
    }
}

fn new_help_id() -> Result<HelpRequestId, HelpError> {
    let value = format!("{}{}", HelpRequestId::PREFIX, Ulid::new());
    HelpRequestId::new(value).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })
}

fn map_help_row(row: &rusqlite::Row<'_>) -> Result<HelpRequest, HelpError> {
    let id: String = row.get(0).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id: String = row.get(1).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let from_status: String = row.get(2).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let category: String = row.get(3).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let reason: String = row.get(4).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let options: String = row.get(5).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: String = row.get(6).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let response: Option<String> = row.get(7).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let chosen_option: Option<i64> = row.get(8).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(9).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let responded_at: Option<String> = row.get(10).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let resumed_at: Option<String> = row.get(11).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = HelpRequestId::new(id).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id = AnyTaskId::parse(&task_id).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let from_status: TaskStatus =
        decode_enum(&from_status).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;
    let category: HelpCategory = decode_enum(&category).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: HelpRequestStatus =
        decode_enum(&status).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;
    let suggested_options: Vec<String> =
        decode_json(&options).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;

    Ok(HelpRequest {
        id,
        task_id,
        from_status,
        category,
        reason,
        suggested_options,
        status,
        response,
        chosen_option: chosen_option.map(|value| value as usize),
        created_at: from_rfc3339(&created_at).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?,
        responded_at: responded_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
        resumed_at: resumed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
    })
}

fn load_task(conn: &Connection, task_id: &AnyTaskId) -> Result<Task, HelpError> {
    let mut stmt = conn
        .prepare("SELECT id, repo_id, parent_id, kind, description, context, priority, status, blocked_by, created_at, updated_at, started_at, completed_at FROM tasks WHERE id = ?1")
        .map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;
    let mut rows = stmt
        .query([task_id.as_str()])
        .map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;
    let Some(row) = rows.next().map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?
    else {
        return Err(HelpError::HelpNotFound);
    };
    map_task_row(row)
}

fn update_task_status(
    conn: &Connection,
    task_id: &AnyTaskId,
    status: TaskStatus,
) -> Result<Task, HelpError> {
    let updated_at = chrono::Utc::now();
    conn.execute(
        "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
        (
            encode_enum(&status).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&updated_at),
            task_id.as_str(),
        ),
    )
    .map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    load_task(conn, task_id)
}

fn map_task_row(row: &rusqlite::Row<'_>) -> Result<Task, HelpError> {
    let id: String = row.get(0).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let repo_id: String = row.get(1).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let parent_id: Option<String> = row.get(2).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let kind: String = row.get(3).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let description: String = row.get(4).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let context: Option<String> = row.get(5).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let priority: String = row.get(6).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: String = row.get(7).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let blocked_by: String = row.get(8).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(9).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let updated_at: String = row.get(10).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let started_at: Option<String> = row.get(11).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let completed_at: Option<String> = row.get(12).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = AnyTaskId::parse(&id).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let repo_id = RepoId::new(repo_id).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let parent_id = match parent_id {
        Some(value) => Some(
            AnyTaskId::parse(&value).map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
        ),
        None => None,
    };
    let kind = decode_enum(&kind).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let priority = decode_enum(&priority).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let status = decode_enum(&status).map_err(|err| HelpError::InvalidInput {
        message: err.to_string(),
    })?;
    let blocked_by: Vec<AnyTaskId> =
        decode_json(&blocked_by).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?;

    Ok(Task {
        id,
        repo_id,
        parent_id,
        kind,
        description,
        context,
        priority,
        status,
        blocked_by,
        created_at: from_rfc3339(&created_at).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| HelpError::InvalidInput {
            message: err.to_string(),
        })?,
        started_at: started_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
        completed_at: completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| HelpError::InvalidInput {
                message: err.to_string(),
            })?,
    })
}
