use clap::{Args, Subcommand};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::task_repo;
use crate::error::Result;
use crate::id::TaskId;
use crate::vcs::{self, CommitResult, DiffEntry, LogEntry, VcsInfo, VcsStatus};

#[derive(Subcommand)]
pub enum VcsCommand {
    Detect,
    Status,
    Log(LogArgs),
    Diff(DiffArgs),
    Commit(CommitArgs),
    /// Clean up orphaned task branches/bookmarks
    #[command(
        about = "Clean up orphaned task branches",
        long_about = r#"
List and optionally delete orphaned task branches/bookmarks.

Orphaned branches are those matching 'task/*' pattern where:
  - The task no longer exists in the database, OR
  - The task is completed (and branch wasn't cleaned up)

Examples:
  os vcs cleanup          # List orphaned branches (dry-run)
  os vcs cleanup --delete # Delete orphaned branches
"#
    )]
    Cleanup(CleanupArgs),
}

#[derive(Args)]
pub struct LogArgs {
    #[arg(long, default_value = "10")]
    pub limit: usize,
}

#[derive(Args)]
pub struct DiffArgs {
    pub base: Option<String>,
}

#[derive(Args)]
pub struct CommitArgs {
    #[arg(short, long)]
    pub message: String,
}

#[derive(Args)]
pub struct CleanupArgs {
    /// Actually delete the orphaned branches (default is dry-run)
    #[arg(long)]
    pub delete: bool,
}

/// Result of cleanup command
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    /// Branches that are orphaned (task deleted or completed)
    pub orphaned: Vec<OrphanedBranch>,
    /// Branches that were deleted (only if --delete)
    pub deleted: Vec<String>,
    /// Branches that failed to delete
    pub failed: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanedBranch {
    pub name: String,
    pub reason: OrphanReason,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrphanReason {
    TaskNotFound,
    TaskCompleted,
}

pub enum VcsResult {
    Info(VcsInfo),
    Status(VcsStatus),
    Log(Vec<LogEntry>),
    Diff(Vec<DiffEntry>),
    Commit(CommitResult),
    Cleanup(CleanupResult),
}

/// Handle VCS commands that don't need DB
pub fn handle(cmd: VcsCommand) -> Result<VcsResult> {
    let cwd = std::env::current_dir()?;

    match cmd {
        VcsCommand::Detect => {
            let info = vcs::detect(&cwd);
            Ok(VcsResult::Info(info))
        }

        VcsCommand::Status => {
            let backend = vcs::get_backend(&cwd)?;
            let status = backend.status()?;
            Ok(VcsResult::Status(status))
        }

        VcsCommand::Log(args) => {
            let backend = vcs::get_backend(&cwd)?;
            let log = backend.log(args.limit)?;
            Ok(VcsResult::Log(log))
        }

        VcsCommand::Diff(args) => {
            let backend = vcs::get_backend(&cwd)?;
            let diff = backend.diff(args.base.as_deref())?;
            Ok(VcsResult::Diff(diff))
        }

        VcsCommand::Commit(args) => {
            let backend = vcs::get_backend(&cwd)?;
            let result = backend.commit(&args.message)?;
            Ok(VcsResult::Commit(result))
        }

        // Cleanup needs DB, handled separately in main.rs
        VcsCommand::Cleanup(_) => unreachable!("cleanup handled via handle_cleanup()"),
    }
}

/// Handle cleanup command (needs both VCS and DB)
pub fn handle_cleanup(conn: &Connection, args: CleanupArgs) -> Result<VcsResult> {
    let cwd = std::env::current_dir()?;
    let backend = vcs::get_backend(&cwd)?;

    // List all task/* branches/bookmarks
    let branches = backend.list_bookmarks(Some("task/"))?;

    let mut orphaned = Vec::new();
    let mut deleted = Vec::new();
    let mut failed = Vec::new();

    for branch in branches {
        // Extract task ID from branch name (task/{id})
        let task_id_str = branch.strip_prefix("task/").unwrap_or(&branch);

        // Try to parse as TaskId (validates prefix format)
        let task_id = match task_id_str.parse::<TaskId>() {
            Ok(id) => id,
            Err(_) => {
                // Not a valid task ID format, skip
                continue;
            }
        };

        // Check if task exists and its state
        match task_repo::get_task(conn, &task_id)? {
            None => {
                // Task doesn't exist - orphaned
                orphaned.push(OrphanedBranch {
                    name: branch.clone(),
                    reason: OrphanReason::TaskNotFound,
                });

                if args.delete {
                    if backend.delete_bookmark(&branch).is_err() {
                        failed.push(branch);
                    } else {
                        deleted.push(branch);
                    }
                }
            }
            Some(task) if task.completed => {
                // Task completed but branch still exists - orphaned
                orphaned.push(OrphanedBranch {
                    name: branch.clone(),
                    reason: OrphanReason::TaskCompleted,
                });

                if args.delete {
                    if backend.delete_bookmark(&branch).is_err() {
                        failed.push(branch);
                    } else {
                        deleted.push(branch);
                    }
                }
            }
            Some(_) => {
                // Task exists and not completed - branch is valid
            }
        }
    }

    Ok(VcsResult::Cleanup(CleanupResult {
        orphaned,
        deleted,
        failed,
    }))
}
