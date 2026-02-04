// Allow unreachable_patterns for serde rename conflict (context vs context_chain)
#![allow(unreachable_patterns)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::learning_repo::Learning;
use crate::id::TaskId;

/// Task lifecycle state - computed from field values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleState {
    Pending,
    InProgress,
    Completed,
    Cancelled,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub own: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedLearnings {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub milestone: Vec<Learning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parent: Vec<Learning>,
}

/// Task struct with dual-purpose context fields:
/// - `context`: raw string stored in DB (never serialized)
/// - `context_chain`: structured chain for JSON output (serializes as "context")
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: TaskId,
    pub parent_id: Option<TaskId>,
    pub description: String,
    #[serde(default, skip_serializing)]
    pub context: String,
    #[serde(rename = "context", skip_serializing_if = "Option::is_none")]
    pub context_chain: Option<TaskContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub learnings: Option<InheritedLearnings>,
    pub result: Option<String>,
    pub priority: i32,
    pub completed: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<TaskId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<TaskId>,
    /// Computed field: true if task or any ancestor has incomplete blockers
    #[serde(default)]
    pub effectively_blocked: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub archived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<DateTime<Utc>>,
}

impl Task {
    /// Compute lifecycle state from field values (single source of truth)
    /// Precedence: archived > cancelled > completed > started > pending
    pub fn lifecycle_state(&self) -> LifecycleState {
        if self.archived {
            LifecycleState::Archived
        } else if self.cancelled {
            LifecycleState::Cancelled
        } else if self.completed {
            LifecycleState::Completed
        } else if self.started_at.is_some() {
            LifecycleState::InProgress
        } else {
            LifecycleState::Pending
        }
    }

    /// Task is active for work (not finished or archived)
    pub fn is_active_for_work(&self) -> bool {
        matches!(
            self.lifecycle_state(),
            LifecycleState::Pending | LifecycleState::InProgress
        )
    }

    /// Task is finished for hierarchy (completed OR cancelled, regardless of archived)
    pub fn is_finished_for_hierarchy(&self) -> bool {
        self.completed || self.cancelled
    }

    /// Task satisfies blocker (completed only, not cancelled)
    /// Note: archived is a visibility filter, doesn't affect blocker semantics
    pub fn satisfies_blocker(&self) -> bool {
        self.completed && !self.cancelled
    }

    /// Validate lifecycle invariants (call at DB hydrate in debug/tests)
    #[cfg(debug_assertions)]
    pub fn validate_lifecycle_invariants(&self) -> Result<(), String> {
        // Invalid: completed AND cancelled
        if self.completed && self.cancelled {
            return Err("Task cannot be both completed and cancelled".into());
        }
        // Invalid: archived but not finished
        if self.archived && !self.is_finished_for_hierarchy() {
            return Err("Archived task must be completed or cancelled".into());
        }
        // Invalid: state flag without timestamp
        if self.cancelled && self.cancelled_at.is_none() {
            return Err("Cancelled task must have cancelled_at timestamp".into());
        }
        if self.archived && self.archived_at.is_none() {
            return Err("Archived task must have archived_at timestamp".into());
        }
        if self.completed && self.completed_at.is_none() {
            return Err("Completed task must have completed_at timestamp".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct CreateTaskInput {
    pub description: String,
    pub context: Option<String>,
    pub parent_id: Option<TaskId>,
    pub priority: Option<i32>,
    pub blocked_by: Vec<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<i32>,
    pub parent_id: Option<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct ListTasksFilter {
    pub parent_id: Option<TaskId>,
    pub ready: bool,
    pub completed: Option<bool>,
    /// Filter by task depth: 0=milestones, 1=tasks, 2=subtasks
    pub depth: Option<i32>,
    /// Filter by archived state:
    /// - None: WHERE archived = 0 (default - hide archived)
    /// - Some(true): WHERE archived = 1 (only archived)
    /// - Some(false): WHERE archived = 0 (explicit hide)
    pub archived: Option<bool>,
}
