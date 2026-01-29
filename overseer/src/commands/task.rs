use clap::{Args, Subcommand};
use rusqlite::Connection;

use crate::core::{get_task_with_context, TaskService, TaskWithContext, TaskWorkflowService};
use crate::error::Result;
use crate::id::TaskId;
use crate::types::{CreateTaskInput, ListTasksFilter, Task, UpdateTaskInput};
use crate::vcs::backend::VcsBackend;

/// Parse TaskId from CLI string (requires prefix)
fn parse_task_id(s: &str) -> std::result::Result<TaskId, String> {
    s.parse().map_err(|e| format!("{e}"))
}

#[derive(Subcommand)]
pub enum TaskCommand {
    Create(CreateArgs),
    Get {
        #[arg(value_parser = parse_task_id)]
        id: TaskId,
    },
    List(ListArgs),
    Update(UpdateArgs),
    Start {
        #[arg(value_parser = parse_task_id)]
        id: TaskId,
    },
    Complete(CompleteArgs),
    Reopen {
        #[arg(value_parser = parse_task_id)]
        id: TaskId,
    },
    Delete {
        #[arg(value_parser = parse_task_id)]
        id: TaskId,
    },
    Block(BlockArgs),
    Unblock(UnblockArgs),
    NextReady(NextReadyArgs),
    Tree(TreeArgs),
    Search(SearchArgs),
}

#[derive(Args)]
pub struct CreateArgs {
    #[arg(short = 'd', long)]
    pub description: String,

    #[arg(long)]
    pub context: Option<String>,

    #[arg(long, value_parser = parse_task_id)]
    pub parent: Option<TaskId>,

    #[arg(long, value_parser = clap::value_parser!(i32).range(1..=5))]
    pub priority: Option<i32>,

    #[arg(long = "blocked-by", value_delimiter = ',', value_parser = parse_task_id)]
    pub blocked_by: Vec<TaskId>,
}

#[derive(Args)]
pub struct ListArgs {
    #[arg(long, value_parser = parse_task_id)]
    pub parent: Option<TaskId>,

    #[arg(long)]
    pub ready: bool,

    #[arg(long)]
    pub completed: bool,
}

#[derive(Args)]
pub struct UpdateArgs {
    #[arg(value_parser = parse_task_id)]
    pub id: TaskId,

    #[arg(short = 'd', long)]
    pub description: Option<String>,

    #[arg(long)]
    pub context: Option<String>,

    #[arg(long, value_parser = clap::value_parser!(i32).range(1..=5))]
    pub priority: Option<i32>,

    #[arg(long, value_parser = parse_task_id)]
    pub parent: Option<TaskId>,
}

#[derive(Args)]
pub struct CompleteArgs {
    #[arg(value_parser = parse_task_id)]
    pub id: TaskId,

    #[arg(long)]
    pub result: Option<String>,
}

#[derive(Args)]
pub struct BlockArgs {
    #[arg(value_parser = parse_task_id)]
    pub id: TaskId,

    #[arg(long, value_parser = parse_task_id)]
    pub by: TaskId,
}

#[derive(Args)]
pub struct UnblockArgs {
    #[arg(value_parser = parse_task_id)]
    pub id: TaskId,

    #[arg(long, value_parser = parse_task_id)]
    pub by: TaskId,
}

#[derive(Args)]
pub struct NextReadyArgs {
    #[arg(long, value_parser = parse_task_id)]
    pub milestone: Option<TaskId>,
}

#[derive(Args)]
pub struct TreeArgs {
    #[arg(value_parser = parse_task_id)]
    pub id: Option<TaskId>,
}

#[derive(Args)]
pub struct SearchArgs {
    pub query: String,
}

