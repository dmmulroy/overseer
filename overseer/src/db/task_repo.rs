use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{OsError, Result};
use crate::id::TaskId;
use crate::types::{CreateTaskInput, ListTasksFilter, Task, UpdateTaskInput};

fn now() -> DateTime<Utc> {
    Utc::now()
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        description: row.get("description")?,
        context: row.get("context")?,
        context_chain: None,
        learnings: None,
        result: row.get("result")?,
        priority: row.get("priority")?,
        completed: row.get::<_, i32>("completed")? != 0,
        completed_at: row
            .get::<_, Option<String>>("completed_at")?
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        created_at: row
            .get::<_, String>("created_at")
            .ok()
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(now),
        updated_at: row
            .get::<_, String>("updated_at")
            .ok()
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(now),
        started_at: row
            .get::<_, Option<String>>("started_at")?
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        commit_sha: row.get("commit_sha")?,
        bookmark: row.get("bookmark")?,
        start_commit: row.get("start_commit")?,
        depth: None,
        blocked_by: Vec::new(),
        blocks: Vec::new(),
        effectively_blocked: false, // Computed by TaskService
        cancelled: row.get::<_, i32>("cancelled")? != 0,
        cancelled_at: row
            .get::<_, Option<String>>("cancelled_at")?
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        archived: row.get::<_, i32>("archived")? != 0,
        archived_at: row
            .get::<_, Option<String>>("archived_at")?
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
    })
}

pub fn create_task(conn: &Connection, input: &CreateTaskInput) -> Result<Task> {
    let id = TaskId::new();
    let now_str = now().to_rfc3339();

    conn.execute(
        r#"
        INSERT INTO tasks (id, parent_id, description, context, priority, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            &id,
            input.parent_id.as_ref(),
            input.description,
            input.context.as_deref().unwrap_or(""),
            input.priority.unwrap_or(1),
            now_str,
            now_str,
        ],
    )?;

    for blocker_id in &input.blocked_by {
        conn.execute(
            "INSERT INTO task_blockers (task_id, blocker_id) VALUES (?1, ?2)",
            params![&id, blocker_id],
        )?;
    }

    get_task(conn, &id)?.ok_or_else(|| OsError::TaskNotFound(id))
}

