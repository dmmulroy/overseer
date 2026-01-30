use std::path::PathBuf;

use clap::{Parser, Subcommand};

mod commands;
mod core;
mod db;
mod error;
mod id;
mod types;
mod vcs;

/// Format ID for display (show full ID)
fn fmt_id(id: &impl std::fmt::Display) -> String {
    id.to_string()
}

#[cfg(test)]
mod testutil;

use commands::{
    data, learning, task, ui, vcs as vcs_cmd, DataCommand, DataResult, LearningCommand,
    LearningResult, TaskCommand, TaskResult, UiArgs, VcsCommand,
};
use vcs::backend::{ChangeType, FileStatusKind};

#[derive(Parser)]
#[command(name = "os")]
#[command(about = "Overseer - Agent task management CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    #[arg(long, global = true)]
    json: bool,

    #[arg(long, global = true)]
    db: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    #[command(subcommand)]
    Task(TaskCommand),

    #[command(subcommand)]
    Learning(LearningCommand),

    #[command(subcommand)]
    Vcs(VcsCommand),

    #[command(subcommand)]
    Data(DataCommand),

    /// Launch the UI server
    Ui(UiArgs),

    Init,
}

fn default_db_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".overseer")
        .join("tasks.db")
}

fn main() {
    let cli = Cli::parse();
    let db_path = cli.db.unwrap_or_else(default_db_path);

    let result = run(&cli.command, &db_path);

    match result {
        Ok(output) => {
            if cli.json {
                println!("{}", output);
            } else {
                print_human(&cli.command, &output);
            }
        }
        Err(e) => {
            if cli.json {
                let err = serde_json::json!({ "error": e.to_string() });
                eprintln!("{}", err);
            } else {
                eprintln!("Error: {}", e);
            }
            std::process::exit(1);
        }
    }
}

fn run(command: &Command, db_path: &PathBuf) -> error::Result<String> {
    match command {
        Command::Init => {
            db::open_db(db_path)?;
            Ok(serde_json::json!({ "initialized": true, "path": db_path }).to_string())
        }
        Command::Task(cmd) => {
            let conn = db::open_db(db_path)?;
            let cloned_cmd = clone_task_cmd(cmd);
            
            // Only workflow commands (start/complete/delete) need VCS
            let result = match &cloned_cmd {
                TaskCommand::Start { .. } | TaskCommand::Complete(_) | TaskCommand::Delete { .. } => {
                    let vcs = vcs::get_backend(&std::env::current_dir().unwrap_or_default())?;
                    task::handle_workflow(&conn, cloned_cmd, vcs)?
                }
                _ => task::handle(&conn, cloned_cmd)?,
            };
            
            match result {
                TaskResult::One(t) => Ok(serde_json::to_string_pretty(&t)?),
                TaskResult::OneWithContext(t) => Ok(serde_json::to_string_pretty(&t)?),
                TaskResult::MaybeOneWithContext(opt) => Ok(serde_json::to_string_pretty(&opt)?),
                TaskResult::Many(ts) => Ok(serde_json::to_string_pretty(&ts)?),
                TaskResult::Deleted => Ok(serde_json::json!({ "deleted": true }).to_string()),
                TaskResult::Tree(tree) => Ok(serde_json::to_string_pretty(&tree)?),
            }
        }
        Command::Learning(cmd) => {
            let conn = db::open_db(db_path)?;
            match learning::handle(&conn, clone_learning_cmd(cmd))? {
                LearningResult::One(l) => Ok(serde_json::to_string_pretty(&l)?),
                LearningResult::Many(ls) => Ok(serde_json::to_string_pretty(&ls)?),
                LearningResult::Deleted => Ok(serde_json::json!({ "deleted": true }).to_string()),
            }
        }
        Command::Vcs(cmd) => match vcs_cmd::handle(clone_vcs_cmd(cmd))? {
            vcs_cmd::VcsResult::Info(info) => Ok(serde_json::to_string_pretty(&info)?),
            vcs_cmd::VcsResult::Status(status) => Ok(serde_json::to_string_pretty(&status)?),
            vcs_cmd::VcsResult::Log(log) => Ok(serde_json::to_string_pretty(&log)?),
            vcs_cmd::VcsResult::Diff(diff) => Ok(serde_json::to_string_pretty(&diff)?),
            vcs_cmd::VcsResult::Commit(result) => Ok(serde_json::to_string_pretty(&result)?),
        },
        Command::Data(cmd) => {
            let conn = db::open_db(db_path)?;
            match data::handle(&conn, clone_data_cmd(cmd))? {
                DataResult::Exported {
                    path,
                    tasks,
                    learnings,
                } => Ok(serde_json::to_string_pretty(&serde_json::json!({
                    "exported": true,
                    "path": path,
                    "tasks": tasks,
                    "learnings": learnings
                }))?),
            }
        }
        Command::Ui(args) => {
            // UI command handles its own output (interactive)
            match ui::handle(clone_ui_args(args))? {
                ui::UiResult::Started { port, url } => Ok(
                    serde_json::json!({ "started": true, "port": port, "url": url }).to_string(),
                ),
            }
        }
    }
}

