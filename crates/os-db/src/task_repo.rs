use crate::util::{decode_enum, decode_json, encode_enum, encode_json, from_rfc3339, to_rfc3339};
use os_core::error::TaskError;
use os_core::gates::GateRepository;
use os_core::help::HelpRepository;
use os_core::learnings::LearningRepository;
use os_core::reviews::ReviewRepository;
use os_core::tasks::TaskRepository;
use os_core::types::enums::{Priority, TaskKind, TaskStatus};
use os_core::types::ids::{AnyTaskId, MilestoneId, RepoId};
use os_core::types::io::{CreateTaskInput, TaskFilter, UpdateTaskInput};
use os_core::types::task::{Task, TaskContext, TaskProgress, TaskTree, TaskWithContext};
use os_core::vcs::TaskVcsRepository;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use ulid::Ulid;

pub struct TaskRepo<'a> {
    pub conn: &'a Connection,
}

impl<'a> TaskRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
}

impl<'a> TaskRepository for TaskRepo<'a> {
    fn create(&self, input: CreateTaskInput) -> Result<Task, TaskError> {
        let now = chrono::Utc::now();
        let status = TaskStatus::Pending;
        let priority = input.priority.unwrap_or(Priority::Normal);
        let id = new_task_id(input.kind)?;

        let task = Task {
            id,
            repo_id: input.repo_id,
            parent_id: input.parent_id,
            kind: input.kind,
            description: input.description,
            context: input.context,
            priority,
            status,
            blocked_by: input.blocked_by,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: None,
        };

        let sql = "INSERT INTO tasks (id, repo_id, parent_id, kind, description, context, priority, status, blocked_by, created_at, updated_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)";
        let params = (
            task.id.as_str(),
            task.repo_id.as_str(),
            task.parent_id.as_ref().map(AnyTaskId::as_str),
            encode_enum(&task.kind).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            task.description.clone(),
            task.context.clone(),
            encode_enum(&task.priority).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            encode_enum(&task.status).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            encode_json(&task.blocked_by).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&task.created_at),
            to_rfc3339(&task.updated_at),
            task.started_at.map(|value| to_rfc3339(&value)),
            task.completed_at.map(|value| to_rfc3339(&value)),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(task)
    }

