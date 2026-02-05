use crate::util::{decode_enum, encode_enum, from_rfc3339, to_rfc3339};
use os_core::error::GateError;
use os_core::gates::GateRepository;
use os_core::types::enums::GateStatus;
use os_core::types::gate::{Gate, GateResult, GateScope};
use os_core::types::ids::{AnyTaskId, GateId, RepoId, ReviewId};
use os_core::types::io::{CreateGateInput, UpdateGateInput};
use rusqlite::Connection;
use ulid::Ulid;

pub struct GateRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> GateRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> GateRepository for GateRepo<'a> {
    fn add(&self, input: CreateGateInput) -> Result<Gate, GateError> {
        let existing = self.list(&input.scope)?;
        if existing.iter().any(|gate| gate.name == input.name) {
            return Err(GateError::NameConflict);
        }

        let now = chrono::Utc::now();
        let gate = Gate {
            id: new_gate_id()?,
            scope: input.scope,
            name: input.name,
            command: input.command,
            timeout_secs: input.timeout_secs.unwrap_or(300),
            max_retries: input.max_retries.unwrap_or(3),
            poll_interval_secs: input.poll_interval_secs.unwrap_or(30),
            max_pending_secs: input.max_pending_secs.unwrap_or(86_400),
            created_at: now,
            updated_at: now,
        };
        let (scope_type, scope_id) = scope_parts(&gate.scope);
        let sql = "INSERT INTO gates (id, scope_type, scope_id, name, command, timeout_secs, max_retries, poll_interval_secs, max_pending_secs, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)";
        let params = (
            gate.id.as_str(),
            scope_type,
            scope_id,
            gate.name.clone(),
            gate.command.clone(),
            i64::from(gate.timeout_secs),
            i64::from(gate.max_retries),
            i64::from(gate.poll_interval_secs),
            i64::from(gate.max_pending_secs),
            to_rfc3339(&gate.created_at),
            to_rfc3339(&gate.updated_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(gate)
    }

    fn get(&self, id: &GateId) -> Result<Option<Gate>, GateError> {
        self.get_by_id(id)
    }

    fn get_effective(&self, task_id: &AnyTaskId) -> Result<Vec<Gate>, GateError> {
        let (repo_id, task_chain) = load_task_chain(&self.conn, task_id)?;
        let mut scopes = Vec::new();
        scopes.push(GateScope::Repo(repo_id));
        for id in task_chain {
            scopes.push(GateScope::Task(id));
        }
        let mut gates = Vec::new();
        for scope in scopes {
            gates.extend(self.list(&scope)?);
        }
        Ok(gates)
    }

    fn list(&self, scope: &GateScope) -> Result<Vec<Gate>, GateError> {
        let (scope_type, scope_id) = scope_parts(scope);
        let mut stmt = self
            .conn
            .prepare("SELECT id, scope_type, scope_id, name, command, timeout_secs, max_retries, poll_interval_secs, max_pending_secs, created_at, updated_at FROM gates WHERE scope_type = ?1 AND scope_id = ?2 ORDER BY created_at ASC")
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows =
            stmt.query([scope_type, scope_id])
                .map_err(|err| GateError::InvalidInput {
                    message: err.to_string(),
                })?;
        let mut gates = Vec::new();
        while let Some(row) = rows.next().map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })? {
            gates.push(map_gate_row(row)?);
        }
        Ok(gates)
    }

    fn remove(&self, id: &GateId) -> Result<(), GateError> {
        let affected = self
            .conn
            .execute("DELETE FROM gates WHERE id = ?1", [id.as_str()])
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        if affected == 0 {
            return Err(GateError::GateNotFound);
        }
        Ok(())
    }

    fn update(&self, id: &GateId, input: UpdateGateInput) -> Result<Gate, GateError> {
        let mut gate = self.get(id)?.ok_or(GateError::GateNotFound)?;
        if let Some(command) = input.command {
            gate.command = command;
        }
        if let Some(value) = input.timeout_secs {
            gate.timeout_secs = value;
        }
        if let Some(value) = input.max_retries {
            gate.max_retries = value;
        }
        if let Some(value) = input.poll_interval_secs {
            gate.poll_interval_secs = value;
        }
        if let Some(value) = input.max_pending_secs {
            gate.max_pending_secs = value;
        }
        gate.updated_at = chrono::Utc::now();
        let sql = "UPDATE gates SET command = ?1, timeout_secs = ?2, max_retries = ?3, poll_interval_secs = ?4, max_pending_secs = ?5, updated_at = ?6 WHERE id = ?7";
        let params = (
            gate.command.clone(),
            i64::from(gate.timeout_secs),
            i64::from(gate.max_retries),
            i64::from(gate.poll_interval_secs),
            i64::from(gate.max_pending_secs),
            to_rfc3339(&gate.updated_at),
            gate.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(gate)
    }

    fn record_result(&self, result: GateResult) -> Result<(), GateError> {
        let sql = "INSERT INTO gate_results (gate_id, review_id, task_id, status, stdout, stderr, exit_code, attempt, started_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(gate_id, review_id, attempt) DO UPDATE SET status = excluded.status, stdout = excluded.stdout, stderr = excluded.stderr, exit_code = excluded.exit_code, started_at = excluded.started_at, completed_at = excluded.completed_at";
        let params = (
            result.gate_id.as_str(),
            result.review_id.as_str(),
            result.task_id.as_str(),
            encode_enum(&result.status).map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?,
            result.stdout,
            result.stderr,
            result.exit_code,
            i64::from(result.attempt),
            to_rfc3339(&result.started_at),
            result.completed_at.map(|value| to_rfc3339(&value)),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(())
    }

    fn get_results(&self, review_id: &ReviewId) -> Result<Vec<GateResult>, GateError> {
        let mut stmt = self
            .conn
            .prepare("SELECT gate_id, review_id, task_id, status, stdout, stderr, exit_code, attempt, started_at, completed_at FROM gate_results WHERE review_id = ?1 ORDER BY started_at ASC")
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([review_id.as_str()])
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })? {
            results.push(map_gate_result_row(row)?);
        }
        Ok(results)
    }
}

