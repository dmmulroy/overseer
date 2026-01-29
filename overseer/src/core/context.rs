use rusqlite::Connection;
use serde::Serialize;

use crate::db::learning_repo::Learning;
use crate::db::{learning_repo, task_repo};
use crate::error::Result;
use crate::id::TaskId;
use crate::types::Task;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressiveContext {
    pub own: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedLearnings {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub own: Vec<Learning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parent: Vec<Learning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub milestone: Vec<Learning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWithContext {
    #[serde(flatten)]
    pub task: Task,
    #[serde(rename = "context")]
    pub progressive_context: ProgressiveContext,
    #[serde(rename = "learnings")]
    pub inherited_learnings: InheritedLearnings,
}

pub fn get_ancestor_chain(conn: &Connection, task_id: &TaskId) -> Result<Vec<Task>> {
    let mut chain = Vec::new();
    let mut current_id = Some(task_id.clone());

    while let Some(ref id) = current_id {
        if let Some(task) = task_repo::get_task(conn, id)? {
            let parent_id = task.parent_id.clone();
            chain.push(task);
            current_id = parent_id;
        } else {
            break;
        }
    }

    Ok(chain)
}

pub fn build_progressive_context(conn: &Connection, task: &Task) -> Result<ProgressiveContext> {
    let chain = get_ancestor_chain(conn, &task.id)?;

    let own = task.context.clone();
    let mut parent_ctx = None;
    let mut milestone_ctx = None;

    for (i, ancestor) in chain.iter().enumerate() {
        if i == 0 {
            continue;
        }

        let depth = task_repo::get_task_depth(conn, &ancestor.id)?;

        if depth == 1 && parent_ctx.is_none() {
            parent_ctx = Some(ancestor.context.clone());
        } else if depth == 0 {
            milestone_ctx = Some(ancestor.context.clone());
        }
    }

    Ok(ProgressiveContext {
        own,
        parent: parent_ctx.filter(|s| !s.is_empty()),
        milestone: milestone_ctx.filter(|s| !s.is_empty()),
    })
}

pub fn build_inherited_learnings(conn: &Connection, task: &Task) -> Result<InheritedLearnings> {
    let chain = get_ancestor_chain(conn, &task.id)?;

    let own = learning_repo::list_learnings(conn, &task.id)?;
    let mut parent_learnings = Vec::new();
    let mut milestone_learnings = Vec::new();

    for (i, ancestor) in chain.iter().enumerate() {
        if i == 0 {
            continue;
        }

        let depth = task_repo::get_task_depth(conn, &ancestor.id)?;
        let learnings = learning_repo::list_learnings(conn, &ancestor.id)?;

        if depth == 1 {
            parent_learnings.extend(learnings);
        } else if depth == 0 {
            milestone_learnings.extend(learnings);
        }
    }

    Ok(InheritedLearnings {
        own,
        parent: parent_learnings,
        milestone: milestone_learnings,
    })
}

pub fn get_task_with_context(conn: &Connection, mut task: Task) -> Result<TaskWithContext> {
    let progressive_context = build_progressive_context(conn, &task)?;
    let inherited_learnings = build_inherited_learnings(conn, &task)?;

    // Clear task's own context_chain and learnings to avoid duplicate JSON keys
    // when TaskWithContext serializes (flatten + explicit fields would conflict)
    task.context_chain = None;
    task.learnings = None;

    Ok(TaskWithContext {
        task,
        progressive_context,
        inherited_learnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::learning_repo::add_learning;
    use crate::db::schema::init_schema;
    use crate::db::task_repo::create_task;
    use crate::types::CreateTaskInput;

    #[test]
    fn test_get_ancestor_chain_single_task() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let task = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let chain = get_ancestor_chain(&conn, &task.id).unwrap();
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].id, task.id);
    }

    #[test]
    fn test_get_ancestor_chain_three_levels() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                context: Some("parent context".to_string()),
                parent_id: Some(milestone.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();

        let child = create_task(
            &conn,
            &CreateTaskInput {
                description: "child".to_string(),
                context: Some("child context".to_string()),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();

        let chain = get_ancestor_chain(&conn, &child.id).unwrap();
        assert_eq!(chain.len(), 3);
        assert_eq!(chain[0].id, child.id);
        assert_eq!(chain[1].id, parent.id);
        assert_eq!(chain[2].id, milestone.id);
    }

    #[test]
    fn test_build_progressive_context_milestone() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let ctx = build_progressive_context(&conn, &milestone).unwrap();
        assert_eq!(ctx.own, "milestone context");
        assert!(ctx.parent.is_none());
        assert!(ctx.milestone.is_none());
    }

    #[test]
    fn test_build_progressive_context_parent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                context: Some("parent context".to_string()),
                parent_id: Some(milestone.id),
                ..Default::default()
            },
        )
        .unwrap();

        let ctx = build_progressive_context(&conn, &parent).unwrap();
        assert_eq!(ctx.own, "parent context");
        assert!(ctx.parent.is_none());
        assert_eq!(ctx.milestone, Some("milestone context".to_string()));
    }

    #[test]
    fn test_build_progressive_context_child() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                context: Some("parent context".to_string()),
                parent_id: Some(milestone.id),
                ..Default::default()
            },
        )
        .unwrap();

        let child = create_task(
            &conn,
            &CreateTaskInput {
                description: "child".to_string(),
                context: Some("child context".to_string()),
                parent_id: Some(parent.id),
                ..Default::default()
            },
        )
        .unwrap();

        let ctx = build_progressive_context(&conn, &child).unwrap();
        assert_eq!(ctx.own, "child context");
        assert_eq!(ctx.parent, Some("parent context".to_string()));
        assert_eq!(ctx.milestone, Some("milestone context".to_string()));
    }

    #[test]
    fn test_build_progressive_context_empty_contexts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                context: Some("".to_string()),
                parent_id: Some(milestone.id),
                ..Default::default()
            },
        )
        .unwrap();

        let child = create_task(
            &conn,
            &CreateTaskInput {
                description: "child".to_string(),
                context: Some("child context".to_string()),
                parent_id: Some(parent.id),
                ..Default::default()
            },
        )
        .unwrap();

        let ctx = build_progressive_context(&conn, &child).unwrap();
        assert_eq!(ctx.own, "child context");
        assert!(ctx.parent.is_none());
        assert!(ctx.milestone.is_none());
    }

    #[test]
    fn test_build_inherited_learnings_no_learnings() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let task = create_task(
            &conn,
            &CreateTaskInput {
                description: "task".to_string(),
                ..Default::default()
            },
        )
        .unwrap();

        let learnings = build_inherited_learnings(&conn, &task).unwrap();
        assert!(learnings.own.is_empty());
        assert!(learnings.parent.is_empty());
        assert!(learnings.milestone.is_empty());
    }

    #[test]
    fn test_build_inherited_learnings_own_only() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let task = create_task(
            &conn,
            &CreateTaskInput {
                description: "task".to_string(),
                ..Default::default()
            },
        )
        .unwrap();

        add_learning(&conn, &task.id, "own learning", None).unwrap();

        let learnings = build_inherited_learnings(&conn, &task).unwrap();
        assert_eq!(learnings.own.len(), 1);
        assert_eq!(learnings.own[0].content, "own learning");
        assert!(learnings.parent.is_empty());
        assert!(learnings.milestone.is_empty());
    }

    #[test]
    fn test_build_inherited_learnings_with_parent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        add_learning(&conn, &milestone.id, "milestone learning", None).unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                parent_id: Some(milestone.id),
                ..Default::default()
            },
        )
        .unwrap();
        add_learning(&conn, &parent.id, "parent learning", None).unwrap();

        let child = create_task(
            &conn,
            &CreateTaskInput {
                description: "child".to_string(),
                parent_id: Some(parent.id),
                ..Default::default()
            },
        )
        .unwrap();
        add_learning(&conn, &child.id, "child learning", None).unwrap();

        let learnings = build_inherited_learnings(&conn, &child).unwrap();
        assert_eq!(learnings.own.len(), 1);
        assert_eq!(learnings.own[0].content, "child learning");
        assert_eq!(learnings.parent.len(), 1);
        assert_eq!(learnings.parent[0].content, "parent learning");
        assert_eq!(learnings.milestone.len(), 1);
        assert_eq!(learnings.milestone[0].content, "milestone learning");
    }

    #[test]
    fn test_get_task_with_context() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let milestone = create_task(
            &conn,
            &CreateTaskInput {
                description: "milestone".to_string(),
                context: Some("milestone context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        add_learning(&conn, &milestone.id, "milestone learning", None).unwrap();

        let parent = create_task(
            &conn,
            &CreateTaskInput {
                description: "parent".to_string(),
                context: Some("parent context".to_string()),
                parent_id: Some(milestone.id),
                ..Default::default()
            },
        )
        .unwrap();

        let child = create_task(
            &conn,
            &CreateTaskInput {
                description: "child".to_string(),
                context: Some("child context".to_string()),
                parent_id: Some(parent.id),
                ..Default::default()
            },
        )
        .unwrap();

        let task_with_ctx = get_task_with_context(&conn, child.clone()).unwrap();

        assert_eq!(task_with_ctx.task.id, child.id);
        assert_eq!(task_with_ctx.progressive_context.own, "child context");
        assert_eq!(
            task_with_ctx.progressive_context.parent,
            Some("parent context".to_string())
        );
        assert_eq!(
            task_with_ctx.progressive_context.milestone,
            Some("milestone context".to_string())
        );
        assert_eq!(task_with_ctx.inherited_learnings.milestone.len(), 1);
    }
}
