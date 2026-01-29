use std::collections::HashSet;

use rusqlite::Connection;

use crate::db::{self, learning_repo, task_repo};
use crate::error::{OsError, Result};
use crate::id::TaskId;
use crate::types::{
    CreateTaskInput, InheritedLearnings, ListTasksFilter, Task, TaskContext, UpdateTaskInput,
};
use crate::vcs;

const MAX_DEPTH: i32 = 2;

pub struct TaskService<'a> {
    conn: &'a Connection,
}

impl<'a> TaskService<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn create(&self, input: &CreateTaskInput) -> Result<Task> {
        // Validate priority range (1-5)
        if let Some(priority) = input.priority {
            if !(1..=5).contains(&priority) {
                return Err(OsError::InvalidPriority(priority));
            }
        }

        if let Some(ref parent_id) = input.parent_id {
            if !task_repo::task_exists(self.conn, parent_id)? {
                return Err(OsError::ParentNotFound(parent_id.clone()));
            }

            let parent_depth = task_repo::get_task_depth(self.conn, parent_id)?;
            if parent_depth >= MAX_DEPTH {
                return Err(OsError::MaxDepthExceeded);
            }
        }

        for blocker_id in &input.blocked_by {
            if !task_repo::task_exists(self.conn, blocker_id)? {
                return Err(OsError::BlockerNotFound(blocker_id.clone()));
            }

            // Validate blocker is not an ancestor of the new task
            // (blocker would be ancestor if it's in the parent chain)
            if let Some(ref parent_id) = input.parent_id {
                if blocker_id == parent_id || self.is_ancestor(blocker_id, parent_id)? {
                    return Err(OsError::InvalidBlockerRelation {
                        message: "Cannot block a task by its ancestor".to_string(),
                        task_id: TaskId::new(), // placeholder - task not created yet
                        blocker_id: blocker_id.clone(),
                    });
                }
            }
        }

        let mut task = task_repo::create_task(self.conn, input)?;
        task.depth = Some(self.get_depth(&task.id)?);
        Ok(task)
    }

    pub fn get(&self, id: &TaskId) -> Result<Task> {
        let mut task =
            task_repo::get_task(self.conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))?;
        task.depth = Some(self.get_depth(id)?);
        task.context_chain = Some(self.assemble_context_chain(&task)?);
        task.learnings = Some(self.assemble_inherited_learnings(&task)?);
        Ok(task)
    }

    pub fn list(&self, filter: &ListTasksFilter) -> Result<Vec<Task>> {
        let mut tasks = task_repo::list_tasks(self.conn, filter)?;
        for task in &mut tasks {
            task.depth = Some(self.get_depth(&task.id)?);
        }
        Ok(tasks)
    }

    pub fn update(&self, id: &TaskId, input: &UpdateTaskInput) -> Result<Task> {
        if !task_repo::task_exists(self.conn, id)? {
            return Err(OsError::TaskNotFound(id.clone()));
        }

        // Validate priority range (1-5)
        if let Some(priority) = input.priority {
            if !(1..=5).contains(&priority) {
                return Err(OsError::InvalidPriority(priority));
            }
        }

        if let Some(ref new_parent_id) = input.parent_id {
            if !task_repo::task_exists(self.conn, new_parent_id)? {
                return Err(OsError::ParentNotFound(new_parent_id.clone()));
            }

            // Check for cycles first - more specific error
            if self.would_create_parent_cycle(id, new_parent_id)? {
                return Err(OsError::ParentCycle);
            }

            // Then check depth limit for this task
            let parent_depth = task_repo::get_task_depth(self.conn, new_parent_id)?;
            if parent_depth >= MAX_DEPTH {
                return Err(OsError::MaxDepthExceeded);
            }

            // Check subtree depth: descendants must not exceed MAX_DEPTH after reparent
            let subtree_depth = self.max_subtree_depth(id)?;
            let new_task_depth = parent_depth + 1;
            if new_task_depth + subtree_depth > MAX_DEPTH {
                return Err(OsError::MaxDepthExceeded);
            }

            // Validate existing blockers against new ancestor chain
            // A blocker cannot be the new parent or any ancestor of the new parent
            let current_blockers = task_repo::get_blockers(self.conn, id)?;
            for blocker_id in &current_blockers {
                if blocker_id == new_parent_id || self.is_ancestor(blocker_id, new_parent_id)? {
                    return Err(OsError::InvalidBlockerRelation {
                        message: "Reparent would make a blocker an ancestor".to_string(),
                        task_id: id.clone(),
                        blocker_id: blocker_id.clone(),
                    });
                }
            }
        }

        let mut task = task_repo::update_task(self.conn, id, input)?;
        task.depth = Some(self.get_depth(id)?);
        Ok(task)
    }

    /// Calculate the maximum depth of descendants under a task (0 if no children)
    fn max_subtree_depth(&self, id: &TaskId) -> Result<i32> {
        let children = task_repo::get_children(self.conn, id)?;
        if children.is_empty() {
            return Ok(0);
        }
        let mut max = 0;
        for child in children {
            let child_depth = 1 + self.max_subtree_depth(&child.id)?;
            if child_depth > max {
                max = child_depth;
            }
        }
        Ok(max)
    }

    pub fn start(&self, id: &TaskId) -> Result<Task> {
        if !task_repo::task_exists(self.conn, id)? {
            return Err(OsError::TaskNotFound(id.clone()));
        }
        let mut task = task_repo::start_task(self.conn, id)?;
        task.depth = Some(self.get_depth(id)?);
        Ok(task)
    }

    pub fn complete(&self, id: &TaskId, result: Option<&str>) -> Result<Task> {
        if !task_repo::task_exists(self.conn, id)? {
            return Err(OsError::TaskNotFound(id.clone()));
        }

        if task_repo::has_pending_children(self.conn, id)? {
            return Err(OsError::PendingChildren);
        }

        // Auto-populate commit_sha if VCS is available (Invariant #6)
        let commit_sha = Self::get_current_commit_sha();

        let mut task = task_repo::complete_task(self.conn, id, result, commit_sha.as_deref())?;
        task.depth = Some(self.get_depth(id)?);
        Ok(task)
    }

    fn get_current_commit_sha() -> Option<String> {
        // Try to get VCS backend from current directory
        let cwd = std::env::current_dir().ok()?;
        let backend = vcs::get_backend(&cwd).ok()?;
        backend.current_commit_id().ok()
    }

    pub fn reopen(&self, id: &TaskId) -> Result<Task> {
        if !task_repo::task_exists(self.conn, id)? {
            return Err(OsError::TaskNotFound(id.clone()));
        }
        let mut task = task_repo::reopen_task(self.conn, id)?;
        task.depth = Some(self.get_depth(id)?);
        Ok(task)
    }

    pub fn delete(&self, id: &TaskId) -> Result<()> {
        if !task_repo::task_exists(self.conn, id)? {
            return Err(OsError::TaskNotFound(id.clone()));
        }
        task_repo::delete_task(self.conn, id)
    }

    pub fn add_blocker(&self, task_id: &TaskId, blocker_id: &TaskId) -> Result<Task> {
        if !task_repo::task_exists(self.conn, task_id)? {
            return Err(OsError::TaskNotFound(task_id.clone()));
        }
        if !task_repo::task_exists(self.conn, blocker_id)? {
            return Err(OsError::BlockerNotFound(blocker_id.clone()));
        }

        // Reject self-block
        if task_id == blocker_id {
            return Err(OsError::InvalidBlockerRelation {
                message: "Cannot block a task by itself".to_string(),
                task_id: task_id.clone(),
                blocker_id: blocker_id.clone(),
            });
        }

        // Reject ancestor blocker (blocker is ancestor of task)
        if self.is_ancestor(blocker_id, task_id)? {
            return Err(OsError::InvalidBlockerRelation {
                message: "Cannot block a task by its ancestor".to_string(),
                task_id: task_id.clone(),
                blocker_id: blocker_id.clone(),
            });
        }

        // Reject descendant blocker (blocker is descendant of task)
        if self.is_descendant(blocker_id, task_id)? {
            return Err(OsError::InvalidBlockerRelation {
                message: "Cannot block a task by its descendant".to_string(),
                task_id: task_id.clone(),
                blocker_id: blocker_id.clone(),
            });
        }

        if self.would_create_blocker_cycle(task_id, blocker_id)? {
            return Err(OsError::BlockerCycle);
        }

        task_repo::add_blocker(self.conn, task_id, blocker_id)?;
        self.get(task_id)
    }

    pub fn remove_blocker(&self, task_id: &TaskId, blocker_id: &TaskId) -> Result<Task> {
        if !task_repo::task_exists(self.conn, task_id)? {
            return Err(OsError::TaskNotFound(task_id.clone()));
        }
        task_repo::remove_blocker(self.conn, task_id, blocker_id)?;
        self.get(task_id)
    }

    fn get_depth(&self, id: &TaskId) -> Result<i32> {
        task_repo::get_task_depth(self.conn, id)
    }

    fn assemble_context_chain(&self, task: &Task) -> Result<TaskContext> {
        let depth = task.depth.unwrap_or(0);
        let own = task.context.clone();

        match depth {
            0 => {
                // Milestone - only own context
                Ok(TaskContext {
                    own,
                    parent: None,
                    milestone: None,
                })
            }
            1 => {
                // Task with milestone parent
                let parent = task
                    .parent_id
                    .as_ref()
                    .and_then(|pid| task_repo::get_task(self.conn, pid).ok()?)
                    .map(|p| p.context);

                Ok(TaskContext {
                    own,
                    parent: parent.clone(),
                    milestone: parent,
                })
            }
            _ => {
                // Subtask with task parent and milestone grandparent
                let parent_task = task
                    .parent_id
                    .as_ref()
                    .and_then(|pid| task_repo::get_task(self.conn, pid).ok()?);

                let parent = parent_task.as_ref().map(|p| p.context.clone());

                let milestone = parent_task
                    .as_ref()
                    .and_then(|p| p.parent_id.as_ref())
                    .and_then(|mid| task_repo::get_task(self.conn, mid).ok()?)
                    .map(|m| m.context);

                Ok(TaskContext {
                    own,
                    parent,
                    milestone,
                })
            }
        }
    }

    fn assemble_inherited_learnings(&self, task: &Task) -> Result<InheritedLearnings> {
        let depth = task.depth.unwrap_or(0);

        match depth {
            0 => {
                // Milestone - no inherited learnings
                Ok(InheritedLearnings {
                    milestone: vec![],
                    parent: vec![],
                })
            }
            1 => {
                // Task with milestone parent
                let milestone = task
                    .parent_id
                    .as_ref()
                    .map(|pid| learning_repo::list_learnings(self.conn, pid))
                    .transpose()?
                    .unwrap_or_default();

                Ok(InheritedLearnings {
                    milestone,
                    parent: vec![],
                })
            }
            _ => {
                // Subtask with task parent and milestone grandparent
                let parent_id = task.parent_id.as_ref();
                let parent = parent_id
                    .map(|pid| learning_repo::list_learnings(self.conn, pid))
                    .transpose()?
                    .unwrap_or_default();

                let milestone_id = parent_id
                    .and_then(|pid| task_repo::get_task(self.conn, pid).ok()?)
                    .and_then(|p| p.parent_id);

                let milestone = milestone_id
                    .as_ref()
                    .map(|mid| learning_repo::list_learnings(self.conn, mid))
                    .transpose()?
                    .unwrap_or_default();

                Ok(InheritedLearnings { milestone, parent })
            }
        }
    }

    fn would_create_parent_cycle(&self, task_id: &TaskId, new_parent_id: &TaskId) -> Result<bool> {
        let mut current = Some(new_parent_id.clone());
        while let Some(ref cid) = current {
            if cid == task_id {
                return Ok(true);
            }
            let task = task_repo::get_task(self.conn, cid)?;
            current = task.and_then(|t| t.parent_id);
        }
        Ok(false)
    }

    /// Check if `potential_ancestor` is an ancestor of `task_id`
    fn is_ancestor(&self, potential_ancestor: &TaskId, task_id: &TaskId) -> Result<bool> {
        let mut current = task_repo::get_task(self.conn, task_id)?.and_then(|t| t.parent_id);
        while let Some(ref cid) = current {
            if cid == potential_ancestor {
                return Ok(true);
            }
            current = task_repo::get_task(self.conn, cid)?.and_then(|t| t.parent_id);
        }
        Ok(false)
    }

    /// Check if `potential_descendant` is a descendant of `task_id`
    fn is_descendant(&self, potential_descendant: &TaskId, task_id: &TaskId) -> Result<bool> {
        // potential_descendant is a descendant of task_id if task_id is an ancestor of potential_descendant
        self.is_ancestor(task_id, potential_descendant)
    }

    // =========================================================================
    // NEXT-READY & START-TARGET RESOLUTION
    // =========================================================================

    /// Find the next ready task (deepest incomplete unblocked leaf).
    ///
    /// - DFS traversal respecting priority ordering
    /// - A task is "effectively blocked" if it OR any ancestor has incomplete blockers
    /// - Returns None if no ready tasks found
    /// - Milestone with no children returns itself if ready
    pub fn next_ready(&self, milestone: Option<&TaskId>) -> Result<Option<TaskId>> {
        match milestone {
            Some(id) => {
                let task = self.get(id)?;
                self.find_next_ready_under(&task, true)
            }
            None => {
                // Search all milestones (roots) in priority order
                let roots = task_repo::list_roots(self.conn)?;
                for root in roots {
                    if let Some(ready_id) = self.find_next_ready_under(&root, true)? {
                        return Ok(Some(ready_id));
                    }
                }
                Ok(None)
            }
        }
    }

    /// DFS to find next ready task under a given root.
    /// `ancestors_unblocked` tracks whether all ancestors are unblocked.
    fn find_next_ready_under(
        &self,
        task: &Task,
        ancestors_unblocked: bool,
    ) -> Result<Option<TaskId>> {
        // If task is completed, no ready work here
        if task.completed {
            return Ok(None);
        }

        // Check if this task itself is blocked
        let task_unblocked = task
            .blocked_by
            .iter()
            .all(|blocker_id| task_repo::is_task_completed(self.conn, blocker_id).unwrap_or(false));
        let effectively_unblocked = ancestors_unblocked && task_unblocked;

        // Get children in priority order (reused for both DFS and all_complete check)
        let children = task_repo::get_children_ordered(self.conn, &task.id)?;

        if children.is_empty() {
            // Leaf node - return if effectively unblocked
            if effectively_unblocked {
                return Ok(Some(task.id.clone()));
            } else {
                return Ok(None);
            }
        }

        // Check if all children complete before recursing (used after DFS)
        let all_children_complete = children.iter().all(|c| c.completed);

        // Recurse into children (DFS)
        for child in &children {
            if let Some(ready_id) = self.find_next_ready_under(child, effectively_unblocked)? {
                return Ok(Some(ready_id));
            }
        }

        // No ready children found, but this task might be startable if:
        // - All children are complete
        // - This task is effectively unblocked
        // This handles the case where we want to return a non-leaf that's ready
        // (all children done, blockers done)
        if all_children_complete && effectively_unblocked {
            return Ok(Some(task.id.clone()));
        }

        Ok(None)
    }

    /// Resolve which task to actually start given a requested root.
    /// Follows blockers until finding a startable task.
    ///
    /// Returns the ID of the task that should be started.
    /// Errors if no startable task found or if blocker cycle detected.
    pub fn resolve_start_target(&self, requested_root: &TaskId) -> Result<TaskId> {
        let mut blocker_stack: Vec<TaskId> = Vec::new();
        self.resolve_start_target_inner(requested_root, &mut blocker_stack)
    }

    fn resolve_start_target_inner(
        &self,
        root: &TaskId,
        blocker_stack: &mut Vec<TaskId>,
    ) -> Result<TaskId> {
        let task = self.get(root)?;

        // Collect incomplete leaves under this root
        let leaves = self.collect_incomplete_leaves(&task)?;

        for leaf_path in leaves {
            // Check for blockage along the chain from leaf to root
            if let Some(blockage) = self.first_blockage_along_chain(&leaf_path)? {
                // Blocked - follow blockers
                for blocker_id in blockage.incomplete_blockers {
                    // Check for cycle
                    if blocker_stack.contains(&blocker_id) {
                        let mut chain = blocker_stack.clone();
                        chain.push(blocker_id.clone());
                        return Err(OsError::BlockerCycleDetected {
                            message: format!("Blocker cycle detected: {:?}", chain),
                            chain,
                        });
                    }

                    blocker_stack.push(blocker_id.clone());
                    match self.resolve_start_target_inner(&blocker_id, blocker_stack) {
                        Ok(found) => return Ok(found),
                        Err(OsError::NoStartableTask { .. }) => {
                            // Continue searching other blockers
                        }
                        Err(e) => return Err(e),
                    }
                    blocker_stack.pop();
                }
            } else {
                // Leaf is startable - return it
                if let Some(leaf_id) = leaf_path.last() {
                    return Ok(leaf_id.clone());
                }
            }
        }

        Err(OsError::NoStartableTask {
            message: format!("No startable task found under {}", root),
            requested: root.clone(),
        })
    }

    /// Collect all incomplete leaf paths under root (includes root if leaf).
    /// Returns paths as root->...->leaf in priority order.
    fn collect_incomplete_leaves(&self, root: &Task) -> Result<Vec<Vec<TaskId>>> {
        let mut leaves = Vec::new();
        self.collect_leaves_inner(root, vec![root.id.clone()], &mut leaves)?;
        Ok(leaves)
    }

    fn collect_leaves_inner(
        &self,
        task: &Task,
        path: Vec<TaskId>,
        leaves: &mut Vec<Vec<TaskId>>,
    ) -> Result<()> {
        if task.completed {
            return Ok(());
        }

        let children = task_repo::get_children_ordered(self.conn, &task.id)?;

        if children.is_empty() {
            // Leaf node
            leaves.push(path);
            return Ok(());
        }

        // Check if all children are complete
        let all_complete = children.iter().all(|c| c.completed);
        if all_complete {
            // This node is effectively a leaf (all children done)
            leaves.push(path);
            return Ok(());
        }

        // Recurse into incomplete children
        for child in children {
            if !child.completed {
                let mut child_path = path.clone();
                child_path.push(child.id.clone());
                self.collect_leaves_inner(&child, child_path, leaves)?;
            }
        }

        Ok(())
    }

    /// Find first blockage along leaf->root chain.
    /// Returns None if leaf is startable (no blockers in chain).
    fn first_blockage_along_chain(&self, leaf_path: &[TaskId]) -> Result<Option<Blockage>> {
        // Walk from root to leaf, checking blockers at each level
        for task_id in leaf_path.iter() {
            let blockers = task_repo::get_blockers(self.conn, task_id)?;
            // is_task_completed returns false for missing/errored tasks (conservative)
            // so incomplete blockers are those that are NOT completed
            let incomplete_blockers: Vec<TaskId> = blockers
                .into_iter()
                .filter(|b| !task_repo::is_task_completed(self.conn, b).unwrap_or(false))
                .collect();

            if !incomplete_blockers.is_empty() {
                return Ok(Some(Blockage {
                    incomplete_blockers,
                }));
            }
        }

        Ok(None)
    }

    /// Check if a task is effectively blocked (itself or any ancestor blocked)
    pub fn is_effectively_blocked(&self, task: &Task) -> Result<bool> {
        // Check task's own blockers
        for blocker_id in &task.blocked_by {
            if !task_repo::is_task_completed(self.conn, blocker_id)? {
                return Ok(true);
            }
        }

        // Check ancestors
        let mut current_parent = task.parent_id.clone();
        while let Some(ref parent_id) = current_parent {
            let parent = task_repo::get_task(self.conn, parent_id)?
                .ok_or_else(|| OsError::TaskNotFound(parent_id.clone()))?;

            for blocker_id in &parent.blocked_by {
                if !task_repo::is_task_completed(self.conn, blocker_id)? {
                    return Ok(true);
                }
            }

            current_parent = parent.parent_id;
        }

        Ok(false)
    }

    fn would_create_blocker_cycle(
        &self,
        task_id: &TaskId,
        new_blocker_id: &TaskId,
    ) -> Result<bool> {
        let mut visited = HashSet::new();
        let mut stack = vec![new_blocker_id.clone()];

        while let Some(current) = stack.pop() {
            if &current == task_id {
                return Ok(true);
            }
            if visited.contains(&current) {
                continue;
            }
            visited.insert(current.clone());

            let blockers = db::get_blockers(self.conn, &current)?;
            stack.extend(blockers);
        }

        Ok(false)
    }
}

