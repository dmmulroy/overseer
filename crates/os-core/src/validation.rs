use crate::error::TaskError;
use crate::types::{AnyTaskId, Task, TaskKind, TaskStatus};
use std::collections::{HashMap, HashSet};

pub fn validate_task_kind(task: &Task) -> Result<(), TaskError> {
    if task.id.kind() != task.kind {
        return Err(TaskError::InvalidInput {
            message: "task id kind does not match task.kind".to_string(),
        });
    }
    Ok(())
}

pub fn validate_task_hierarchy(
    task: &Task,
    parent_kind: Option<TaskKind>,
) -> Result<(), TaskError> {
    match task.kind {
        TaskKind::Milestone => {
            if task.parent_id.is_some() {
                return Err(TaskError::InvalidInput {
                    message: "milestone cannot have parent".to_string(),
                });
            }
        }
        TaskKind::Task => {
            if let Some(kind) = parent_kind {
                if kind != TaskKind::Milestone {
                    return Err(TaskError::InvalidInput {
                        message: "task parent must be milestone".to_string(),
                    });
                }
            }
        }
        TaskKind::Subtask => {
            if parent_kind != Some(TaskKind::Task) {
                return Err(TaskError::InvalidInput {
                    message: "subtask parent must be task".to_string(),
                });
            }
        }
    }
    Ok(())
}

pub fn validate_task_status_transition(from: TaskStatus, to: TaskStatus) -> Result<(), TaskError> {
    use TaskStatus::{AwaitingHuman, Cancelled, Completed, InProgress, InReview, Pending};

    if from == to {
        return Ok(());
    }

    let valid = match (from, to) {
        (Pending, InProgress) => true,
        (InProgress, InReview) => true,
        (InReview, Completed) => true,
        (Pending, Cancelled) => true,
        (InProgress, Cancelled) => true,
        (InReview, Cancelled) => true,
        (Pending, AwaitingHuman) => true,
        (InProgress, AwaitingHuman) => true,
        (InReview, AwaitingHuman) => true,
        (AwaitingHuman, Pending) => true,
        (AwaitingHuman, InProgress) => true,
        (AwaitingHuman, InReview) => true,
        _ => false,
    };

    if valid {
        Ok(())
    } else {
        Err(TaskError::InvalidTransition { from, to })
    }
}

pub fn validate_blocker_cycle(
    task_id: &AnyTaskId,
    blocker_id: &AnyTaskId,
    blocked_by: &HashMap<AnyTaskId, Vec<AnyTaskId>>,
) -> Result<(), TaskError> {
    if task_id == blocker_id {
        return Err(TaskError::SelfBlock);
    }

    let mut visited: HashSet<AnyTaskId> = HashSet::new();
    let mut stack: Vec<AnyTaskId> = vec![blocker_id.clone()];

    while let Some(current) = stack.pop() {
        if !visited.insert(current.clone()) {
            continue;
        }
        if let Some(children) = blocked_by.get(&current) {
            for child in children {
                if child == task_id {
                    return Err(TaskError::CycleDetected);
                }
                stack.push(child.clone());
            }
        }
    }

    Ok(())
}