fn clone_task_cmd(cmd: &TaskCommand) -> TaskCommand {
    match cmd {
        TaskCommand::Create(args) => TaskCommand::Create(task::CreateArgs {
            description: args.description.clone(),
            context: args.context.clone(),
            parent: args.parent.clone(),
            priority: args.priority,
            blocked_by: args.blocked_by.clone(),
        }),
        TaskCommand::Get { id } => TaskCommand::Get { id: id.clone() },
        TaskCommand::List(args) => TaskCommand::List(task::ListArgs {
            parent: args.parent.clone(),
            ready: args.ready,
            completed: args.completed,
        }),
        TaskCommand::Update(args) => TaskCommand::Update(task::UpdateArgs {
            id: args.id.clone(),
            description: args.description.clone(),
            context: args.context.clone(),
            priority: args.priority,
            parent: args.parent.clone(),
        }),
        TaskCommand::Start { id } => TaskCommand::Start { id: id.clone() },
        TaskCommand::Complete(args) => TaskCommand::Complete(task::CompleteArgs {
            id: args.id.clone(),
            result: args.result.clone(),
            learnings: args.learnings.clone(),
        }),
        TaskCommand::Reopen { id } => TaskCommand::Reopen { id: id.clone() },
        TaskCommand::Delete { id } => TaskCommand::Delete { id: id.clone() },
        TaskCommand::Block(args) => TaskCommand::Block(task::BlockArgs {
            id: args.id.clone(),
            by: args.by.clone(),
        }),
        TaskCommand::Unblock(args) => TaskCommand::Unblock(task::UnblockArgs {
            id: args.id.clone(),
            by: args.by.clone(),
        }),
        TaskCommand::NextReady(args) => TaskCommand::NextReady(task::NextReadyArgs {
            milestone: args.milestone.clone(),
        }),
        TaskCommand::Tree(args) => TaskCommand::Tree(task::TreeArgs {
            id: args.id.clone(),
        }),
        TaskCommand::Search(args) => TaskCommand::Search(task::SearchArgs {
            query: args.query.clone(),
        }),
    }
}

fn clone_learning_cmd(cmd: &LearningCommand) -> LearningCommand {
    match cmd {
        LearningCommand::Add(args) => LearningCommand::Add(learning::AddArgs {
            task_id: args.task_id.clone(),
            content: args.content.clone(),
            source: args.source.clone(),
        }),
        LearningCommand::List { task_id } => LearningCommand::List {
            task_id: task_id.clone(),
        },
        LearningCommand::Delete { id } => LearningCommand::Delete { id: id.clone() },
    }
}

fn clone_vcs_cmd(cmd: &VcsCommand) -> VcsCommand {
    match cmd {
        VcsCommand::Detect => VcsCommand::Detect,
        VcsCommand::Status => VcsCommand::Status,
        VcsCommand::Log(args) => VcsCommand::Log(vcs_cmd::LogArgs { limit: args.limit }),
        VcsCommand::Diff(args) => VcsCommand::Diff(vcs_cmd::DiffArgs {
            base: args.base.clone(),
        }),
        VcsCommand::Commit(args) => VcsCommand::Commit(vcs_cmd::CommitArgs {
            message: args.message.clone(),
        }),
    }
}