    fn get(&self, id: &AnyTaskId) -> Result<Option<Task>, TaskError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, repo_id, parent_id, kind, description, context, priority, status, blocked_by, created_at, updated_at, started_at, completed_at FROM tasks WHERE id = ?1")
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt
            .query([id.as_str()])
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let Some(row) = rows.next().map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?
        else {
            return Ok(None);
        };
        map_task_row(row).map(Some)
    }

    fn get_with_context(&self, id: &AnyTaskId) -> Result<Option<TaskWithContext>, TaskError> {
        let task = match self.get(id)? {
            Some(task) => task,
            None => return Ok(None),
        };

        let mut parent_context = None;
        let mut milestone_context = None;
        if let Some(parent_id) = &task.parent_id {
            if let Some(parent) = self.get(parent_id)? {
                parent_context = parent.context.clone();
                if parent.kind == TaskKind::Milestone {
                    milestone_context = parent.context.clone();
                } else if let Some(grand_id) = parent.parent_id {
                    if let Some(grand) = self.get(&grand_id)? {
                        milestone_context = grand.context.clone();
                    }
                }
            }
        }

        let context = TaskContext {
            own: task.context.clone(),
            parent: parent_context,
            milestone: milestone_context,
        };

        let learnings = crate::learning_repo::LearningRepo::new(self.conn)
            .get_inherited(id)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let gates = crate::gate_repo::GateRepo::new(self.conn)
            .get_effective(id)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let vcs = crate::task_vcs_repo::TaskVcsRepo::new(self.conn)
            .get(id)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let review = crate::review_repo::ReviewRepo::new(self.conn)
            .get_active_for_task(id)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let help_request = crate::help_repo::HelpRepo::new(self.conn)
            .get_active(id)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(Some(TaskWithContext {
            task,
            context,
            learnings,
            gates,
            vcs,
            review,
            help_request,
        }))
    }

    fn list(&self, filter: TaskFilter) -> Result<Vec<Task>, TaskError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, repo_id, parent_id, kind, description, context, priority, status, blocked_by, created_at, updated_at, started_at, completed_at FROM tasks")
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        let mut rows = stmt.query([]).map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next().map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })? {
            tasks.push(map_task_row(row)?);
        }
        let archived_set = load_archived_set(self.conn, filter.archived)?;
        Ok(filter_tasks(tasks, &filter, &archived_set))
    }

    fn update(&self, id: &AnyTaskId, input: UpdateTaskInput) -> Result<Task, TaskError> {
        let mut task = self.get(id)?.ok_or(TaskError::NotFound)?;
        if let Some(description) = input.description {
            task.description = description;
        }
        if let Some(context) = input.context {
            task.context = Some(context);
        }
        if let Some(priority) = input.priority {
            task.priority = priority;
        }
        task.updated_at = chrono::Utc::now();

        let sql = "UPDATE tasks SET description = ?1, context = ?2, priority = ?3, updated_at = ?4 WHERE id = ?5";
        let params = (
            task.description.clone(),
            task.context.clone(),
            encode_enum(&task.priority).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&task.updated_at),
            task.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;

        Ok(task)
    }

    fn set_status(
        &self,
        id: &AnyTaskId,
        status: TaskStatus,
        started_at: Option<chrono::DateTime<chrono::Utc>>,
        completed_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Task, TaskError> {
        let mut task = self.get(id)?.ok_or(TaskError::NotFound)?;
        task.status = status;
        if let Some(value) = started_at {
            task.started_at = Some(value);
        }
        if let Some(value) = completed_at {
            task.completed_at = Some(value);
        }
        task.updated_at = chrono::Utc::now();
        let sql = "UPDATE tasks SET status = ?1, updated_at = ?2, started_at = ?3, completed_at = ?4 WHERE id = ?5";
        let params = (
            encode_enum(&task.status).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&task.updated_at),
            task.started_at.map(|value| to_rfc3339(&value)),
            task.completed_at.map(|value| to_rfc3339(&value)),
            task.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(task)
    }

    fn delete(&self, id: &AnyTaskId) -> Result<(), TaskError> {
        let affected = self
            .conn
            .execute("DELETE FROM tasks WHERE id = ?1", [id.as_str()])
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        if affected == 0 {
            return Err(TaskError::NotFound);
        }
        Ok(())
    }

    fn tree(&self, root_id: Option<&AnyTaskId>) -> Result<TaskTree, TaskError> {
        let tasks = self.list(TaskFilter {
            repo_id: None,
            parent_id: None,
            kind: None,
            status: None,
            ready: None,
            archived: None,
        })?;
        build_tree(tasks, root_id)
    }

    fn next_ready(
        &self,
        repo_id: &RepoId,
        scope: Option<&MilestoneId>,
    ) -> Result<Option<Task>, TaskError> {
        let tasks = self.list(TaskFilter {
            repo_id: Some(repo_id.clone()),
            parent_id: None,
            kind: None,
            status: None,
            ready: None,
            archived: None,
        })?;
        let tasks = filter_scope(tasks, scope);
        let ready = compute_ready(&tasks);
        Ok(tasks
            .into_iter()
            .filter(|task| ready.contains(task.id.as_str()))
            .find(|task| task.status == TaskStatus::Pending))
    }

    fn add_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError> {
        let mut task = self.get(task_id)?.ok_or(TaskError::NotFound)?;
        if !task.blocked_by.iter().any(|id| id == blocker_id) {
            task.blocked_by.push(blocker_id.clone());
        }
        task.updated_at = chrono::Utc::now();
        let sql = "UPDATE tasks SET blocked_by = ?1, updated_at = ?2 WHERE id = ?3";
        let params = (
            encode_json(&task.blocked_by).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&task.updated_at),
            task.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(())
    }

    fn remove_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError> {
        let mut task = self.get(task_id)?.ok_or(TaskError::NotFound)?;
        task.blocked_by.retain(|id| id != blocker_id);
        task.updated_at = chrono::Utc::now();
        let sql = "UPDATE tasks SET blocked_by = ?1, updated_at = ?2 WHERE id = ?3";
        let params = (
            encode_json(&task.blocked_by).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
            to_rfc3339(&task.updated_at),
            task.id.as_str(),
        );
        self.conn
            .execute(sql, params)
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?;
        Ok(())
    }

    fn progress(
        &self,
        repo_id: &RepoId,
        scope: Option<&AnyTaskId>,
    ) -> Result<TaskProgress, TaskError> {
        let tasks = self.list(TaskFilter {
            repo_id: Some(repo_id.clone()),
            parent_id: None,
            kind: None,
            status: None,
            ready: None,
            archived: None,
        })?;
        let tasks = filter_scope_any(tasks, scope);
        Ok(compute_progress(&tasks))
    }
}