pub enum TaskResult {
    One(Task),
    OneWithContext(TaskWithContext),
    MaybeOneWithContext(Option<TaskWithContext>),
    Many(Vec<Task>),
    Deleted,
    Tree(TaskTree),
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TaskTree {
    pub task: Task,
    pub children: Vec<TaskTree>,
}

/// Handle task command without VCS integration (for testing)
#[allow(dead_code)]
pub fn handle(conn: &Connection, cmd: TaskCommand) -> Result<TaskResult> {
    handle_with_vcs(conn, cmd, None)
}

pub fn handle_with_vcs(
    conn: &Connection,
    cmd: TaskCommand,
    vcs: Option<Box<dyn VcsBackend>>,
) -> Result<TaskResult> {
    let svc = TaskService::new(conn);
    let workflow = TaskWorkflowService::new(conn, vcs);

    match cmd {
        TaskCommand::Create(args) => {
            let input = CreateTaskInput {
                description: args.description,
                context: args.context,
                parent_id: args.parent,
                priority: args.priority,
                blocked_by: args.blocked_by,
            };
            Ok(TaskResult::One(svc.create(&input)?))
        }

        TaskCommand::Get { id } => {
            let task = svc.get(&id)?;
            let with_ctx = get_task_with_context(conn, task)?;
            Ok(TaskResult::OneWithContext(with_ctx))
        }

        TaskCommand::List(args) => {
            let filter = ListTasksFilter {
                parent_id: args.parent,
                ready: args.ready,
                completed: if args.completed { Some(true) } else { None },
            };
            Ok(TaskResult::Many(svc.list(&filter)?))
        }

        TaskCommand::Update(args) => {
            let input = UpdateTaskInput {
                description: args.description,
                context: args.context,
                priority: args.priority,
                parent_id: args.parent,
            };
            Ok(TaskResult::One(svc.update(&args.id, &input)?))
        }

        // VCS-integrated operations use workflow service
        // Start now follows blockers to find startable work
        TaskCommand::Start { id } => Ok(TaskResult::One(workflow.start_follow_blockers(&id)?)),

        TaskCommand::Complete(args) => Ok(TaskResult::One(
            workflow.complete(&args.id, args.result.as_deref())?,
        )),

        TaskCommand::Reopen { id } => Ok(TaskResult::One(svc.reopen(&id)?)),

        TaskCommand::Delete { id } => {
            // DB first - validates constraints (cascade deletes children)
            svc.delete(&id)?;
            // VCS cleanup after - best effort
            workflow.cleanup_bookmark(&id)?;
            Ok(TaskResult::Deleted)
        }

        TaskCommand::Block(args) => Ok(TaskResult::One(svc.add_blocker(&args.id, &args.by)?)),

        TaskCommand::Unblock(args) => Ok(TaskResult::One(svc.remove_blocker(&args.id, &args.by)?)),

        TaskCommand::NextReady(args) => {
            // Use new DFS-based next_ready
            let result = svc.next_ready(args.milestone.as_ref())?;
            match result {
                Some(id) => {
                    let task = svc.get(&id)?;
                    let with_ctx = get_task_with_context(conn, task)?;
                    Ok(TaskResult::MaybeOneWithContext(Some(with_ctx)))
                }
                None => Ok(TaskResult::MaybeOneWithContext(None)),
            }
        }

        TaskCommand::Tree(args) => {
            let tree = build_tree(conn, args.id.as_ref())?;
            Ok(TaskResult::Tree(tree))
        }

        TaskCommand::Search(args) => {
            let tasks = search_tasks(conn, &args.query)?;
            Ok(TaskResult::Many(tasks))
        }
    }
}

fn build_tree(conn: &Connection, root_id: Option<&TaskId>) -> Result<TaskTree> {
    let svc = TaskService::new(conn);

    let root_task = match root_id {
        Some(id) => svc.get(id)?,
        None => {
            // Find top-level tasks (depth = 0) by filtering all tasks
            let filter = ListTasksFilter {
                parent_id: None,
                ready: false,
                completed: None,
            };
            let all_tasks = svc.list(&filter)?;
            let mut milestones: Vec<Task> = all_tasks
                .into_iter()
                .filter(|t| t.depth == Some(0))
                .collect();

            milestones.sort_by(|a, b| {
                b.priority
                    .cmp(&a.priority)
                    .then_with(|| a.created_at.cmp(&b.created_at))
            });

            let first = milestones.into_iter().next();
            match first {
                Some(t) => t,
                None => {
                    return Err(crate::error::OsError::TaskNotFound(
                        TaskId::new(), // dummy ID for error message
                    ));
                }
            }
        }
    };

    build_tree_recursive(conn, root_task)
}

fn build_tree_recursive(conn: &Connection, task: Task) -> Result<TaskTree> {
    let svc = TaskService::new(conn);
    let filter = ListTasksFilter {
        parent_id: Some(task.id.clone()),
        ready: false,
        completed: None,
    };

    let children_tasks = svc.list(&filter)?;
    let mut children = Vec::new();

    for child in children_tasks {
        children.push(build_tree_recursive(conn, child)?);
    }

    // Sort children by priority desc, then created_at asc
    children.sort_by(|a, b| {
        b.task
            .priority
            .cmp(&a.task.priority)
            .then_with(|| a.task.created_at.cmp(&b.task.created_at))
    });

    Ok(TaskTree { task, children })
}

fn search_tasks(conn: &Connection, query: &str) -> Result<Vec<Task>> {
    let svc = TaskService::new(conn);

    // Simple substring search for now (FTS can be added later)
    let all_tasks = svc.list(&ListTasksFilter {
        parent_id: None,
        ready: false,
        completed: None,
    })?;

    let query_lower = query.to_lowercase();
    let matching = all_tasks
        .into_iter()
        .filter(|t| {
            t.description.to_lowercase().contains(&query_lower)
                || t.context.to_lowercase().contains(&query_lower)
                || t.result
                    .as_ref()
                    .is_some_and(|r| r.to_lowercase().contains(&query_lower))
        })
        .collect();

    Ok(matching)
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
    fn test_next_ready_returns_highest_priority_ready_task() {
        let conn = setup_db();
        let svc = TaskService::new(&conn);

        // Create milestone
        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        // Create tasks with different priorities
        let _low_priority = svc
            .create(&CreateTaskInput {
                description: "Low priority".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(1),
                blocked_by: vec![],
            })
            .unwrap();

        let high_priority = svc
            .create(&CreateTaskInput {
                description: "High priority".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        // Test next-ready command
        let result = handle(
            &conn,
            TaskCommand::NextReady(NextReadyArgs {
                milestone: Some(milestone.id.clone()),
            }),
        )
        .unwrap();

        if let TaskResult::MaybeOneWithContext(Some(task_ctx)) = result {
            assert_eq!(task_ctx.task.id, high_priority.id);
            assert_eq!(task_ctx.task.description, "High priority");
        } else {
            panic!("Expected MaybeOneWithContext(Some) result");
        }
    }

    #[test]
    fn test_next_ready_skips_blocked_tasks() {
        let conn = setup_db();
        let svc = TaskService::new(&conn);

        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let blocker = svc
            .create(&CreateTaskInput {
                description: "Blocker".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![],
            })
            .unwrap();

        let _blocked = svc
            .create(&CreateTaskInput {
                description: "Blocked".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(5),
                blocked_by: vec![blocker.id.clone()],
            })
            .unwrap();

        let _ready = svc
            .create(&CreateTaskInput {
                description: "Ready".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: Some(3),
                blocked_by: vec![],
            })
            .unwrap();

        // Test next-ready - should return highest priority unblocked task
        let result = handle(
            &conn,
            TaskCommand::NextReady(NextReadyArgs {
                milestone: Some(milestone.id.clone()),
            }),
        )
        .unwrap();

        if let TaskResult::MaybeOneWithContext(Some(task_ctx)) = result {
            // Should return "Blocker" (priority 5) not "Blocked" (priority 10, blocked)
            assert_eq!(task_ctx.task.id, blocker.id);
        } else {
            panic!("Expected MaybeOneWithContext(Some) result");
        }
    }

    #[test]
    fn test_tree_builds_hierarchy() {
        let conn = setup_db();
        let svc = TaskService::new(&conn);

        let milestone = svc
            .create(&CreateTaskInput {
                description: "Milestone".to_string(),
                context: None,
                parent_id: None,
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let task1 = svc
            .create(&CreateTaskInput {
                description: "Task 1".to_string(),
                context: None,
                parent_id: Some(milestone.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        let subtask1 = svc
            .create(&CreateTaskInput {
                description: "Subtask 1".to_string(),
                context: None,
                parent_id: Some(task1.id.clone()),
                priority: None,
                blocked_by: vec![],
            })
            .unwrap();

        // Build tree
        let result = handle(
            &conn,
            TaskCommand::Tree(TreeArgs {
                id: Some(milestone.id.clone()),
            }),
        )
        .unwrap();

        if let TaskResult::Tree(tree) = result {
            assert_eq!(tree.task.id, milestone.id);
            assert_eq!(tree.children.len(), 1);
            assert_eq!(tree.children[0].task.id, task1.id);
            assert_eq!(tree.children[0].children.len(), 1);
            assert_eq!(tree.children[0].children[0].task.id, subtask1.id);
        } else {
            panic!("Expected Tree result");
        }
    }

    #[test]
    fn test_search_finds_tasks_by_description() {
        let conn = setup_db();
        let svc = TaskService::new(&conn);

        svc.create(&CreateTaskInput {
            description: "Implement feature".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

        svc.create(&CreateTaskInput {
            description: "Fix bug".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

        svc.create(&CreateTaskInput {
            description: "Write tests".to_string(),
            context: None,
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

        // Search for "feature"
        let result = handle(
            &conn,
            TaskCommand::Search(SearchArgs {
                query: "feature".to_string(),
            }),
        )
        .unwrap();

        if let TaskResult::Many(tasks) = result {
            assert_eq!(tasks.len(), 1);
            assert_eq!(tasks[0].description, "Implement feature");
        } else {
            panic!("Expected Many result");
        }
    }

    #[test]
    fn test_search_finds_tasks_by_context() {
        let conn = setup_db();
        let svc = TaskService::new(&conn);

        svc.create(&CreateTaskInput {
            description: "Task 1".to_string(),
            context: Some("backend API".to_string()),
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

        svc.create(&CreateTaskInput {
            description: "Task 2".to_string(),
            context: Some("frontend UI".to_string()),
            parent_id: None,
            priority: None,
            blocked_by: vec![],
        })
        .unwrap();

        // Search for "backend"
        let result = handle(
            &conn,
            TaskCommand::Search(SearchArgs {
                query: "backend".to_string(),
            }),
        )
        .unwrap();

        if let TaskResult::Many(tasks) = result {
            assert_eq!(tasks.len(), 1);
            assert_eq!(tasks[0].description, "Task 1");
        } else {
            panic!("Expected Many result");
        }
    }
}