pub fn get_task(conn: &Connection, id: &TaskId) -> Result<Option<Task>> {
    let task: Option<Task> = conn
        .query_row(
            "SELECT * FROM tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )
        .optional()?;

    if let Some(mut task) = task {
        task.blocked_by = get_blockers(conn, id)?;
        task.blocks = get_blocking(conn, id)?;
        Ok(Some(task))
    } else {
        Ok(None)
    }
}

pub fn get_blockers(conn: &Connection, task_id: &TaskId) -> Result<Vec<TaskId>> {
    let mut stmt = conn.prepare("SELECT blocker_id FROM task_blockers WHERE task_id = ?1")?;
    let ids = stmt
        .query_map(params![task_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<TaskId>>>()?;
    Ok(ids)
}

pub fn get_blocking(conn: &Connection, blocker_id: &TaskId) -> Result<Vec<TaskId>> {
    let mut stmt = conn.prepare("SELECT task_id FROM task_blockers WHERE blocker_id = ?1")?;
    let ids = stmt
        .query_map(params![blocker_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<TaskId>>>()?;
    Ok(ids)
}

pub fn list_tasks(conn: &Connection, filter: &ListTasksFilter) -> Result<Vec<Task>> {
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // Use recursive CTE to compute depth if filtering by depth
    let sql = if filter.depth.is_some() {
        let mut sql = String::from(
            r#"
            WITH RECURSIVE task_depths AS (
                SELECT id, parent_id, description, context, result, priority, completed,
                       completed_at, created_at, updated_at, started_at, commit_sha, bookmark, start_commit,
                       cancelled, cancelled_at, archived, archived_at,
                       0 as depth
                FROM tasks WHERE parent_id IS NULL
                UNION ALL
                SELECT t.id, t.parent_id, t.description, t.context, t.result, t.priority, t.completed,
                       t.completed_at, t.created_at, t.updated_at, t.started_at, t.commit_sha, t.bookmark, t.start_commit,
                       t.cancelled, t.cancelled_at, t.archived, t.archived_at,
                       td.depth + 1
                FROM tasks t
                INNER JOIN task_depths td ON t.parent_id = td.id
            )
            SELECT id, parent_id, description, context, result, priority, completed,
                   completed_at, created_at, updated_at, started_at, commit_sha, bookmark, start_commit,
                   cancelled, cancelled_at, archived, archived_at
            FROM task_depths WHERE 1=1
            "#,
        );

        if let Some(ref parent_id) = filter.parent_id {
            sql.push_str(" AND parent_id = ?");
            params_vec.push(Box::new(parent_id.clone()));
        }

        if let Some(completed) = filter.completed {
            sql.push_str(" AND completed = ?");
            params_vec.push(Box::new(if completed { 1 } else { 0 }));
        }

        if let Some(depth) = filter.depth {
            sql.push_str(" AND depth = ?");
            params_vec.push(Box::new(depth));
        }

        // Archived filter: None or Some(false) -> hide archived, Some(true) -> only archived
        let show_archived = filter.archived.unwrap_or(false);
        sql.push_str(" AND archived = ?");
        params_vec.push(Box::new(if show_archived { 1 } else { 0 }));

        sql.push_str(" ORDER BY priority ASC, created_at ASC");
        sql
    } else {
        // Original simple query when not filtering by depth
        let mut sql = String::from("SELECT * FROM tasks WHERE 1=1");

        if let Some(ref parent_id) = filter.parent_id {
            sql.push_str(" AND parent_id = ?");
            params_vec.push(Box::new(parent_id.clone()));
        }

        if let Some(completed) = filter.completed {
            sql.push_str(" AND completed = ?");
            params_vec.push(Box::new(if completed { 1 } else { 0 }));
        }

        // Archived filter: None or Some(false) -> hide archived, Some(true) -> only archived
        let show_archived = filter.archived.unwrap_or(false);
        sql.push_str(" AND archived = ?");
        params_vec.push(Box::new(if show_archived { 1 } else { 0 }));

        sql.push_str(" ORDER BY priority ASC, created_at ASC");
        sql
    };

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut tasks: Vec<Task> = stmt
        .query_map(params_refs.as_slice(), row_to_task)?
        .collect::<rusqlite::Result<Vec<Task>>>()?;

    for task in &mut tasks {
        task.blocked_by = get_blockers(conn, &task.id)?;
        task.blocks = get_blocking(conn, &task.id)?;
    }

    if filter.ready {
        tasks.retain(|t| !t.completed && t.blocked_by.iter().all(|b| satisfies_blocker(conn, b)));
    }

    Ok(tasks)
}

/// Check if task is completed. Returns false if task not found or DB error.
/// This conservative default treats missing/errored tasks as "not completed" (blocking).
fn is_completed(conn: &Connection, id: &TaskId) -> bool {
    conn.query_row(
        "SELECT completed FROM tasks WHERE id = ?1",
        params![id],
        |row| row.get::<_, i32>(0),
    )
    .map(|c| c != 0)
    .unwrap_or(false) // Missing or errored task treated as incomplete (blocking)
}

pub fn update_task(conn: &Connection, id: &TaskId, input: &UpdateTaskInput) -> Result<Task> {
    let now_str = now().to_rfc3339();

    let mut updates = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now_str)];
    let mut param_idx = 2;

    updates.push("updated_at = ?1".to_string());

    if let Some(ref desc) = input.description {
        updates.push(format!("description = ?{}", param_idx));
        params_vec.push(Box::new(desc.clone()));
        param_idx += 1;
    }

    if let Some(ref ctx) = input.context {
        updates.push(format!("context = ?{}", param_idx));
        params_vec.push(Box::new(ctx.clone()));
        param_idx += 1;
    }

    if let Some(priority) = input.priority {
        updates.push(format!("priority = ?{}", param_idx));
        params_vec.push(Box::new(priority));
        param_idx += 1;
    }

    if let Some(ref parent_id) = input.parent_id {
        updates.push(format!("parent_id = ?{}", param_idx));
        params_vec.push(Box::new(parent_id.clone()));
        param_idx += 1;
    }

    params_vec.push(Box::new(id.clone()));

    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?{}",
        updates.join(", "),
        param_idx
    );

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())?;

    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn start_task(conn: &Connection, id: &TaskId) -> Result<Task> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET started_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now_str, id],
    )?;
    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn complete_task(
    conn: &Connection,
    id: &TaskId,
    result: Option<&str>,
    commit_sha: Option<&str>,
) -> Result<Task> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET completed = 1, completed_at = ?1, result = ?2, commit_sha = ?3, updated_at = ?1 WHERE id = ?4",
        params![now_str, result, commit_sha, id],
    )?;
    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn reopen_task(conn: &Connection, id: &TaskId) -> Result<Task> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![now_str, id],
    )?;
    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn cancel_task(conn: &Connection, id: &TaskId) -> Result<Task> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET cancelled = 1, cancelled_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now_str, id],
    )?;
    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn archive_task(conn: &Connection, id: &TaskId) -> Result<Task> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET archived = 1, archived_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now_str, id],
    )?;
    get_task(conn, id)?.ok_or_else(|| OsError::TaskNotFound(id.clone()))
}