fn clone_data_cmd(cmd: &DataCommand) -> DataCommand {
    match cmd {
        DataCommand::Export { output } => DataCommand::Export {
            output: output.clone(),
        },
    }
}

fn clone_ui_args(args: &UiArgs) -> UiArgs {
    UiArgs {
        port: args.port,
        no_open: args.no_open,
    }
}

fn print_human(command: &Command, output: &str) {
    match command {
        Command::Init => println!("Initialized overseer database"),
        Command::Task(TaskCommand::Delete { .. }) => println!("Task deleted"),
        Command::Task(TaskCommand::NextReady(_)) => {
            // Handle MaybeOneWithContext result (null or object)
            if output.trim() == "null" {
                println!("No ready tasks found");
            } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
                // Parse TaskWithContext format - task is nested under "task" key
                let task_obj = json.get("task").unwrap_or(&json);
                if let Some(task) = task_obj.as_object() {
                    if let Some(id) = task.get("id").and_then(|v| v.as_str()) {
                        println!("Next ready task: {}", id);
                    }
                    if let Some(desc) = task.get("description").and_then(|v| v.as_str()) {
                        println!("  Description: {}", desc);
                    }
                    if let Some(priority) = task.get("priority").and_then(|v| v.as_i64()) {
                        println!("  Priority: {}", priority);
                    }
                    if let Some(depth) = task.get("depth").and_then(|v| v.as_i64()) {
                        println!("  Depth: {}", depth);
                    }
                } else {
                    println!("{}", output);
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Task(TaskCommand::Tree(_)) => {
            if let Ok(tree) = serde_json::from_str::<task::TaskTree>(output) {
                print_tree(&tree, "", true);
            } else {
                println!("{}", output);
            }
        }
        Command::Task(TaskCommand::Search(_)) => {
            if let Ok(tasks) = serde_json::from_str::<Vec<types::Task>>(output) {
                if tasks.is_empty() {
                    println!("No tasks found");
                } else {
                    for t in tasks {
                        let status = if t.completed { "✓" } else { " " };
                        println!("[{}] {} - {}", status, fmt_id(&t.id), t.description);
                    }
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Task(TaskCommand::List(_)) => {
            if let Ok(tasks) = serde_json::from_str::<Vec<types::Task>>(output) {
                if tasks.is_empty() {
                    println!("No tasks found");
                } else {
                    for t in tasks {
                        let status = if t.completed { "✓" } else { " " };
                        println!("[{}] {} - {}", status, fmt_id(&t.id), t.description);
                    }
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Task(TaskCommand::Get { .. }) => {
            println!("{}", output);
        }
        Command::Task(_) => {
            if let Ok(task) = serde_json::from_str::<types::Task>(output) {
                let status = if task.completed { "completed" } else { "open" };
                println!("Task: {} ({})", task.id, status);
                println!("  Description: {}", task.description);
                if !task.context.is_empty() {
                    println!("  Context: {}", task.context);
                }
                if let Some(ref result) = task.result {
                    println!("  Result: {}", result);
                }
                println!("  Priority: {}", task.priority);
                if let Some(depth) = task.depth {
                    println!("  Depth: {}", depth);
                }
                if !task.blocked_by.is_empty() {
                    let blocked_ids: Vec<String> =
                        task.blocked_by.iter().map(|id| fmt_id(id)).collect();
                    println!("  Blocked by: {}", blocked_ids.join(", "));
                }
                if !task.blocks.is_empty() {
                    let block_ids: Vec<String> = task.blocks.iter().map(|id| fmt_id(id)).collect();
                    println!("  Blocks: {}", block_ids.join(", "));
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Learning(LearningCommand::Delete { .. }) => println!("Learning deleted"),
        Command::Learning(LearningCommand::List { .. }) => {
            if let Ok(learnings) = serde_json::from_str::<Vec<db::Learning>>(output) {
                if learnings.is_empty() {
                    println!("No learnings found");
                } else {
                    for l in learnings {
                        println!("• {} - {}", fmt_id(&l.id), l.content);
                    }
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Learning(_) => {
            if let Ok(learning) = serde_json::from_str::<db::Learning>(output) {
                println!("Learning: {}", learning.id);
                println!("  Content: {}", learning.content);
                println!("  Task: {}", learning.task_id);
                if let Some(ref source) = learning.source_task_id {
                    println!("  Source: {}", source);
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Vcs(VcsCommand::Detect) => {
            if let Ok(info) = serde_json::from_str::<vcs::VcsInfo>(output) {
                match info.vcs_type {
                    vcs::VcsType::Jj => println!("JJ repository at {}", info.root),
                    vcs::VcsType::Git => println!("Git repository at {}", info.root),
                    vcs::VcsType::None => println!("Not a repository"),
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Vcs(VcsCommand::Status) => {
            if let Ok(status) = serde_json::from_str::<vcs::VcsStatus>(output) {
                if let Some(ref id) = status.working_copy_id {
                    println!("Working copy: {}", id);
                }
                if status.files.is_empty() {
                    println!("No changes");
                } else {
                    for f in &status.files {
                        let symbol = match f.status {
                            FileStatusKind::Modified => 'M',
                            FileStatusKind::Added => 'A',
                            FileStatusKind::Deleted => 'D',
                            FileStatusKind::Renamed => 'R',
                            FileStatusKind::Untracked => '?',
                            FileStatusKind::Conflict => 'C',
                        };
                        println!("  {} {}", symbol, f.path);
                    }
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Vcs(VcsCommand::Log(_)) => {
            if let Ok(entries) = serde_json::from_str::<Vec<vcs::LogEntry>>(output) {
                for entry in entries {
                    println!("{} {} - {}", entry.id, entry.author, entry.description);
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Vcs(VcsCommand::Diff(_)) => {
            if let Ok(entries) = serde_json::from_str::<Vec<vcs::DiffEntry>>(output) {
                if entries.is_empty() {
                    println!("No changes");
                } else {
                    for entry in entries {
                        let symbol = match entry.change_type {
                            ChangeType::Added => "+",
                            ChangeType::Deleted => "-",
                            ChangeType::Modified => "~",
                            ChangeType::Renamed => "→",
                        };
                        println!("{} {}", symbol, entry.path);
                    }
                }
            } else {
                println!("{}", output);
            }
        }
        Command::Vcs(VcsCommand::Commit(_)) => {
            if let Ok(result) = serde_json::from_str::<vcs::CommitResult>(output) {
                println!("Committed: {} - {}", result.id, result.message);
            } else {
                println!("{}", output);
            }
        }
        Command::Data(DataCommand::Export { .. }) => {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
                if let (Some(path), Some(tasks), Some(learnings)) = (
                    json.get("path").and_then(|v| v.as_str()),
                    json.get("tasks").and_then(|v| v.as_u64()),
                    json.get("learnings").and_then(|v| v.as_u64()),
                ) {
                    println!(
                        "Exported {} tasks and {} learnings to {}",
                        tasks, learnings, path
                    );
                } else {
                    println!("{}", output);
                }
            } else {
                println!("{}", output);
            }
        }

        Command::Ui(_) => {
            // UI command prints interactively during execution, nothing extra needed
        }
    }
}

fn print_tree(tree: &task::TaskTree, prefix: &str, is_last: bool) {
    let status = if tree.task.completed { "✓" } else { " " };
    let connector = if is_last { "└─" } else { "├─" };

    println!(
        "{}{} [{}] {} - {}",
        prefix,
        connector,
        status,
        fmt_id(&tree.task.id),
        tree.task.description
    );

    let new_prefix = format!("{}{}  ", prefix, if is_last { " " } else { "│" });

    for (i, child) in tree.children.iter().enumerate() {
        let is_last_child = i == tree.children.len() - 1;
        print_tree(child, &new_prefix, is_last_child);
    }
}