impl<'a> GateRepo<'a> {
    fn get_by_id(&self, id: &GateId) -> Result<Option<Gate>, GateError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, scope_type, scope_id, name, command, timeout_secs, max_retries, poll_interval_secs, max_pending_secs, created_at, updated_at FROM gates WHERE id = ?1")
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_gate_row(row).map(Some)
    }
}

fn new_gate_id() -> Result<GateId, GateError> {
    let value = format!("{}{}", GateId::PREFIX, Ulid::new());
    GateId::new(value).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })
}

fn scope_parts(scope: &GateScope) -> (String, String) {
    match scope {
        GateScope::Repo(id) => ("Repo".to_string(), id.as_str().to_string()),
        GateScope::Task(id) => ("Task".to_string(), id.as_str().to_string()),
    }
}

fn load_task_chain(
    conn: &Connection,
    task_id: &AnyTaskId,
) -> Result<(RepoId, Vec<AnyTaskId>), GateError> {
    let mut current = Some(task_id.as_str().to_string());
    let mut chain = Vec::new();
    let mut repo_id: Option<RepoId> = None;
    while let Some(id) = current.take() {
        let mut stmt = conn
            .prepare("SELECT repo_id, parent_id FROM tasks WHERE id = ?1")
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.clone()])
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Err(GateError::GateNotFound);
        };
        let repo_id_value: String = row.get(0).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?;
        let parent_id: Option<String> = row.get(1).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?;
        if repo_id.is_none() {
            repo_id = Some(
                RepoId::new(repo_id_value).map_err(|err| GateError::InvalidInput {
                    message: err.to_string(),
                })?,
            );
        }
        let any_id = AnyTaskId::parse(&id).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?;
        chain.push(any_id);
        current = parent_id;
    }
    let repo_id = repo_id.ok_or(GateError::GateNotFound)?;
    Ok((repo_id, chain))
}

fn map_gate_row(row: &rusqlite::Row<'_>) -> Result<Gate, GateError> {
    let id: String = row.get(0).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let scope_type: String = row.get(1).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let scope_id: String = row.get(2).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let name: String = row.get(3).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let command: String = row.get(4).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let timeout_secs: i64 = row.get(5).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let max_retries: i64 = row.get(6).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let poll_interval_secs: i64 = row.get(7).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let max_pending_secs: i64 = row.get(8).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(9).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let updated_at: String = row.get(10).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = GateId::new(id).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let scope =
        match scope_type.as_str() {
            "Repo" => {
                GateScope::Repo(
                    RepoId::new(scope_id).map_err(|err| GateError::InvalidInput {
                        message: err.to_string(),
                    })?,
                )
            }
            "Task" => GateScope::Task(AnyTaskId::parse(&scope_id).map_err(|err| {
                GateError::InvalidInput {
                    message: err.to_string(),
                }
            })?),
            _ => {
                return Err(GateError::InvalidInput {
                    message: format!("unknown gate scope type: {scope_type}"),
                })
            }
        };

    Ok(Gate {
        id,
        scope,
        name,
        command,
        timeout_secs: timeout_secs as u32,
        max_retries: max_retries as u32,
        poll_interval_secs: poll_interval_secs as u32,
        max_pending_secs: max_pending_secs as u32,
        created_at: from_rfc3339(&created_at).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?,
    })
}

fn map_gate_result_row(row: &rusqlite::Row<'_>) -> Result<GateResult, GateError> {
    let gate_id: String = row.get(0).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let review_id: String = row.get(1).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id: String = row.get(2).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: String = row.get(3).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let stdout: String = row.get(4).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let stderr: String = row.get(5).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let exit_code: Option<i64> = row.get(6).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let attempt: i64 = row.get(7).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let started_at: String = row.get(8).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let completed_at: Option<String> = row.get(9).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;

    let gate_id = GateId::new(gate_id).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let review_id = ReviewId::new(review_id).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let task_id = AnyTaskId::parse(&task_id).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: GateStatus = decode_enum(&status).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;

    Ok(GateResult {
        gate_id,
        review_id,
        task_id,
        status,
        stdout,
        stderr,
        exit_code: exit_code.map(|value| value as i32),
        attempt: attempt as u32,
        started_at: from_rfc3339(&started_at).map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?,
        completed_at: completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| GateError::InvalidInput {
                message: err.to_string(),
            })?,
    })
}
