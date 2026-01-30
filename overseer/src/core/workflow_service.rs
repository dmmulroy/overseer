use rusqlite::Connection;

use crate::core::TaskService;
use crate::db::task_repo;
use crate::error::Result;
use crate::id::TaskId;
use crate::types::Task;
use crate::vcs::backend::{VcsBackend, VcsError};

/// Coordinates task state transitions with VCS operations.
///
/// **Transaction semantics**: VCS-first, then DB.
/// - VCS operations run first and can fail the entire operation
/// - DB operations run after VCS succeeds
/// - This prevents partial state on VCS failure
///
/// VCS is mandatory for workflow operations (start/complete).
/// CRUD operations don't require VCS.
pub struct TaskWorkflowService<'a> {
    task_service: TaskService<'a>,
    vcs: Box<dyn VcsBackend>,
    conn: &'a Connection,
}

impl<'a> TaskWorkflowService<'a> {
    pub fn new(conn: &'a Connection, vcs: Box<dyn VcsBackend>) -> Self {
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
        let bookmark = task
            .bookmark
            .clone()
            .unwrap_or_else(|| format!("task/{}", id));

        // 1. Ensure bookmark exists (idempotent)
        match self.vcs.create_bookmark(&bookmark, None) {
            Ok(()) | Err(VcsError::BookmarkExists(_)) => {}
            Err(e) => return Err(e.into()),
        }

        // 2. Checkout (can fail on DirtyWorkingCopy)
        self.vcs.checkout(&bookmark)?;

        // 3. Record start commit
        let sha = self.vcs.current_commit_id()?;

        // 4. DB updates (after VCS succeeds)
        task_repo::set_bookmark(self.conn, id, &bookmark)?;
        task_repo::set_start_commit(self.conn, id, &sha)?;

        if task.started_at.is_none() {
            self.task_service.start(id)?;
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
        self.complete_with_learnings(id, result, &[])
    }

    /// Complete a task with optional learnings.
    /// Learnings are added to the task and bubbled to immediate parent.
    ///
    /// VCS-first ordering: commit changes before updating DB state.
    pub fn complete_with_learnings(
        &self,
        id: &TaskId,
        result: Option<&str>,
        learnings: &[String],
    ) -> Result<Task> {
        let task = self.task_service.get(id)?;

        // Idempotent: already completed
        if task.completed {
            return Ok(task);
        }

        // Auto-detect milestone (depth 0)
        if task.depth == Some(0) {
            return self.complete_milestone_with_learnings(id, result, learnings);
        }

        // 1. VCS first - commit (NothingToCommit is OK)
        let msg = format!("Complete: {}\n\n{}", task.description, result.unwrap_or(""));
        match self.vcs.commit(&msg) {
            Ok(_) | Err(VcsError::NothingToCommit) => {}
            Err(e) => return Err(e.into()),
        }

        // 2. DB updates (after VCS succeeds)
        let completed_task = self
            .task_service
            .complete_with_learnings(id, result, learnings)?;

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
        self.complete_milestone_with_learnings(id, result, &[])
    }

    /// Complete a milestone with optional learnings.
    ///
    /// VCS-first ordering: commit changes before updating DB state.
    pub fn complete_milestone_with_learnings(
        &self,
        id: &TaskId,
        result: Option<&str>,
        learnings: &[String],
    ) -> Result<Task> {
        let task = self.task_service.get(id)?;

        // Idempotent: already completed
        if task.completed {
            return Ok(task);
        }

        // Not a milestone - delegate to regular complete (avoid infinite recursion)
        if task.depth != Some(0) {
            // 1. VCS first - commit (NothingToCommit is OK)
            let msg = format!("Complete: {}\n\n{}", task.description, result.unwrap_or(""));
            match self.vcs.commit(&msg) {
                Ok(_) | Err(VcsError::NothingToCommit) => {}
                Err(e) => return Err(e.into()),
            }

            // 2. DB updates (after VCS succeeds)
            let completed_task = self
                .task_service
                .complete_with_learnings(id, result, learnings)?;

            return Ok(completed_task);
        }

        // Milestone: VCS first - commit (NothingToCommit is OK)
        let msg = format!(
            "Milestone: {}\n\n{}",
            task.description,
            result.unwrap_or("")
        );
        match self.vcs.commit(&msg) {
            Ok(_) | Err(VcsError::NothingToCommit) => {}
            Err(e) => return Err(e.into()),
        }

        // DB updates (after VCS succeeds)
        let completed_task = self
            .task_service
            .complete_with_learnings(id, result, learnings)?;

        // Best-effort cleanup: delete child bookmarks
        let children = task_repo::get_children(self.conn, id)?;
        for child in children.iter() {
            if let Some(ref child_bookmark) = child.bookmark {
                let _ = self.vcs.delete_bookmark(child_bookmark);
            }
        }

        Ok(completed_task)
    }

    /// Best-effort bookmark cleanup on task delete.
    /// VCS errors are logged but don't fail the operation.
    pub fn cleanup_bookmark(&self, id: &TaskId) -> Result<()> {
        if let Ok(Some(task)) = task_repo::get_task(self.conn, id) {
            if let Some(ref bookmark) = task.bookmark {
                if let Err(e) = self.vcs.delete_bookmark(bookmark) {
                    eprintln!("warn: failed to delete bookmark {}: {}", bookmark, e);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_schema;
    use crate::types::CreateTaskInput;
    use crate::vcs::backend::{
        CommitResult, DiffEntry, LogEntry, VcsResult, VcsStatus, VcsType,
    };

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    /// Mock VCS backend for tests - all operations succeed with minimal side effects.
    struct MockVcsBackend;

    impl VcsBackend for MockVcsBackend {
        fn vcs_type(&self) -> VcsType {
            VcsType::Git
        }
        fn root(&self) -> &str {
            "/mock"
        }
        fn status(&self) -> VcsResult<VcsStatus> {
            Ok(VcsStatus {
                files: vec![],
                working_copy_id: Some("mock-commit".to_string()),
            })
        }
        fn log(&self, _limit: usize) -> VcsResult<Vec<LogEntry>> {
            Ok(vec![])
        }
        fn diff(&self, _base: Option<&str>) -> VcsResult<Vec<DiffEntry>> {
            Ok(vec![])
        }
        fn commit(&self, message: &str) -> VcsResult<CommitResult> {
            Ok(CommitResult {
                id: "mock-commit-id".to_string(),
                message: message.to_string(),
            })
        }
        fn current_commit_id(&self) -> VcsResult<String> {
            Ok("mock-commit-id".to_string())
        }
        fn create_bookmark(&self, _name: &str, _target: Option<&str>) -> VcsResult<()> {
            Ok(())
        }
        fn delete_bookmark(&self, _name: &str) -> VcsResult<()> {
            Ok(())
        }
        fn list_bookmarks(&self, _prefix: Option<&str>) -> VcsResult<Vec<String>> {
            Ok(vec![])
        }
        fn checkout(&self, _target: &str) -> VcsResult<()> {
            Ok(())
        }
        fn squash(&self, message: &str) -> VcsResult<CommitResult> {
            Ok(CommitResult {
                id: "mock-squash-id".to_string(),
                message: message.to_string(),
            })
        }
        fn rebase_onto(&self, _target: &str) -> VcsResult<()> {
            Ok(())
        }
    }

    fn mock_vcs() -> Box<dyn VcsBackend> {
        Box::new(MockVcsBackend)
    }

    #[test]
    fn test_start_records_vcs_state() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());

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
        assert!(started.bookmark.is_some());
        assert!(started.start_commit.is_some());
    }

    #[test]
    fn test_complete_updates_state() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());

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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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

    #[test]
    fn test_complete_with_learnings_bubbles_to_parent() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());
        let svc = service.task_service();

        // Create: milestone -> task -> subtask1, subtask2 (sibling prevents auto-complete)
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

        // Second subtask prevents task from auto-completing
        let _subtask2 = svc
            .create(&CreateTaskInput {
                description: "Subtask 2".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete subtask1 with learnings
        service
            .complete_with_learnings(
                &subtask1.id,
                Some("done"),
                &["Learning 1".to_string(), "Learning 2".to_string()],
            )
            .unwrap();

        // Learnings should be on subtask1
        let subtask_learnings =
            crate::db::learning_repo::list_learnings(&conn, &subtask1.id).unwrap();
        assert_eq!(subtask_learnings.len(), 2);
        assert_eq!(subtask_learnings[0].content, "Learning 1");
        assert_eq!(subtask_learnings[1].content, "Learning 2");
        // Origin should be subtask1 itself
        assert_eq!(
            subtask_learnings[0].source_task_id,
            Some(subtask1.id.clone())
        );

        // Learnings should have bubbled to task (parent)
        let task_learnings = crate::db::learning_repo::list_learnings(&conn, &task.id).unwrap();
        assert_eq!(task_learnings.len(), 2);
        assert_eq!(task_learnings[0].content, "Learning 1");
        // Origin preserved through bubble
        assert_eq!(task_learnings[0].source_task_id, Some(subtask1.id.clone()));

        // Task should NOT be auto-completed (subtask2 still pending)
        let task_after = svc.get(&task.id).unwrap();
        assert!(!task_after.completed);

        // Learnings should NOT be on milestone yet (task not completed)
        let milestone_learnings =
            crate::db::learning_repo::list_learnings(&conn, &milestone.id).unwrap();
        assert_eq!(milestone_learnings.len(), 0);
    }

    #[test]
    fn test_learnings_bubble_transitively_on_parent_complete() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());
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

        // Complete subtask with learning
        service
            .complete_with_learnings(&subtask.id, None, &["From subtask".to_string()])
            .unwrap();

        // Task auto-completes (only child done), which bubbles learnings to milestone
        let task_after = svc.get(&task.id).unwrap();
        assert!(task_after.completed);

        // Now milestone should have the learning (bubbled from task which had it from subtask)
        let milestone_learnings =
            crate::db::learning_repo::list_learnings(&conn, &milestone.id).unwrap();
        assert_eq!(milestone_learnings.len(), 1);
        assert_eq!(milestone_learnings[0].content, "From subtask");
        // Origin preserved: still points to subtask
        assert_eq!(
            milestone_learnings[0].source_task_id,
            Some(subtask.id.clone())
        );
    }

