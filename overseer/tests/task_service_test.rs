//! Comprehensive unit tests for TaskService.
//!
//! Tests cover:
//! - CRUD operations
//! - Parent/child relationships and depth limits
//! - Cycle detection (parent and blocker chains)
//! - CASCADE delete behavior
//! - Progressive context retrieval
//! - Inherited learnings
//! - Status transitions
//! - Edge cases and error conditions

use overseer::core::TaskService;
use overseer::db::schema;
use overseer::error::OsError;
use overseer::id::TaskId;
use overseer::types::{CreateTaskInput, ListTasksFilter, UpdateTaskInput};
use rusqlite::Connection;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    schema::init_schema(&conn).unwrap();
    conn
}

// ==================== CRUD Operations ====================

#[test]
fn test_create_milestone() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Build auth system".to_string(),
            context: Some("JWT with refresh tokens".to_string()),
            parent_id: None,
            priority: Some(1),
            blocked_by: vec![],
        })
        .unwrap();

    assert_eq!(task.description, "Build auth system");
    assert_eq!(task.context, "JWT with refresh tokens");
    assert_eq!(task.parent_id, None);
    assert_eq!(task.priority, 1);
    assert_eq!(task.depth, Some(0));
    assert!(!task.completed);
}

#[test]
fn test_create_task_with_parent() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let milestone = service
        .create(&CreateTaskInput {
            description: "Milestone".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: Some(milestone.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    assert_eq!(task.parent_id, Some(milestone.id));
    assert_eq!(task.depth, Some(1));
}

#[test]
fn test_create_with_nonexistent_parent() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let nonexistent_id = TaskId::new(); // Generate a valid ID that doesn't exist in DB

    let result = service.create(&CreateTaskInput {
        description: "Task".to_string(),
        context: None,
        parent_id: Some(nonexistent_id),
        priority: None,
        blocked_by: vec![],
    });

    assert!(matches!(result, Err(OsError::ParentNotFound(_))));
}

#[test]
fn test_create_with_nonexistent_blocker() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let nonexistent_id = TaskId::new();

    let result = service.create(&CreateTaskInput {
        description: "Task".to_string(),
        context: None,
        parent_id: None,
        priority: None,
        blocked_by: vec![nonexistent_id],
    });

    assert!(matches!(result, Err(OsError::BlockerNotFound(_))));
}

#[test]
fn test_get_task_with_full_context() {
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

    assert!(task.context_chain.is_some());
    assert!(task.learnings.is_some());
    assert_eq!(task.depth, Some(0));
}

#[test]
fn test_get_nonexistent_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let nonexistent_id = TaskId::new();
    let result = service.get(&nonexistent_id);
    assert!(matches!(result, Err(OsError::TaskNotFound(_))));
}

#[test]
fn test_list_all_tasks() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    service
        .create(&CreateTaskInput {
            description: "Task 1".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    service
        .create(&CreateTaskInput {
            description: "Task 2".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let tasks = service
        .list(&ListTasksFilter {
            parent_id: None,
            ready: false,
            completed: None,
            depth: None,
            ..Default::default()
        })
        .unwrap();

    assert_eq!(tasks.len(), 2);
}

#[test]
fn test_update_description() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Original".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let updated = service
        .update(
            &task.id,
            &UpdateTaskInput {
                description: Some("Updated".to_string()),
                context: None,
                parent_id: None,
                priority: None,
            },
        )
        .unwrap();

    assert_eq!(updated.description, "Updated");
}

#[test]
fn test_update_nonexistent_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let nonexistent_id = TaskId::new();
    let result = service.update(
        &nonexistent_id,
        &UpdateTaskInput {
            description: Some("Updated".to_string()),
            context: None,
            parent_id: None,
            priority: None,
        },
    );

    assert!(matches!(result, Err(OsError::TaskNotFound(_))));
}

#[test]
fn test_delete_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    service.delete(&task.id).unwrap();

    let result = service.get(&task.id);
    assert!(matches!(result, Err(OsError::TaskNotFound(_))));
}

