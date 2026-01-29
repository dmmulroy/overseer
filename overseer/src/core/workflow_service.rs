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

    /// Access the underlying TaskService (used primarily in tests)
    #[allow(dead_code)]
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

    /// Start a task, following blockers to find startable work.
    ///
    /// If the requested task or any of its descendants are blocked,
    /// follows blockers until finding a startable task.
    /// Cascades down to deepest incomplete leaf.
    pub fn start_follow_blockers(&self, root: &TaskId) -> Result<Task> {
        let target = self.task_service.resolve_start_target(root)?;
        self.start(&target)
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

        // Bubble up: auto-complete parents if all children done and unblocked
        self.bubble_up_completion(id)?;

        Ok(completed_task)
    }

    /// Auto-complete parent tasks if all siblings are done and parent is unblocked.
    /// Bubbles up recursively until hitting a blocked parent or pending children.
    fn bubble_up_completion(&self, completed_id: &TaskId) -> Result<()> {
        let mut current_id = completed_id.clone();

        loop {
            let current = task_repo::get_task(self.conn, &current_id)?
                .ok_or_else(|| crate::error::OsError::TaskNotFound(current_id.clone()))?;

            let Some(parent_id) = current.parent_id else {
                break;
            };

            // Check if parent has pending children
            if task_repo::has_pending_children(self.conn, &parent_id)? {
                break;
            }

            // Check if parent is blocked
            let parent = self.task_service.get(&parent_id)?;
            if self.task_service.is_effectively_blocked(&parent)? {
                break;
            }

            // Auto-complete parent (use service method to handle depth-0 special case)
            if parent.depth == Some(0) {
                self.complete_milestone(&parent_id, None)?;
            } else {
                self.task_service.complete(&parent_id, None)?;
            }

            current_id = parent_id;
        }

        Ok(())
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

    #[test]
    fn test_start_cascades_to_deepest_leaf() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: milestone -> task -> subtask
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = svc
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask = svc
            .create(&CreateTaskInput {
                description: "Subtask".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Starting milestone should cascade to subtask
        let started = service.start_follow_blockers(&milestone.id).unwrap();
        assert_eq!(started.id, subtask.id);
        assert!(started.started_at.is_some());
    }

    #[test]
    fn test_start_follows_blockers_to_startable() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: blocker_task, blocked_milestone -> task
        let blocker_task = svc
            .create(&CreateTaskInput {
                description: "Blocker task".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let blocked_milestone = svc
            .create(&CreateTaskInput {
                description: "Blocked milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![blocker_task.id.clone()],
            })
            .unwrap();

        let _task = svc
            .create(&CreateTaskInput {
                description: "Task under blocked milestone".to_string(),
                context: None,
                parent_id: Some(blocked_milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Starting blocked_milestone should follow blocker and start blocker_task
        let started = service
            .start_follow_blockers(&blocked_milestone.id)
            .unwrap();
        assert_eq!(started.id, blocker_task.id);
        assert!(started.started_at.is_some());
    }

    #[test]
    fn test_complete_bubbles_up_to_parent() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: milestone -> task -> subtask1, subtask2
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = svc
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask1 = svc
            .create(&CreateTaskInput {
                description: "Subtask 1".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask2 = svc
            .create(&CreateTaskInput {
                description: "Subtask 2".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete first subtask - task should NOT be auto-completed
        service.complete(&subtask1.id, None).unwrap();
        let task_after = svc.get(&task.id).unwrap();
        assert!(!task_after.completed);

        // Complete second subtask - task SHOULD be auto-completed
        service.complete(&subtask2.id, None).unwrap();
        let task_after = svc.get(&task.id).unwrap();
        assert!(task_after.completed);
    }

    #[test]
    fn test_complete_bubbles_up_to_milestone() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: milestone -> task (single task, no siblings)
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = svc
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete task - milestone should auto-complete
        service.complete(&task.id, None).unwrap();

        let milestone_after = svc.get(&milestone.id).unwrap();
        assert!(milestone_after.completed);
    }

    #[test]
    fn test_complete_stops_at_blocked_parent() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: blocker, milestone (blocked by blocker) -> task
        let blocker = svc
            .create(&CreateTaskInput {
                description: "Blocker".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let milestone = svc
            .create(&CreateTaskInput {
                description: "Blocked milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![blocker.id.clone()],
            })
            .unwrap();

        let task = svc
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete task - milestone should NOT auto-complete (it's blocked)
        service.complete(&task.id, None).unwrap();

        let milestone_after = svc.get(&milestone.id).unwrap();
        assert!(!milestone_after.completed);
    }

    #[test]
    fn test_complete_stops_at_pending_siblings() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, None);
        let svc = service.task_service();

        // Create: milestone -> task1, task2
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task1 = svc
            .create(&CreateTaskInput {
                description: "Task 1".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let _task2 = svc
            .create(&CreateTaskInput {
                description: "Task 2".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete task1 - milestone should NOT auto-complete (task2 still pending)
        service.complete(&task1.id, None).unwrap();

        let milestone_after = svc.get(&milestone.id).unwrap();
        assert!(!milestone_after.completed);
    }
}
