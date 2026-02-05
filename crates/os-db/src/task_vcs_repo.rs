use crate::util::{decode_enum, encode_enum, from_rfc3339, to_rfc3339};
use os_core::error::VcsError;
use os_core::types::enums::VcsType;
use os_core::types::ids::{AnyTaskId, RepoId};
use os_core::types::vcs::TaskVcs;
use os_core::vcs::TaskVcsRepository;
use rusqlite::Connection;

pub struct TaskVcsRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> TaskVcsRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> TaskVcsRepository for TaskVcsRepo<'a> {
    fn create(&self, task_vcs: TaskVcs) -> Result<TaskVcs, VcsError> {
        let sql = "INSERT INTO task_vcs (task_id, repo_id, vcs_type, ref_name, change_id, base_commit, head_commit, start_commit, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)";
        let params = (
            task_vcs.task_id.as_str(),
            task_vcs.repo_id.as_str(),
            encode_enum(&task_vcs.vcs_type).map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?,
            task_vcs.ref_name.clone(),
            task_vcs.change_id.clone(),
            task_vcs.base_commit.clone(),
            task_vcs.head_commit.clone(),
            task_vcs.start_commit.clone(),
            to_rfc3339(&task_vcs.created_at),
            to_rfc3339(&task_vcs.updated_at),
            task_vcs.archived_at.map(|value| to_rfc3339(&value)),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        Ok(task_vcs)
    }

    fn get(&self, task_id: &AnyTaskId) -> Result<Option<TaskVcs>, VcsError> {
        let mut stmt = self
            .conn
            .prepare("SELECT task_id, repo_id, vcs_type, ref_name, change_id, base_commit, head_commit, start_commit, created_at, updated_at, archived_at FROM task_vcs WHERE task_id = ?1")
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        let mut rows = stmt
            .query([task_id.as_str()])
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| VcsError::BackendError {
            reason: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_task_vcs_row(row).map(Some)
    }

    fn list(&self, repo_id: &RepoId) -> Result<Vec<TaskVcs>, VcsError> {
        let mut stmt = self
            .conn
            .prepare("SELECT task_id, repo_id, vcs_type, ref_name, change_id, base_commit, head_commit, start_commit, created_at, updated_at, archived_at FROM task_vcs WHERE repo_id = ?1 ORDER BY created_at ASC")
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        let mut rows = stmt
            .query([repo_id.as_str()])
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        let mut items = Vec::new();
        while let Some(row) = rows.next().map_err(|err| VcsError::BackendError {
            reason: err.to_string(),
        })? {
            items.push(map_task_vcs_row(row)?);
        }
        Ok(items)
    }

    fn update(&self, task_vcs: TaskVcs) -> Result<TaskVcs, VcsError> {
        let sql = "UPDATE task_vcs SET repo_id = ?1, vcs_type = ?2, ref_name = ?3, change_id = ?4, base_commit = ?5, head_commit = ?6, start_commit = ?7, updated_at = ?8, archived_at = ?9 WHERE task_id = ?10";
        let params = (
            task_vcs.repo_id.as_str(),
            encode_enum(&task_vcs.vcs_type).map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?,
            task_vcs.ref_name.clone(),
            task_vcs.change_id.clone(),
            task_vcs.base_commit.clone(),
            task_vcs.head_commit.clone(),
            task_vcs.start_commit.clone(),
            to_rfc3339(&task_vcs.updated_at),
            task_vcs.archived_at.map(|value| to_rfc3339(&value)),
            task_vcs.task_id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        Ok(task_vcs)
    }

    fn set_archived(
        &self,
        task_id: &AnyTaskId,
        archived_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<TaskVcs, VcsError> {
        let mut task_vcs = self.get(task_id)?.ok_or(VcsError::RefNotFound {
            name: task_id.as_str().to_string(),
        })?;
        task_vcs.archived_at = Some(archived_at);
        task_vcs.updated_at = chrono::Utc::now();
        let sql = "UPDATE task_vcs SET archived_at = ?1, updated_at = ?2 WHERE task_id = ?3";
        let params = (
            task_vcs.archived_at.map(|value| to_rfc3339(&value)),
            to_rfc3339(&task_vcs.updated_at),
            task_vcs.task_id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?;
        Ok(task_vcs)
    }
}

fn map_task_vcs_row(row: &rusqlite::Row<'_>) -> Result<TaskVcs, VcsError> {
    let task_id: String = row.get(0).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let repo_id: String = row.get(1).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let vcs_type: String = row.get(2).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let ref_name: String = row.get(3).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let change_id: String = row.get(4).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let base_commit: String = row.get(5).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let head_commit: Option<String> = row.get(6).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let start_commit: String = row.get(7).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let created_at: String = row.get(8).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let updated_at: String = row.get(9).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let archived_at: Option<String> = row.get(10).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;

    let task_id = AnyTaskId::parse(&task_id).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let repo_id = RepoId::new(repo_id).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;
    let vcs_type: VcsType = decode_enum(&vcs_type).map_err(|err| VcsError::BackendError {
        reason: err.to_string(),
    })?;

    Ok(TaskVcs {
        task_id,
        repo_id,
        vcs_type,
        ref_name,
        change_id,
        base_commit,
        head_commit,
        start_commit,
        created_at: from_rfc3339(&created_at).map_err(|err| VcsError::BackendError {
            reason: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| VcsError::BackendError {
            reason: err.to_string(),
        })?,
        archived_at: archived_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| VcsError::BackendError {
                reason: err.to_string(),
            })?,
    })
}
