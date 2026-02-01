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
    data, learning, task, ui, vcs as vcs_cmd, DataCommand, DataResult, LearningCommand,
    LearningResult, TaskCommand, TaskResult, UiArgs, VcsCommand,
};
use output::Printer;

#[derive(Parser)]
#[command(name = "os")]
#[command(about = "Overseer - Agent task management CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    #[arg(long, global = true)]
    json: bool,

    /// Disable colored output
    #[arg(long, global = true)]
    no_color: bool,

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

    /// Generate shell completions
    Completions {
        /// Shell to generate completions for
        shell: Shell,
    },

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
            tasks: args.tasks.clone(),
            subtasks: args.subtasks.clone(),
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