fn new_task_id(kind: TaskKind) -> Result<AnyTaskId, TaskError> {
    let ulid = Ulid::new().to_string();
    let value = match kind {
        TaskKind::Milestone => format!("{}{}", os_core::types::ids::MilestoneId::PREFIX, ulid),
        TaskKind::Task => format!("{}{}", os_core::types::ids::TaskId::PREFIX, ulid),
        TaskKind::Subtask => format!("{}{}", os_core::types::ids::SubtaskId::PREFIX, ulid),
    };
    AnyTaskId::parse(&value).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })
}

fn map_task_row(row: &rusqlite::Row<'_>) -> Result<Task, TaskError> {
    let id: String = row.get(0).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let repo_id: String = row.get(1).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let parent_id: Option<String> = row.get(2).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let kind: String = row.get(3).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let description: String = row.get(4).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let context: Option<String> = row.get(5).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let priority: String = row.get(6).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let status: String = row.get(7).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let blocked_by: String = row.get(8).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let created_at: String = row.get(9).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let updated_at: String = row.get(10).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let started_at: Option<String> = row.get(11).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let completed_at: Option<String> = row.get(12).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;

    let id = AnyTaskId::parse(&id).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let repo_id = RepoId::new(repo_id).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let parent_id = match parent_id {
        Some(value) => Some(
            AnyTaskId::parse(&value).map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
        ),
        None => None,
    };
    let kind = decode_enum(&kind).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let priority = decode_enum(&priority).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let status = decode_enum(&status).map_err(|err| TaskError::InvalidInput {
        message: err.to_string(),
    })?;
    let blocked_by: Vec<AnyTaskId> =
        decode_json(&blocked_by).map_err(|err| TaskError::InvalidInput {
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
        created_at: from_rfc3339(&created_at).map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?,
        updated_at: from_rfc3339(&updated_at).map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?,
        started_at: started_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
        completed_at: completed_at
            .map(|value| from_rfc3339(&value))
            .transpose()
            .map_err(|err| TaskError::InvalidInput {
                message: err.to_string(),
            })?,
    })
}

fn filter_tasks(
    tasks: Vec<Task>,
    filter: &TaskFilter,
    archived_set: &HashSet<String>,
) -> Vec<Task> {
    let filtered = tasks
        .into_iter()
        .filter(|task| match &filter.repo_id {
            Some(repo_id) => task.repo_id == *repo_id,
            None => true,
        })
        .filter(|task| match &filter.parent_id {
            Some(Some(parent)) => task.parent_id.as_ref() == Some(parent),
            Some(None) => task.parent_id.is_none(),
            None => true,
        })
        .filter(|task| match &filter.kind {
            Some(kinds) => kinds.contains(&task.kind),
            None => true,
        })
        .filter(|task| match &filter.status {
            Some(statuses) => statuses.contains(&task.status),
            None => true,
        })
        .filter(|task| match filter.archived {
            Some(true) => archived_set.contains(task.id.as_str()),
            Some(false) => !archived_set.contains(task.id.as_str()),
            None => true,
        })
        .collect::<Vec<_>>();

    let ready_set = match filter.ready {
        Some(_) => compute_ready(&filtered),
        None => HashSet::new(),
    };

    filtered
        .into_iter()
        .filter(|task| match filter.ready {
            Some(true) => ready_set.contains(task.id.as_str()),
            Some(false) => !ready_set.contains(task.id.as_str()),
            None => true,
        })
        .collect()
}