    #[test]
    fn test_sibling_sees_learnings_via_parent() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());
        let svc = service.task_service();

        // Create: milestone -> task_a (with subtasks), task_b (with subtasks)
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task_a = svc
            .create(&CreateTaskInput {
                description: "Task A".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask_a1 = svc
            .create(&CreateTaskInput {
                description: "Subtask A1".to_string(),
                context: None,
                parent_id: Some(task_a.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask_a2 = svc
            .create(&CreateTaskInput {
                description: "Subtask A2".to_string(),
                context: None,
                parent_id: Some(task_a.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Complete A1 with learning
        service
            .complete_with_learnings(&subtask_a1.id, None, &["A1 discovery".to_string()])
            .unwrap();

        // A2 should see A1's learning via parent (task_a)
        let task_a_learnings = crate::db::learning_repo::list_learnings(&conn, &task_a.id).unwrap();
        assert_eq!(task_a_learnings.len(), 1);
        assert_eq!(task_a_learnings[0].content, "A1 discovery");

        // Start A2 and get its inherited learnings
        let a2_with_context = svc.get(&subtask_a2.id).unwrap();
        // InheritedLearnings.parent should contain A1's learning
        assert!(a2_with_context.learnings.is_some());
        let inherited = a2_with_context.learnings.unwrap();
        assert_eq!(inherited.parent.len(), 1);
        assert_eq!(inherited.parent[0].content, "A1 discovery");
    }

    #[test]
    fn test_learnings_idempotent_on_retry() {
        let conn = setup_db();
        let service = TaskWorkflowService::new(&conn, mock_vcs());
        let svc = service.task_service();

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

        // Complete with learning
        service
            .complete_with_learnings(&task.id, None, &["Important note".to_string()])
            .unwrap();

        // Try to complete again (idempotent) - should not duplicate learnings
        service
            .complete_with_learnings(&task.id, None, &["Important note".to_string()])
            .unwrap();

        // Should still only have 1 learning on milestone (not duplicated)
        let milestone_learnings =
            crate::db::learning_repo::list_learnings(&conn, &milestone.id).unwrap();
        assert_eq!(milestone_learnings.len(), 1);
    }
}