#[test]
fn test_delete_nonexistent_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let nonexistent_id = TaskId::new();
    let result = service.delete(&nonexistent_id);
    assert!(matches!(result, Err(OsError::TaskNotFound(_))));
}

// ==================== Depth Limits ====================

#[test]
fn test_max_depth_enforcement() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create milestone (depth 0)
    let milestone = service
        .create(&CreateTaskInput {
            description: "Milestone".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Create task (depth 1)
    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: Some(milestone.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Create subtask (depth 2)
    let subtask = service
        .create(&CreateTaskInput {
            description: "Subtask".to_string(),
            context: None,
            parent_id: Some(task.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    assert_eq!(subtask.depth, Some(2));

    // Attempt to create child of subtask (depth 3) - should fail
    let result = service.create(&CreateTaskInput {
        description: "Too deep".to_string(),
        context: None,
        parent_id: Some(subtask.id),
        priority: None,
        blocked_by: vec![],
    });

    assert!(matches!(result, Err(OsError::MaxDepthExceeded)));
}

#[test]
fn test_update_parent_violates_max_depth() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create milestone → task → subtask
    let milestone = service
        .create(&CreateTaskInput {
            description: "Milestone".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: Some(milestone.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let subtask = service
        .create(&CreateTaskInput {
            description: "Subtask".to_string(),
            context: None,
            parent_id: Some(task.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Create orphan task
    let orphan = service
        .create(&CreateTaskInput {
            description: "Orphan".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Try to set subtask as parent of orphan (would be depth 3)
    let result = service.update(
        &orphan.id,
        &UpdateTaskInput {
            description: None,
            context: None,
            parent_id: Some(subtask.id),
            priority: None,
        },
    );

    assert!(matches!(result, Err(OsError::MaxDepthExceeded)));
}

// ==================== Cycle Detection ====================

#[test]
fn test_parent_cycle_direct() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Try to set task as its own parent
    let result = service.update(
        &task.id,
        &UpdateTaskInput {
            description: None,
            context: None,
            parent_id: Some(task.id.clone()),
            priority: None,
        },
    );

    assert!(matches!(result, Err(OsError::ParentCycle)));
}

#[test]
fn test_parent_cycle_indirect() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create A → B → C
    let task_a = service
        .create(&CreateTaskInput {
            description: "Task A".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task_b = service
        .create(&CreateTaskInput {
            description: "Task B".to_string(),
            context: None,
            parent_id: Some(task_a.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task_c = service
        .create(&CreateTaskInput {
            description: "Task C".to_string(),
            context: None,
            parent_id: Some(task_b.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Try to set C as parent of A (creates cycle)
    let result = service.update(
        &task_a.id,
        &UpdateTaskInput {
            description: None,
            context: None,
            parent_id: Some(task_c.id),
            priority: None,
        },
    );

    assert!(matches!(result, Err(OsError::ParentCycle)));
}

#[test]
fn test_blocker_cycle_direct() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Try to add task as its own blocker - should return InvalidBlockerRelation
    let result = service.add_blocker(&task.id, &task.id);
    assert!(matches!(
        result,
        Err(OsError::InvalidBlockerRelation { .. })
    ));
}

#[test]
fn test_blocker_cycle_indirect() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create A → B → C (blocker chain)
    let task_a = service
        .create(&CreateTaskInput {
            description: "Task A".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task_b = service
        .create(&CreateTaskInput {
            description: "Task B".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![task_a.id.clone()],
        })
        .unwrap();

    let task_c = service
        .create(&CreateTaskInput {
            description: "Task C".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![task_b.id.clone()],
        })
        .unwrap();

    // Try to add C as blocker of A (creates cycle: A blocks B blocks C blocks A)
    let result = service.add_blocker(&task_a.id, &task_c.id);
    assert!(matches!(result, Err(OsError::BlockerCycle)));
}

#[test]
fn test_blocker_cycle_complex() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create diamond: A blocks B and C, both B and C block D
    let task_a = service
        .create(&CreateTaskInput {
            description: "Task A".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task_b = service
        .create(&CreateTaskInput {
            description: "Task B".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![task_a.id.clone()],
        })
        .unwrap();

    let task_c = service
        .create(&CreateTaskInput {
            description: "Task C".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![task_a.id.clone()],
        })
        .unwrap();

    let task_d = service
        .create(&CreateTaskInput {
            description: "Task D".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![task_b.id.clone(), task_c.id.clone()],
        })
        .unwrap();

    // Try to add D as blocker of A (creates cycle through two paths)
    let result = service.add_blocker(&task_a.id, &task_d.id);
    assert!(matches!(result, Err(OsError::BlockerCycle)));
}

// ==================== Blocker Management ====================

#[test]
fn test_add_blocker() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let blocker = service
        .create(&CreateTaskInput {
            description: "Blocker".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let updated = service.add_blocker(&task.id, &blocker.id).unwrap();
    assert_eq!(updated.blocked_by, vec![blocker.id]);
}

#[test]
fn test_remove_blocker() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let blocker = service
        .create(&CreateTaskInput {
            description: "Blocker".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![blocker.id.clone()],
        })
        .unwrap();

    assert_eq!(task.blocked_by.len(), 1);

    let updated = service.remove_blocker(&task.id, &blocker.id).unwrap();
    assert_eq!(updated.blocked_by.len(), 0);
}

// ==================== Status Transitions ====================

#[test]
fn test_start_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    assert!(task.started_at.is_none());

    let started = service.start(&task.id).unwrap();
    assert!(started.started_at.is_some());
}

#[test]
fn test_complete_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let completed = service
        .complete(&task.id, Some("Implemented feature"))
        .unwrap();

    assert!(completed.completed);
    assert!(completed.completed_at.is_some());
    assert_eq!(completed.result, Some("Implemented feature".to_string()));
}

#[test]
fn test_complete_task_with_pending_children() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let parent = service
        .create(&CreateTaskInput {
            description: "Parent".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    service
        .create(&CreateTaskInput {
            description: "Child".to_string(),
            context: None,
            parent_id: Some(parent.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let result = service.complete(&parent.id, None);
    assert!(matches!(result, Err(OsError::PendingChildren)));
}

#[test]
fn test_reopen_task() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let completed = service.complete(&task.id, None).unwrap();
    assert!(completed.completed);

    let reopened = service.reopen(&task.id).unwrap();
    assert!(!reopened.completed);
    assert!(reopened.completed_at.is_none());
}

// ==================== CASCADE Delete ====================

#[test]
fn test_cascade_delete_children() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let parent = service
        .create(&CreateTaskInput {
            description: "Parent".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let child = service
        .create(&CreateTaskInput {
            description: "Child".to_string(),
            context: None,
            parent_id: Some(parent.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Delete parent - child should be CASCADE deleted
    service.delete(&parent.id).unwrap();

    let result = service.get(&child.id);
    assert!(matches!(result, Err(OsError::TaskNotFound(_))));
}

#[test]
fn test_cascade_delete_blockers() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    let blocker = service
        .create(&CreateTaskInput {
            description: "Blocker".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![blocker.id.clone()],
        })
        .unwrap();

    // Delete blocker - relationship should be CASCADE deleted
    service.delete(&blocker.id).unwrap();

    let updated = service.get(&task.id).unwrap();
    assert_eq!(updated.blocked_by.len(), 0);
}

#[test]
fn test_cascade_delete_deep_hierarchy() {
    let conn = setup_db();
    let service = TaskService::new(&conn);

    // Create milestone → task → subtask
    let milestone = service
        .create(&CreateTaskInput {
            description: "Milestone".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let task = service
        .create(&CreateTaskInput {
            description: "Task".to_string(),
            context: None,
            parent_id: Some(milestone.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    let subtask = service
        .create(&CreateTaskInput {
            description: "Subtask".to_string(),
            context: None,
            parent_id: Some(task.id.clone()),
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

    // Delete milestone - task and subtask should be CASCADE deleted
    service.delete(&milestone.id).unwrap();

    assert!(matches!(
        service.get(&task.id),
        Err(OsError::TaskNotFound(_))
    ));
    assert!(matches!(
        service.get(&subtask.id),
        Err(OsError::TaskNotFound(_))
    ));
}
