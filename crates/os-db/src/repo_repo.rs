use os_core::error::RepoError;
use os_core::repos::RepoRepository;
use os_core::types::enums::VcsType;
use os_core::types::ids::RepoId;
use os_core::types::repo::Repo;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use ulid::Ulid;

use crate::util::{decode_enum, encode_enum, from_rfc3339, to_rfc3339};

pub struct RepoRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> RepoRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

fn detect_vcs_type(path: &Path) -> Result<VcsType, RepoError> {
    let jj = path.join(".jj");
    if jj.exists() {
        return Ok(VcsType::Jj);
    }
    let git = path.join(".git");
    if git.exists() {
        return Ok(VcsType::Git);
    }
    Err(RepoError::InvalidInput {
        message: "path is not a jj or git repo".to_string(),
    })
}

fn new_repo_id() -> Result<RepoId, RepoError> {
    let value = format!("{}{}", RepoId::PREFIX, Ulid::new());
    RepoId::new(value).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })
}

impl<'a> RepoRepository for RepoRepo<'a> {
    fn register(&self, path: PathBuf) -> Result<Repo, RepoError> {
        let existing = self.get_by_path(&path)?;
        if existing.is_some() {
            return Err(RepoError::RepoExists);
        }

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| RepoError::InvalidInput {
                message: "path has no valid file name".to_string(),
            })?
            .to_string();
        let vcs_type = detect_vcs_type(&path)?;
        let now = chrono::Utc::now();
        let repo = Repo {
            id: new_repo_id()?,
            path: path.clone(),
            name,
            vcs_type,
            created_at: now,
            updated_at: now,
        };

        let sql = "INSERT INTO repos (id, path, name, vcs_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";
        let params = (
            repo.id.as_str(),
            repo.path.to_string_lossy().to_string(),
            repo.name.clone(),
            encode_enum(&repo.vcs_type).map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&repo.created_at),
            to_rfc3339(&repo.updated_at),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(repo)
    }

    fn get(&self, id: &RepoId) -> Result<Option<Repo>, RepoError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, path, name, vcs_type, created_at, updated_at FROM repos WHERE id = ?1",
            )
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_repo_row(row).map(Some)
    }

    fn get_by_path(&self, path: &Path) -> Result<Option<Repo>, RepoError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, name, vcs_type, created_at, updated_at FROM repos WHERE path = ?1")
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([path.to_string_lossy().to_string()])
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_repo_row(row).map(Some)
    }

    fn list(&self) -> Result<Vec<Repo>, RepoError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, name, vcs_type, created_at, updated_at FROM repos ORDER BY created_at ASC")
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt.query([]).map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })?;
        let mut repos = Vec::new();
        while let Some(row) = rows.next().map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })? {
            repos.push(map_repo_row(row)?);
        }
        Ok(repos)
    }

    fn unregister(&self, id: &RepoId) -> Result<(), RepoError> {
        let affected = self
            .conn
            .execute("DELETE FROM repos WHERE id = ?1", [id.as_str()])
            .map_err(|err| RepoError::InvalidInput {
                message: err.to_string(),
            })?;
        if affected == 0 {
            return Err(RepoError::RepoNotFound);
        }
        Ok(())
    }
}

fn map_repo_row(row: &rusqlite::Row<'_>) -> Result<Repo, RepoError> {
    let id: String = row.get(0).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let path: String = row.get(1).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let name: String = row.get(2).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let vcs_type: String = row.get(3).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(4).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let updated_at: String = row.get(5).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;

    let repo_id = RepoId::new(id).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;
    let vcs_type = decode_enum(&vcs_type).map_err(|err| RepoError::InvalidInput {
        message: err.to_string(),
    })?;

    Ok(Repo {
        id: repo_id,
        path: PathBuf::from(path),
        name,
        vcs_type,
        created_at: from_rfc3339(&created_at).map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| RepoError::InvalidInput {
            message: err.to_string(),
        })?,
    })
}
