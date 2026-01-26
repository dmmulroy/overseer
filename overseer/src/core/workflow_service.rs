use rusqlite::Connection;

use crate::core::TaskService;
use crate::db::task_repo;
use crate::error::Result;
use crate::id::TaskId;
use crate::types::Task;
use crate::vcs::backend::{CommitResult, VcsBackend, VcsError};

/// Coordinates task state transitions with VCS operations.
///
/// **Transaction semantics**: DB-first, VCS-best-effort.
/// - DB operations are authoritative and can fail the entire operation
/// - VCS operations run after DB commit and log failures but don't fail the operation
/// - This ensures task state is never lost, even if VCS is unavailable or errors
pub struct TaskWorkflowService<'a> {
    task_service: TaskService<'a>,
    vcs: Option<Box<dyn VcsBackend>>,
    conn: &'a Connection,
}

impl<'a> TaskWorkflowService<'a> {
    pub fn new(conn: &'a Connection, vcs: Option<Box<dyn VcsBackend>>) -> Self {
        Self {
            task_service: TaskService::new(conn),
            vcs,
            conn,
        }
    }

    pub fn task_service(&self) -> &TaskService<'a> {
        &self.task_service
    }

    pub fn start(&self, id: &TaskId) -> Result<Task> {
        let task = self.task_service.get(id)?;

        // Idempotent: already started
        if task.started_at.is_some() {
            return Ok(task);
        }

        let task = self.task_service.start(id)?;

        if let Some(ref vcs) = self.vcs {
            let bookmark = format!("task/{}", id);

            if vcs.create_bookmark(&bookmark, None).is_ok() {
                if let Err(e) = task_repo::set_bookmark(self.conn, id, &bookmark) {
                    eprintln!("warn: failed to record bookmark for task {id}: {e}");
                }
            }

            if let Ok(sha) = vcs.current_commit_id() {
                if let Err(e) = task_repo::set_start_commit(self.conn, id, &sha) {
                    eprintln!("warn: failed to record start commit for task {id}: {e}");
                }
            }

            // Best effort WIP commit - VCS may reject if nothing staged
            let _ = vcs.commit(&format!("WIP: {}", task.description));
        }

        self.task_service.get(id)
    }

    pub fn complete(&self, id: &TaskId, result: Option<&str>) -> Result<Task> {
        let task = self.task_service.get(id)?;

        // Idempotent: already completed
        if task.completed {
            return Ok(task);
        }

        // Auto-detect milestone (depth 0)
        if task.depth == Some(0) {
            return self.complete_milestone(id, result);
        }

        // DB first - can fail safely
        let completed_task = self.task_service.complete(id, result)?;

        // VCS second - best effort, already committed to DB
        if let Some(ref vcs) = self.vcs {
            let msg = format!("Complete: {}\n\n{}", task.description, result.unwrap_or(""));
            let _ = Self::try_squash_or_commit(vcs.as_ref(), &msg);

            if let Some(parent_id) = &task.parent_id {
                if let Ok(Some(parent)) = task_repo::get_task(self.conn, parent_id) {
                    if let Some(ref parent_bookmark) = parent.bookmark {
                        let _ = vcs.rebase_onto(parent_bookmark);
                    }
                }
            }
        }

        Ok(completed_task)
    }

    pub fn complete_milestone(&self, id: &TaskId, result: Option<&str>) -> Result<Task> {
        let task = self.task_service.get(id)?;

        // Idempotent: already completed
        if task.completed {
            return Ok(task);
        }

        // Not a milestone - delegate to regular complete (avoid infinite recursion)
        if task.depth != Some(0) {
            // DB first
            let completed_task = self.task_service.complete(id, result)?;

            // VCS best effort
            if let Some(ref vcs) = self.vcs {
                let msg = format!("Complete: {}\n\n{}", task.description, result.unwrap_or(""));
                let _ = Self::try_squash_or_commit(vcs.as_ref(), &msg);
            }

            return Ok(completed_task);
        }

        // DB first - can fail safely
        let completed_task = self.task_service.complete(id, result)?;

        // VCS second - best effort cleanup (don't rebase, just delete child bookmarks)
        if let Some(ref vcs) = self.vcs {
            let children = task_repo::get_children(self.conn, id)?;

            let msg = format!(
                "Milestone: {}\n\n{}",
                task.description,
                result.unwrap_or("")
            );
            let _ = Self::try_squash_or_commit(vcs.as_ref(), &msg);

            // Cleanup child bookmarks (no rebase - let user manage merge)
            for child in children.iter() {
                if let Some(ref child_bookmark) = child.bookmark {
                    let _ = vcs.delete_bookmark(child_bookmark);
                }
            }
        }

        Ok(completed_task)
    }

    pub fn cleanup_bookmark(&self, id: &TaskId) -> Result<()> {
        if let Some(ref vcs) = self.vcs {
            if let Ok(Some(task)) = task_repo::get_task(self.conn, id) {
                if let Some(ref bookmark) = task.bookmark {
                    let _ = vcs.delete_bookmark(bookmark);
                }
            }
        }
        Ok(())
    }

    /// Try to squash commits with the given message, falling back to a regular commit
    /// if squash fails due to nothing to commit or not enough commits.
    ///
    /// Returns `VcsResult` (not `crate::error::Result`) since this is VCS-only and
    /// callers use best-effort `let _ =` pattern.
    fn try_squash_or_commit(
        vcs: &dyn VcsBackend,
        msg: &str,
    ) -> std::result::Result<CommitResult, VcsError> {
        match vcs.squash(msg) {
            Ok(r) => Ok(r),
            Err(VcsError::NothingToCommit) => vcs.commit(msg),
            Err(VcsError::OperationFailed(ref m)) if m.contains("Not enough commits") => {
                vcs.commit(msg)
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_schema;
    use crate::types::CreateTaskInput;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_start_without_vcs() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);

        let task = service
            .task_service()
            .create(&CreateTaskInput {
                description: "Test task".to_string(),
                context: None,
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let started = service.start(&task.id).unwrap();
        assert!(started.started_at.is_some());
        assert!(started.bookmark.is_none());
        assert!(started.start_commit.is_none());
    }

    #[test]
    fn test_complete_without_vcs() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);

        let task = service
            .task_service()
            .create(&CreateTaskInput {
                description: "Test task".to_string(),
                context: None,
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let completed = service.complete(&task.id, Some("Done")).unwrap();
        assert!(completed.completed);
        assert_eq!(completed.result, Some("Done".to_string()));
    }
}
