use std::io;
use std::path::PathBuf;

use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::{generate, Shell};

mod commands;
mod core;
mod db;
mod error;
mod id;
mod output;
mod types;
mod vcs;

#[cfg(test)]
mod testutil;

use commands::{
    data, learning, task, vcs as vcs_cmd, DataCommand, DataResult, LearningCommand, LearningResult,
    TaskCommand, TaskResult, VcsCommand,
};
use output::Printer;

#[derive(Parser)]
#[command(name = "os")]
#[command(version)]
#[command(
    about = "Overseer - Agent task management CLI",
    long_about = r#"
Overseer (os) - Task orchestration for AI coding agents.

Features:
  • 3-level task hierarchy: milestone → task → subtask
  • VCS integration (jj-first, git fallback)
  • Dependency management with cycle detection
  • Learning capture and inheritance

Environment:
  OVERSEER_DB_PATH  Override database location
  NO_COLOR          Disable colored output
"#
)]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Output in JSON format (for programmatic use)
    #[arg(long, global = true)]
    json: bool,

    /// Disable colored output
    #[arg(long, global = true)]
    no_color: bool,

    /// Override database path (default: VCS_ROOT/.overseer/tasks.db)
    #[arg(long, global = true)]
    db: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    /// Task management (CRUD, workflow, queries)
    #[command(subcommand)]
    Task(TaskCommand),

    /// Learning management
    #[command(subcommand)]
    Learning(LearningCommand),

    /// VCS operations (detect, status, log, diff, commit)
    #[command(subcommand)]
    Vcs(VcsCommand),

    /// Data import/export
    #[command(subcommand)]
    Data(DataCommand),

    /// Generate shell completions
    #[command(
        about = "Generate shell completions",
        long_about = r#"
Generate shell completions for os CLI.

Examples:
  os completions bash > ~/.local/share/bash-completion/completions/os
  os completions zsh > ~/.zfunc/_os
  os completions fish > ~/.config/fish/completions/os.fish
  os completions powershell > os.ps1
"#
    )]
    Completions {
        /// Shell to generate completions for (bash, zsh, fish, powershell, elvish)
        shell: Shell,
    },

    /// Initialize database in current directory
    #[command(
        about = "Initialize database",
        long_about = r#"
Initialize the Overseer database.

The database is created at:
  1. OVERSEER_DB_PATH (if set)
  2. VCS_ROOT/.overseer/tasks.db (if in jj/git repo)
  3. CWD/.overseer/tasks.db (fallback)

Usually runs automatically on first command.
"#
    )]
    Init,
}

/// Determine the default database path, anchored to the VCS root if found.
///
/// Resolution order:
/// 1. OVERSEER_DB_PATH env var (if set)
/// 2. VCS root (.jj or .git) -> .overseer/tasks.db
/// 3. Fall back to current working directory -> .overseer/tasks.db
fn default_db_path() -> PathBuf {
    // Check env override first
    if let Ok(path) = std::env::var("OVERSEER_DB_PATH") {
        return PathBuf::from(path);
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // Use VCS root if available (same detection as VCS module)
    let (_, vcs_root) = vcs::detect_vcs_type(&cwd);
    let base = vcs_root.unwrap_or(cwd);

    base.join(".overseer").join("tasks.db")
}

fn main() {
    let cli = Cli::parse();

    // PRECONDITION: Completions bypass normal output flow - raw shell script to stdout
    if let Command::Completions { shell } = &cli.command {
        generate(*shell, &mut Cli::command(), "os", &mut io::stdout());
        return;
    }

    let db_path = cli.db.unwrap_or_else(default_db_path);

    let result = run(&cli.command, &db_path);

    match result {
        Ok(output) => {
            if cli.json {
                println!("{}", output);
            } else {
                let printer = Printer::new(cli.no_color);
                printer.print(&cli.command, &output);
            }
        }
        Err(e) => {
            if cli.json {
                let err = serde_json::json!({ "error": e.to_string() });
                eprintln!("{}", err);
            } else {
                let printer = Printer::new_for_stderr(cli.no_color);
                printer.print_error(&format!("Error: {}", e));
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

            // Only workflow commands (start/complete) require VCS
            // Delete is best-effort VCS cleanup (works without VCS)
            let result = match &cloned_cmd {
                TaskCommand::Start { .. } | TaskCommand::Complete(_) => {
                    let vcs = vcs::get_backend(&std::env::current_dir().unwrap_or_default())?;
                    task::handle_workflow(&conn, cloned_cmd, vcs)?
                }
                TaskCommand::Delete { .. } => {
                    // VCS optional for delete - best effort cleanup
                    let vcs = vcs::get_backend(&std::env::current_dir().unwrap_or_default()).ok();
                    task::handle_delete(&conn, cloned_cmd, vcs)?
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
                TaskResult::Trees(trees) => Ok(serde_json::to_string_pretty(&trees)?),
                TaskResult::Progress(progress) => Ok(serde_json::to_string_pretty(&progress)?),
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
        Command::Vcs(cmd) => {
            // Cleanup needs DB, other commands don't
            let result = match &cmd {
                VcsCommand::Cleanup(args) => {
                    let conn = db::open_db(db_path)?;
                    vcs_cmd::handle_cleanup(&conn, clone_cleanup_args(args))?
                }
                _ => vcs_cmd::handle(clone_vcs_cmd(cmd))?,
            };

            match result {
                vcs_cmd::VcsResult::Info(info) => Ok(serde_json::to_string_pretty(&info)?),
                vcs_cmd::VcsResult::Status(status) => Ok(serde_json::to_string_pretty(&status)?),
                vcs_cmd::VcsResult::Log(log) => Ok(serde_json::to_string_pretty(&log)?),
                vcs_cmd::VcsResult::Diff(diff) => Ok(serde_json::to_string_pretty(&diff)?),
                vcs_cmd::VcsResult::Commit(result) => Ok(serde_json::to_string_pretty(&result)?),
                vcs_cmd::VcsResult::Cleanup(result) => Ok(serde_json::to_string_pretty(&result)?),
            }
        }
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
        // PRECONDITION: Completions handled in main() before run() is called
        Command::Completions { .. } => unreachable!("completions handled before run()"),
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
            milestones: args.milestones,
            tasks: args.tasks,
            subtasks: args.subtasks,
            flat: args.flat,
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
        TaskCommand::Progress(args) => TaskCommand::Progress(task::ProgressArgs {
            id: args.id.clone(),
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
        // Cleanup handled separately via handle_cleanup()
        VcsCommand::Cleanup(_) => unreachable!("cleanup handled separately"),
    }
}

fn clone_cleanup_args(args: &vcs_cmd::CleanupArgs) -> vcs_cmd::CleanupArgs {
    vcs_cmd::CleanupArgs {
        delete: args.delete,
    }
}

fn clone_data_cmd(cmd: &DataCommand) -> DataCommand {
    match cmd {
        DataCommand::Export { output } => DataCommand::Export {
            output: output.clone(),
        },
    }
}