/// Internal struct for tracking blockage information
struct Blockage {
    incomplete_blockers: Vec<TaskId>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        schema::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_context_chain_milestone() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let task = service.get(&milestone.id).unwrap();
        let ctx = task.context_chain.unwrap();

        assert_eq!(ctx.own, "Milestone context");
        assert_eq!(ctx.parent, None);
        assert_eq!(ctx.milestone, None);
    }

    #[test]
    fn test_context_chain_task() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: Some("Task context".to_string()),
                parent_id: Some(milestone.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let task = service.get(&task.id).unwrap();
        let ctx = task.context_chain.unwrap();

        assert_eq!(ctx.own, "Task context");
        assert_eq!(ctx.parent, Some("Milestone context".to_string()));
        assert_eq!(ctx.milestone, Some("Milestone context".to_string()));
    }

    #[test]
    fn test_context_chain_subtask() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: Some("Task context".to_string()),
                parent_id: Some(milestone.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let subtask = service
            .create(&CreateTaskInput {
                description: "Subtask".to_string(),
                context: Some("Subtask context".to_string()),
                parent_id: Some(task.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let subtask = service.get(&subtask.id).unwrap();
        let ctx = subtask.context_chain.unwrap();

        assert_eq!(ctx.own, "Subtask context");
        assert_eq!(ctx.parent, Some("Task context".to_string()));
        assert_eq!(ctx.milestone, Some("Milestone context".to_string()));
    }

    #[test]
    fn test_inherited_learnings_milestone() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &milestone.id, "Milestone learning", None).unwrap();

        let task = service.get(&milestone.id).unwrap();
        let learnings = task.learnings.unwrap();

        assert_eq!(learnings.milestone.len(), 0);
        assert_eq!(learnings.parent.len(), 0);
    }

    #[test]
    fn test_inherited_learnings_task() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &milestone.id, "Milestone learning 1", None).unwrap();
        learning_repo::add_learning(&conn, &milestone.id, "Milestone learning 2", None).unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: Some("Task context".to_string()),
                parent_id: Some(milestone.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &task.id, "Task learning", None).unwrap();

        let task = service.get(&task.id).unwrap();
        let learnings = task.learnings.unwrap();

        assert_eq!(learnings.milestone.len(), 2);
        assert_eq!(learnings.milestone[0].content, "Milestone learning 1");
        assert_eq!(learnings.milestone[1].content, "Milestone learning 2");
        assert_eq!(learnings.parent.len(), 0);
    }

    #[test]
    fn test_inherited_learnings_subtask() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: Some("Milestone context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &milestone.id, "Milestone learning", None).unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: Some("Task context".to_string()),
                parent_id: Some(milestone.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &task.id, "Task learning 1", None).unwrap();
        learning_repo::add_learning(&conn, &task.id, "Task learning 2", None).unwrap();

        let subtask = service
            .create(&CreateTaskInput {
                description: "Subtask".to_string(),
                context: Some("Subtask context".to_string()),
                parent_id: Some(task.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        learning_repo::add_learning(&conn, &subtask.id, "Subtask learning", None).unwrap();

        let subtask = service.get(&subtask.id).unwrap();
        let learnings = subtask.learnings.unwrap();

        assert_eq!(learnings.milestone.len(), 1);
        assert_eq!(learnings.milestone[0].content, "Milestone learning");
        assert_eq!(learnings.parent.len(), 2);
        assert_eq!(learnings.parent[0].content, "Task learning 1");
        assert_eq!(learnings.parent[1].content, "Task learning 2");
    }

    #[test]
    fn test_complete_task_without_vcs() {
        // Test that completing a task works even without VCS
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let task = service
            .create(&CreateTaskInput {
                description: "Test task".to_string(),
                context: Some("Test context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let completed = service.complete(&task.id, Some("Done")).unwrap();

        assert!(completed.completed);
        assert_eq!(completed.result, Some("Done".to_string()));
        // commit_sha might be None if no VCS is available, or Some if running in a repo
        // We just verify the operation succeeds
    }

    #[test]
    fn test_complete_task_captures_commit_sha() {
        // This test only verifies the structure - actual commit SHA capture
        // depends on whether the test runs in a VCS repository
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let task = service
            .create(&CreateTaskInput {
                description: "Test task".to_string(),
                context: Some("Test context".to_string()),
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        // Verify commit_sha is initially None
        assert_eq!(task.commit_sha, None);

        let completed = service.complete(&task.id, Some("Done")).unwrap();

        assert!(completed.completed);
        // If we're in a VCS repo (jj or git), commit_sha should be populated
        // If not, it will be None - both are valid outcomes
        // The key is that the operation succeeds without error
    }

    // =========================================================================
    // NEXT-READY TESTS
    // =========================================================================

    #[test]
    fn test_next_ready_returns_deepest_leaf() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create: milestone -> task -> subtask
        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let subtask = service
            .create(&CreateTaskInput {
                description: "Subtask".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Should return deepest leaf (subtask)
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, Some(subtask.id));
    }

    #[test]
    fn test_next_ready_skips_blocked_subtree() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let blocker = service
            .create(&CreateTaskInput {
                description: "Blocker".to_string(),
                context: None,
                parent_id: None,
                priority: Some(1),
                blocked_by: vec![],
            })
            .unwrap();

        // Create milestone blocked by blocker
        let milestone = service
            .create(&CreateTaskInput {
                description: "Blocked milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![blocker.id.clone()],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task under blocked milestone".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Should return blocker (the unblocked milestone), not task under blocked milestone
        let result = service.next_ready(None).unwrap();
        assert_eq!(result, Some(blocker.id.clone()));

        // Searching under the blocked milestone should return None
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, None);

        // But searching under blocker milestone returns itself (leaf)
        let result = service.next_ready(Some(&blocker.id)).unwrap();
        assert_eq!(result, Some(blocker.id.clone()));

        // Mark blocker complete - now task should be returned
        service.complete(&blocker.id, None).unwrap();
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, Some(task.id));
    }

    #[test]
    fn test_next_ready_milestone_as_leaf() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create a milestone with no children
        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone with no children".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Should return the milestone itself
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, Some(milestone.id));
    }

    #[test]
    fn test_next_ready_respects_priority_order() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Low priority task (created first)
        let low = service
            .create(&CreateTaskInput {
                description: "Low priority".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(1),
                blocked_by: vec![],
            })
            .unwrap();

        // High priority task (created second)
        let high = service
            .create(&CreateTaskInput {
                description: "High priority".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Should return high priority first
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, Some(high.id.clone()));

        // Complete high, should return low
        service.complete(&high.id, None).unwrap();
        let result = service.next_ready(Some(&milestone.id)).unwrap();
        assert_eq!(result, Some(low.id));
    }

    #[test]
    fn test_resolve_start_follows_blockers() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create: blocker_task, blocked_milestone -> task
        let blocker_task = service
            .create(&CreateTaskInput {
                description: "Blocker task".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let blocked_milestone = service
            .create(&CreateTaskInput {
                description: "Blocked milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![blocker_task.id.clone()],
            })
            .unwrap();

        let _task = service
            .create(&CreateTaskInput {
                description: "Task under blocked milestone".to_string(),
                context: None,
                parent_id: Some(blocked_milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Trying to start blocked_milestone should resolve to blocker_task
        let target = service.resolve_start_target(&blocked_milestone.id).unwrap();
        assert_eq!(target, blocker_task.id);
    }

    #[test]
    fn test_resolve_start_detects_cycle() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create mutually blocking tasks (will create cycle once we add blocker)
        let task_a = service
            .create(&CreateTaskInput {
                description: "Task A".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task_b = service
            .create(&CreateTaskInput {
                description: "Task B".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![task_a.id.clone()],
            })
            .unwrap();

        // This will be rejected because it creates a cycle
        let result = service.add_blocker(&task_a.id, &task_b.id);
        assert!(matches!(result, Err(OsError::BlockerCycle)));
    }

    #[test]
    fn test_reject_ancestor_blocker() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Try to block task by its ancestor (milestone)
        let result = service.add_blocker(&task.id, &milestone.id);
        assert!(matches!(
            result,
            Err(OsError::InvalidBlockerRelation { .. })
        ));
    }

    #[test]
    fn test_reject_descendant_blocker() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Try to block milestone by its descendant (task)
        let result = service.add_blocker(&milestone.id, &task.id);
        assert!(matches!(
            result,
            Err(OsError::InvalidBlockerRelation { .. })
        ));
    }

    #[test]
    fn test_create_rejects_ancestor_blocker() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Try to create a child blocked by its parent - should fail
        let result = service.create(&CreateTaskInput {
            description: "Task blocked by parent".to_string(),
            context: None,
            parent_id: Some(milestone.id.clone()),
            priority: Some(5),
            blocked_by: vec![milestone.id.clone()],
        });
        assert!(matches!(
            result,
            Err(OsError::InvalidBlockerRelation { .. })
        ));
    }

    #[test]
    fn test_reparent_rejects_blocker_becoming_ancestor() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create two unrelated milestones
        let milestone_a = service
            .create(&CreateTaskInput {
                description: "Milestone A".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let milestone_b = service
            .create(&CreateTaskInput {
                description: "Milestone B".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Create task under B, blocked by A
        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone_b.id.clone()),
                priority: Some(5),
                blocked_by: vec![milestone_a.id.clone()],
            })
            .unwrap();

        // Try to reparent task under A - should fail (A is a blocker, would become ancestor)
        let result = service.update(
            &task.id,
            &UpdateTaskInput {
                parent_id: Some(milestone_a.id.clone()),
                ..Default::default()
            },
        );
        assert!(matches!(
            result,
            Err(OsError::InvalidBlockerRelation { .. })
        ));
    }

    #[test]
    fn test_reparent_checks_subtree_depth() {
        let conn = setup_db();
        let service = TaskService::new(&conn);

        // Create: milestone -> task -> subtask (depth 2)
        let milestone = service
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let task = service
            .create(&CreateTaskInput {
                description: "Task".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let _subtask = service
            .create(&CreateTaskInput {
                description: "Subtask".to_string(),
                context: None,
                parent_id: Some(task.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Create another milestone -> task to get a depth-1 parent
        let other_milestone = service
            .create(&CreateTaskInput {
                description: "Other Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let other_task = service
            .create(&CreateTaskInput {
                description: "Other Task".to_string(),
                context: None,
                parent_id: Some(other_milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Try to reparent "task" (which has a subtask) under "other_task" (depth 1)
        // This would make subtask depth 3, exceeding MAX_DEPTH=2
        let result = service.update(
            &task.id,
            &UpdateTaskInput {
                parent_id: Some(other_task.id.clone()),
                ..Default::default()
            },
        );
        assert!(matches!(result, Err(OsError::MaxDepthExceeded)));
    }
}