fn build_tree(tasks: Vec<Task>, root_id: Option<&AnyTaskId>) -> Result<TaskTree, TaskError> {
    let mut by_parent: HashMap<Option<String>, Vec<Task>> = HashMap::new();
    let mut by_id: HashMap<String, Task> = HashMap::new();
    for task in tasks {
        by_id.insert(task.id.as_str().to_string(), task.clone());
        let key = task.parent_id.as_ref().map(|id| id.as_str().to_string());
        by_parent.entry(key).or_default().push(task);
    }

    let root_task = match root_id {
        Some(id) => by_id.get(id.as_str()).cloned().ok_or(TaskError::NotFound)?,
        None => {
            let roots = by_parent.get(&None).cloned().unwrap_or_default();
            if roots.len() == 1 {
                roots[0].clone()
            } else {
                return Err(TaskError::InvalidInput {
                    message: "root_id required when multiple roots exist".to_string(),
                });
            }
        }
    };

    Ok(build_tree_node(root_task, &by_parent))
}

fn build_tree_node(task: Task, by_parent: &HashMap<Option<String>, Vec<Task>>) -> TaskTree {
    let key = Some(task.id.as_str().to_string());
    let children = by_parent
        .get(&key)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|child| build_tree_node(child, by_parent))
        .collect();
    TaskTree { task, children }
}

fn filter_scope(tasks: Vec<Task>, scope: Option<&MilestoneId>) -> Vec<Task> {
    match scope {
        Some(milestone) => tasks
            .into_iter()
            .filter(|task| match &task.parent_id {
                Some(parent) => parent.as_str() == milestone.as_str(),
                None => task.id.as_str() == milestone.as_str(),
            })
            .collect(),
        None => tasks,
    }
}

fn filter_scope_any(tasks: Vec<Task>, scope: Option<&AnyTaskId>) -> Vec<Task> {
    match scope {
        Some(scope_id) => tasks
            .into_iter()
            .filter(|task| {
                task.id.as_str() == scope_id.as_str()
                    || task.parent_id.as_ref().map(AnyTaskId::as_str) == Some(scope_id.as_str())
            })
            .collect(),
        None => tasks,
    }
}

fn load_archived_set(
    conn: &Connection,
    archived_filter: Option<bool>,
) -> Result<HashSet<String>, TaskError> {
    if archived_filter.is_none() {
        return Ok(HashSet::new());
    }
    let mut stmt = conn
        .prepare("SELECT task_id FROM task_vcs WHERE archived_at IS NOT NULL")
        .map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?;
    let mut set = HashSet::new();
    for row in rows {
        set.insert(row.map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?);
    }
    Ok(set)
}

fn compute_ready(tasks: &[Task]) -> HashSet<String> {
    let mut by_id: HashMap<&str, &Task> = HashMap::new();
    for task in tasks {
        by_id.insert(task.id.as_str(), task);
    }
    tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Pending)
        .filter(|task| !is_effectively_blocked(task.id.as_str(), &by_id))
        .map(|task| task.id.as_str().to_string())
        .collect()
}

fn is_effectively_blocked(id: &str, by_id: &HashMap<&str, &Task>) -> bool {
    let mut current = Some(id);
    while let Some(task_id) = current {
        let Some(task) = by_id.get(task_id) else {
            break;
        };
        for blocker in &task.blocked_by {
            if let Some(blocker_task) = by_id.get(blocker.as_str()) {
                if !matches!(
                    blocker_task.status,
                    TaskStatus::Completed | TaskStatus::Cancelled
                ) {
                    return true;
                }
            } else {
                return true;
            }
        }
        current = task.parent_id.as_ref().map(AnyTaskId::as_str);
    }
    false
}

fn compute_progress(tasks: &[Task]) -> TaskProgress {
    let ready_set = compute_ready(tasks);
    let mut progress = TaskProgress {
        total: 0,
        completed: 0,
        ready: 0,
        blocked: 0,
        in_progress: 0,
        in_review: 0,
        awaiting_human: 0,
    };
    for task in tasks {
        progress.total += 1;
        match task.status {
            TaskStatus::Completed => progress.completed += 1,
            TaskStatus::InProgress => progress.in_progress += 1,
            TaskStatus::InReview => progress.in_review += 1,
            TaskStatus::AwaitingHuman => progress.awaiting_human += 1,
            TaskStatus::Pending => {}
            TaskStatus::Cancelled => {}
        }
        if ready_set.contains(task.id.as_str()) {
            progress.ready += 1;
        } else if task.status == TaskStatus::Pending {
            progress.blocked += 1;
        }
    }
    progress
}