pub fn delete_task(conn: &Connection, id: &TaskId) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn add_blocker(conn: &Connection, task_id: &TaskId, blocker_id: &TaskId) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO task_blockers (task_id, blocker_id) VALUES (?1, ?2)",
        params![task_id, blocker_id],
    )?;
    Ok(())
}

pub fn remove_blocker(conn: &Connection, task_id: &TaskId, blocker_id: &TaskId) -> Result<()> {
    conn.execute(
        "DELETE FROM task_blockers WHERE task_id = ?1 AND blocker_id = ?2",
        params![task_id, blocker_id],
    )?;
    Ok(())
}
pub fn task_exists(conn: &Connection, id: &TaskId) -> Result<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn get_task_depth(conn: &Connection, id: &TaskId) -> Result<i32> {
    let mut depth = 0;
    let mut current_id = Some(id.clone());

    while let Some(ref cid) = current_id {
        let parent: Option<TaskId> = conn
            .query_row(
                "SELECT parent_id FROM tasks WHERE id = ?1",
                params![cid],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        if parent.is_some() {
            depth += 1;
            current_id = parent;
        } else {
            break;
        }
    }

    Ok(depth)
}

pub fn has_pending_children(conn: &Connection, id: &TaskId) -> Result<bool> {
    // Cancelled children don't block parent completion (only incomplete, non-cancelled children do)
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE parent_id = ?1 AND completed = 0 AND cancelled = 0",
        params![id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn set_bookmark(conn: &Connection, id: &TaskId, bookmark: &str) -> Result<()> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET bookmark = ?1, updated_at = ?2 WHERE id = ?3",
        params![bookmark, now_str, id],
    )?;
    Ok(())
}

pub fn set_start_commit(conn: &Connection, id: &TaskId, start_commit: &str) -> Result<()> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET start_commit = ?1, updated_at = ?2 WHERE id = ?3",
        params![start_commit, now_str, id],
    )?;
    Ok(())
}

/// Clear bookmark field after VCS bookmark deletion
pub fn clear_bookmark(conn: &Connection, id: &TaskId) -> Result<()> {
    let now_str = now().to_rfc3339();
    conn.execute(
        "UPDATE tasks SET bookmark = NULL, updated_at = ?1 WHERE id = ?2",
        params![now_str, id],
    )?;
    Ok(())
}

/// Get bookmark for a task (lightweight query for delete cleanup)
pub fn get_bookmark(conn: &Connection, id: &TaskId) -> Result<Option<String>> {
    conn.query_row(
        "SELECT bookmark FROM tasks WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .optional()
    .map(|opt| opt.flatten())
    .map_err(OsError::from)
}

/// Get bookmarks for task and all descendants (for delete cleanup)
pub fn get_all_bookmarks(conn: &Connection, id: &TaskId) -> Result<Vec<String>> {
    let mut bookmarks = Vec::new();

    // Get the task's own bookmark
    if let Some(bookmark) = get_bookmark(conn, id)? {
        bookmarks.push(bookmark);
    }

    // Get all descendant bookmarks
    let descendants = get_all_descendants(conn, id)?;
    for desc in descendants {
        if let Some(bookmark) = desc.bookmark {
            bookmarks.push(bookmark);
        }
    }

    Ok(bookmarks)
}

pub fn get_children(conn: &Connection, parent_id: &TaskId) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare("SELECT * FROM tasks WHERE parent_id = ?1")?;
    let mut tasks: Vec<Task> = stmt
        .query_map(params![parent_id], row_to_task)?
        .collect::<rusqlite::Result<Vec<Task>>>()?;

    for task in &mut tasks {
        task.blocked_by = get_blockers(conn, &task.id)?;
        task.blocks = get_blocking(conn, &task.id)?;
    }

    Ok(tasks)
}

/// Get all descendants (children, grandchildren, etc.) recursively.
/// Used for cleanup operations like bookmark deletion on milestone complete.
pub fn get_all_descendants(conn: &Connection, root_id: &TaskId) -> Result<Vec<Task>> {
    let mut all_descendants = Vec::new();
    let mut stack = vec![root_id.clone()];

    while let Some(parent_id) = stack.pop() {
        let children = get_children(conn, &parent_id)?;
        for child in children {
            stack.push(child.id.clone());
            all_descendants.push(child);
        }
    }

    Ok(all_descendants)
}

/// List root tasks (milestones) ordered by priority ASC (p0 first), created_at ASC, id ASC
pub fn list_roots(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY priority ASC, created_at ASC, id ASC",
    )?;
    let mut tasks: Vec<Task> = stmt
        .query_map([], row_to_task)?
        .collect::<rusqlite::Result<Vec<Task>>>()?;

    for task in &mut tasks {
        task.blocked_by = get_blockers(conn, &task.id)?;
        task.blocks = get_blocking(conn, &task.id)?;
    }

    Ok(tasks)
}

/// Get children ordered by priority ASC (p0 first), created_at ASC, id ASC
pub fn get_children_ordered(conn: &Connection, parent_id: &TaskId) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks WHERE parent_id = ?1 ORDER BY priority ASC, created_at ASC, id ASC",
    )?;
    let mut tasks: Vec<Task> = stmt
        .query_map(params![parent_id], row_to_task)?
        .collect::<rusqlite::Result<Vec<Task>>>()?;

    for task in &mut tasks {
        task.blocked_by = get_blockers(conn, &task.id)?;
        task.blocks = get_blocking(conn, &task.id)?;
    }

    Ok(tasks)
}

/// Check if task is completed.
/// Returns false if task not found or DB error (conservative default).
/// Note: This function never errors - the Result wrapper is for API consistency
/// but will always return Ok. Missing/errored tasks are treated as incomplete.
pub fn is_task_completed(conn: &Connection, id: &TaskId) -> Result<bool> {
    Ok(is_completed(conn, id))
}

/// Check if task satisfies a blocker (completed AND not cancelled).
/// Cancelled tasks do NOT satisfy blockers - only completed tasks do.
/// Returns false if task not found or DB error (conservative default).
/// Note: This function never errors - the Result wrapper is for API consistency
/// but will always return Ok. Missing/errored tasks are treated as not satisfying.
pub fn is_task_satisfies_blocker(conn: &Connection, id: &TaskId) -> Result<bool> {
    Ok(satisfies_blocker(conn, id))
}

fn satisfies_blocker(conn: &Connection, id: &TaskId) -> bool {
    conn.query_row(
        "SELECT completed, cancelled FROM tasks WHERE id = ?1",
        params![id],
        |row| {
            let completed: i32 = row.get(0)?;
            let cancelled: i32 = row.get(1)?;
            Ok(completed != 0 && cancelled == 0)
        },
    )
    .unwrap_or(false) // Missing or errored task treated as not satisfying (blocking)
}
