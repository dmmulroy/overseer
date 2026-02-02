use std::io::IsTerminal;

use owo_colors::{OwoColorize, Style};
use serde::Deserialize;

use crate::commands::{learning::LearningCommand, task::TaskCommand, vcs::VcsCommand, DataCommand};
use crate::db;
use crate::id::TaskId;
use crate::types;
use crate::vcs::{
    backend::{ChangeType, FileStatusKind},
    DiffEntry, LogEntry, VcsInfo, VcsStatus, VcsType,
};
use crate::Command;

/// Task status for display classification
#[derive(Clone, Copy, PartialEq, Eq)]
enum TaskStatus {
    Completed,
    Blocked,
    Ready,
}

impl TaskStatus {
    /// Classify task status from completed and effectively_blocked fields
    fn classify(completed: bool, effectively_blocked: bool) -> Self {
        if completed {
            Self::Completed
        } else if effectively_blocked {
            Self::Blocked
        } else {
            Self::Ready
        }
    }
}

/// Minimal Task fields needed for tree display (avoids context roundtrip issues)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreeTask {
    id: TaskId,
    parent_id: Option<TaskId>,
    description: String,
    completed: bool,
    depth: Option<i32>,
    priority: i32,
    created_at: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    effectively_blocked: bool,
}

/// Tree structure for display
#[derive(Deserialize)]
struct TreeNode {
    task: TreeTask,
    children: Vec<TreeNode>,
}

/// Color policy: --no-color > NO_COLOR env > TERM=dumb > !isatty > default (color)
fn should_use_color_for(no_color_flag: bool, is_tty: bool) -> bool {
    if no_color_flag {
        return false;
    }
    if std::env::var("NO_COLOR").is_ok() {
        return false;
    }
    if std::env::var("TERM").ok().as_deref() == Some("dumb") {
        return false;
    }
    is_tty
}

fn should_use_color(no_color_flag: bool) -> bool {
    should_use_color_for(no_color_flag, std::io::stdout().is_terminal())
}

fn should_use_color_stderr(no_color_flag: bool) -> bool {
    should_use_color_for(no_color_flag, std::io::stderr().is_terminal())
}

/// Color scheme for output
struct Colors {
    task_id: Style,
    completed: Style,
    pending: Style,
    blocked: Style,
    priority_high: Style,
    priority_med: Style,
    milestone: Style,
    tree_line: Style,
    error: Style,
}

impl Colors {
    fn new(use_color: bool) -> Self {
        if use_color {
            Self {
                task_id: Style::new().cyan().dimmed(),
                completed: Style::new().green(),
                pending: Style::new().yellow(),
                blocked: Style::new().red(),
                priority_high: Style::new().red(),
                priority_med: Style::new().yellow(),
                milestone: Style::new().bold(),
                tree_line: Style::new().dimmed(),
                error: Style::new().red().bold(),
            }
        } else {
            // No-op styles when color disabled
            Self {
                task_id: Style::new(),
                completed: Style::new(),
                pending: Style::new(),
                blocked: Style::new(),
                priority_high: Style::new(),
                priority_med: Style::new(),
                milestone: Style::new(),
                tree_line: Style::new(),
                error: Style::new(),
            }
        }
    }
}

/// Handles human-readable CLI output.
pub struct Printer {
    colors: Colors,
}

impl Printer {
    /// Create printer for stdout (standard output)
    pub fn new(no_color_flag: bool) -> Self {
        let use_color = should_use_color(no_color_flag);
        Self {
            colors: Colors::new(use_color),
        }
    }

    /// Create printer for stderr (error output)
    pub fn new_for_stderr(no_color_flag: bool) -> Self {
        let use_color = should_use_color_stderr(no_color_flag);
        Self {
            colors: Colors::new(use_color),
        }
    }

    /// Print an error message to stderr with appropriate coloring
    pub fn print_error(&self, message: &str) {
        eprintln!("{}", message.style(self.colors.error));
    }

    fn fmt_id(&self, id: &impl std::fmt::Display) -> String {
        format!("{}", id.to_string().style(self.colors.task_id))
    }

    /// Get status symbol and style for a task status
    fn status_symbol_style(&self, status: TaskStatus) -> (&'static str, Style) {
        match status {
            TaskStatus::Completed => ("✓", self.colors.completed),
            TaskStatus::Blocked => ("⊘", self.colors.blocked),
            TaskStatus::Ready => ("○", self.colors.pending),
        }
    }

    pub fn print(&self, command: &Command, output: &str) {
        match command {
            Command::Init => println!("Initialized overseer database"),
            Command::Task(TaskCommand::Delete { .. }) => println!("Task deleted"),
            Command::Task(TaskCommand::NextReady(_)) => {
                self.print_next_ready(output);
            }
            Command::Task(TaskCommand::Tree(_)) => {
                self.print_task_tree(output);
            }
            Command::Task(TaskCommand::Progress(_)) => {
                self.print_task_progress(output);
            }
            Command::Task(TaskCommand::Search(_)) => {
                self.print_task_list_flat(output);
            }
            Command::Task(TaskCommand::List(args)) => {
                if args.flat {
                    self.print_task_list_flat(output);
                } else {
                    self.print_task_list_tree(output);
                }
            }
            Command::Task(TaskCommand::Get { .. }) => {
                println!("{}", output);
            }
            Command::Task(_) => {
                self.print_task(output);
            }
            Command::Learning(LearningCommand::Delete { .. }) => println!("Learning deleted"),
            Command::Learning(LearningCommand::List { .. }) => {
                self.print_learning_list(output);
            }
            Command::Learning(_) => {
                self.print_learning(output);
            }
            Command::Vcs(VcsCommand::Detect) => {
                self.print_vcs_detect(output);
            }
            Command::Vcs(VcsCommand::Status) => {
                self.print_vcs_status(output);
            }
            Command::Vcs(VcsCommand::Log(_)) => {
                self.print_vcs_log(output);
            }
            Command::Vcs(VcsCommand::Diff(_)) => {
                self.print_vcs_diff(output);
            }
            Command::Vcs(VcsCommand::Commit(_)) => {
                self.print_vcs_commit(output);
            }
            Command::Vcs(VcsCommand::Cleanup(_)) => {
                self.print_vcs_cleanup(output);
            }
            Command::Data(DataCommand::Export { .. }) => {
                self.print_data_export(output);
            }
            Command::Ui(_) => {
                // UI command prints interactively during execution, nothing extra needed
            }
            // PRECONDITION: Completions handled in main() before print() is called
            Command::Completions { .. } => unreachable!("completions handled before print()"),
        }
    }

    fn print_next_ready(&self, output: &str) {
        // Handle MaybeOneWithContext result (null or object)
        if output.trim() == "null" {
            println!("No ready tasks found");
        } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
            // Parse TaskWithContext format - task is nested under "task" key
            let task_obj = json.get("task").unwrap_or(&json);
            if let Some(task) = task_obj.as_object() {
                if let Some(id) = task.get("id").and_then(|v| v.as_str()) {
                    println!("Next ready task: {}", self.fmt_id(&id));
                }
                if let Some(desc) = task.get("description").and_then(|v| v.as_str()) {
                    println!("  Description: {}", desc);
                }
                if let Some(priority) = task.get("priority").and_then(|v| v.as_i64()) {
                    let priority_style = match priority {
                        1 | 2 => self.colors.priority_high,
                        3 => self.colors.priority_med,
                        _ => Style::new(),
                    };
                    println!("  Priority: {}", priority.style(priority_style));
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

    fn print_task_tree(&self, output: &str) {
        // Try single tree first, then array of trees
        if let Ok(tree) = serde_json::from_str::<TreeNode>(output) {
            // Count stats from tree
            let (completed, blocked, ready) = Self::count_tree_stats(&tree);
            let total = completed + blocked + ready;

            self.print_tree_node(&tree, "", true);
            self.print_progress_summary(total, completed, blocked, ready);
        } else if let Ok(trees) = serde_json::from_str::<Vec<TreeNode>>(output) {
            if trees.is_empty() {
                println!("No tasks found");
                return;
            }
            let mut total_completed = 0;
            let mut total_blocked = 0;
            let mut total_ready = 0;

            for (i, tree) in trees.iter().enumerate() {
                let (c, b, r) = Self::count_tree_stats(tree);
                total_completed += c;
                total_blocked += b;
                total_ready += r;
                self.print_tree_node(tree, "", true);
                if i < trees.len() - 1 {
                    println!(); // Blank line between milestones
                }
            }
            self.print_progress_summary(
                total_completed + total_blocked + total_ready,
                total_completed,
                total_blocked,
                total_ready,
            );
        } else {
            println!("{}", output);
        }
    }

    fn print_task_progress(&self, output: &str) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
            let total = json.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
            let completed = json.get("completed").and_then(|v| v.as_u64()).unwrap_or(0);
            let ready = json.get("ready").and_then(|v| v.as_u64()).unwrap_or(0);
            let blocked = json.get("blocked").and_then(|v| v.as_u64()).unwrap_or(0);

            println!(
                "{}/{} complete | {} blocked | {} ready",
                completed.style(self.colors.completed),
                total,
                blocked.style(self.colors.blocked),
                ready.style(self.colors.pending),
            );
        } else {
            println!("{}", output);
        }
    }

    /// Count completed/blocked/ready tasks in a tree recursively
    fn count_tree_stats(node: &TreeNode) -> (usize, usize, usize) {
        let status = TaskStatus::classify(node.task.completed, node.task.effectively_blocked);
        let (mut completed, mut blocked, mut ready) = match status {
            TaskStatus::Completed => (1, 0, 0),
            TaskStatus::Blocked => (0, 1, 0),
            TaskStatus::Ready => (0, 0, 1),
        };

        for child in &node.children {
            let (c, b, r) = Self::count_tree_stats(child);
            completed += c;
            blocked += b;
            ready += r;
        }

        (completed, blocked, ready)
    }

    fn print_tree_node(&self, tree: &TreeNode, prefix: &str, is_last: bool) {
        let status = TaskStatus::classify(tree.task.completed, tree.task.effectively_blocked);
        let (status_sym, status_style) = self.status_symbol_style(status);

        let connector = if is_last { "└─" } else { "├─" };
        let tree_prefix = format!("{}", prefix.style(self.colors.tree_line));
        let tree_connector = format!("{}", connector.style(self.colors.tree_line));

        // Milestones (depth 0) are bold
        let desc = if tree.task.depth == Some(0) {
            format!("{}", tree.task.description.style(self.colors.milestone))
        } else {
            tree.task.description.clone()
        };

        println!(
            "{}{} [{}] {} - {}",
            tree_prefix,
            tree_connector,
            status_sym.style(status_style),
            self.fmt_id(&tree.task.id),
            desc
        );

        let new_prefix = format!("{}{}  ", prefix, if is_last { " " } else { "│" });

        for (i, child) in tree.children.iter().enumerate() {
            let is_last_child = i == tree.children.len() - 1;
            self.print_tree_node(child, &new_prefix, is_last_child);
        }
    }

    fn print_task_list_flat(&self, output: &str) {
        if let Ok(tasks) = serde_json::from_str::<Vec<types::Task>>(output) {
            if tasks.is_empty() {
                println!("No tasks found");
            } else {
                let mut completed_count = 0;
                let mut blocked_count = 0;
                let mut ready_count = 0;

                for t in &tasks {
                    let status = TaskStatus::classify(t.completed, t.effectively_blocked);
                    match status {
                        TaskStatus::Completed => completed_count += 1,
                        TaskStatus::Blocked => blocked_count += 1,
                        TaskStatus::Ready => ready_count += 1,
                    }
                    let (status_sym, status_style) = self.status_symbol_style(status);
                    println!(
                        "[{}] {} - {}",
                        status_sym.style(status_style),
                        self.fmt_id(&t.id),
                        t.description
                    );
                }

                self.print_progress_summary(
                    tasks.len(),
                    completed_count,
                    blocked_count,
                    ready_count,
                );
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_task_list_tree(&self, output: &str) {
        if let Ok(tasks) = serde_json::from_str::<Vec<TreeTask>>(output) {
            if tasks.is_empty() {
                println!("No tasks found");
            } else {
                // Count stats before building forest (tasks consumed by build_forest)
                let mut completed_count = 0;
                let mut blocked_count = 0;
                let mut ready_count = 0;
                let total = tasks.len();

                for t in &tasks {
                    match TaskStatus::classify(t.completed, t.effectively_blocked) {
                        TaskStatus::Completed => completed_count += 1,
                        TaskStatus::Blocked => blocked_count += 1,
                        TaskStatus::Ready => ready_count += 1,
                    }
                }

                let forest = self.build_forest(tasks);
                for root in &forest {
                    self.print_forest_node(root, "", true);
                }

                self.print_progress_summary(total, completed_count, blocked_count, ready_count);
            }
        } else {
            println!("{}", output);
        }
    }

    /// Build a forest of trees from a flat task list.
    /// Tasks whose parent is not in the list become roots.
    fn build_forest(&self, tasks: Vec<TreeTask>) -> Vec<TreeNode> {
        use std::collections::{HashMap, HashSet};

        // Index tasks by ID
        let task_ids: HashSet<TaskId> = tasks.iter().map(|t| t.id.clone()).collect();
        let mut task_map: HashMap<TaskId, TreeTask> =
            tasks.into_iter().map(|t| (t.id.clone(), t)).collect();

        // Collect parent relationships
        let mut children_map: HashMap<Option<TaskId>, Vec<TaskId>> = HashMap::new();
        for (id, task) in &task_map {
            // If parent exists in result set, group under it; otherwise treat as root
            let parent_key = task.parent_id.clone().filter(|p| task_ids.contains(p));
            children_map.entry(parent_key).or_default().push(id.clone());
        }

        // Build trees recursively
        fn build_node(
            id: &TaskId,
            task_map: &mut HashMap<TaskId, TreeTask>,
            children_map: &HashMap<Option<TaskId>, Vec<TaskId>>,
        ) -> Option<TreeNode> {
            let task = task_map.remove(id)?;
            let child_ids = children_map
                .get(&Some(id.clone()))
                .cloned()
                .unwrap_or_default();
            let mut children: Vec<TreeNode> = child_ids
                .iter()
                .filter_map(|cid| build_node(cid, task_map, children_map))
                .collect();
            // Sort: incomplete first, then priority DESC, created_at ASC, id ASC (deterministic)
            children.sort_by(|a, b| {
                a.task
                    .completed
                    .cmp(&b.task.completed)
                    .then_with(|| b.task.priority.cmp(&a.task.priority))
                    .then_with(|| a.task.created_at.cmp(&b.task.created_at))
                    .then_with(|| a.task.id.cmp(&b.task.id))
            });
            Some(TreeNode { task, children })
        }

        // Get root IDs (tasks with no parent in result set)
        let root_ids = children_map.get(&None).cloned().unwrap_or_default();
        let mut roots: Vec<TreeNode> = root_ids
            .iter()
            .filter_map(|id| build_node(id, &mut task_map, &children_map))
            .collect();

        // Sort roots: incomplete first, depth ASC (milestones first), priority DESC, created_at ASC, id ASC
        roots.sort_by(|a, b| {
            a.task
                .completed
                .cmp(&b.task.completed)
                .then_with(|| a.task.depth.cmp(&b.task.depth))
                .then_with(|| b.task.priority.cmp(&a.task.priority))
                .then_with(|| a.task.created_at.cmp(&b.task.created_at))
                .then_with(|| a.task.id.cmp(&b.task.id))
        });

        roots
    }

    /// Print progress summary footer: "X/Y complete | Z blocked | W ready"
    fn print_progress_summary(&self, total: usize, completed: usize, blocked: usize, ready: usize) {
        println!();
        println!(
            "{}/{} complete | {} blocked | {} ready",
            completed.style(self.colors.completed),
            total,
            blocked.style(self.colors.blocked),
            ready.style(self.colors.pending),
        );
    }

    /// Print a forest root node (no connector prefix) and its children
    fn print_forest_node(&self, node: &TreeNode, prefix: &str, is_root: bool) {
        let status = TaskStatus::classify(node.task.completed, node.task.effectively_blocked);
        let (status_sym, status_style) = self.status_symbol_style(status);

        // Milestones (depth 0) are bold
        let desc = if node.task.depth == Some(0) {
            format!("{}", node.task.description.style(self.colors.milestone))
        } else {
            node.task.description.clone()
        };

        if is_root {
            // Root nodes: no connector prefix
            println!(
                "[{}] {} - {}",
                status_sym.style(status_style),
                self.fmt_id(&node.task.id),
                desc
            );
        } else {
            // Child nodes: use tree connectors (caller sets correct prefix)
            let tree_prefix = format!("{}", prefix.style(self.colors.tree_line));
            println!(
                "{}[{}] {} - {}",
                tree_prefix,
                status_sym.style(status_style),
                self.fmt_id(&node.task.id),
                desc
            );
        }

        // Children get tree connectors
        let child_count = node.children.len();
        for (i, child) in node.children.iter().enumerate() {
            let is_last_child = i == child_count - 1;
            let connector = if is_last_child { "└─ " } else { "├─ " };
            let child_prefix = if is_root {
                connector.to_string()
            } else {
                format!("{}{}", prefix, connector)
            };
            // Continuation prefix for grandchildren
            let continuation = if is_last_child { "   " } else { "│  " };
            let next_prefix = if is_root {
                continuation.to_string()
            } else {
                format!("{}{}", prefix, continuation)
            };
            self.print_forest_child(child, &child_prefix, &next_prefix);
        }
    }

    /// Print a child node with connector and recurse
    fn print_forest_child(&self, node: &TreeNode, line_prefix: &str, child_prefix: &str) {
        let status = TaskStatus::classify(node.task.completed, node.task.effectively_blocked);
        let (status_sym, status_style) = self.status_symbol_style(status);

        let desc = if node.task.depth == Some(0) {
            format!("{}", node.task.description.style(self.colors.milestone))
        } else {
            node.task.description.clone()
        };

        let styled_prefix = format!("{}", line_prefix.style(self.colors.tree_line));
        println!(
            "{}[{}] {} - {}",
            styled_prefix,
            status_sym.style(status_style),
            self.fmt_id(&node.task.id),
            desc
        );

        let child_count = node.children.len();
        for (i, child) in node.children.iter().enumerate() {
            let is_last = i == child_count - 1;
            let connector = if is_last { "└─ " } else { "├─ " };
            let continuation = if is_last { "   " } else { "│  " };
            let next_line_prefix = format!("{}{}", child_prefix, connector);
            let next_child_prefix = format!("{}{}", child_prefix, continuation);
            self.print_forest_child(child, &next_line_prefix, &next_child_prefix);
        }
    }

    fn print_task(&self, output: &str) {
        if let Ok(task) = serde_json::from_str::<types::Task>(output) {
            let status = TaskStatus::classify(task.completed, task.effectively_blocked);
            let (status_label, status_style) = match status {
                TaskStatus::Completed => ("completed", self.colors.completed),
                TaskStatus::Blocked => ("blocked", self.colors.blocked),
                TaskStatus::Ready => ("open", self.colors.pending),
            };

            let priority_style = match task.priority {
                1 | 2 => self.colors.priority_high,
                3 => self.colors.priority_med,
                _ => Style::new(),
            };

            println!(
                "Task: {} ({})",
                self.fmt_id(&task.id),
                status_label.style(status_style)
            );
            println!("  Description: {}", task.description);
            if !task.context.is_empty() {
                println!("  Context: {}", task.context);
            }
            if let Some(ref result) = task.result {
                println!("  Result: {}", result);
            }
            println!("  Priority: {}", task.priority.style(priority_style));
            if let Some(depth) = task.depth {
                println!("  Depth: {}", depth);
            }
            if !task.blocked_by.is_empty() {
                let blocked_ids: Vec<String> =
                    task.blocked_by.iter().map(|id| self.fmt_id(id)).collect();
                println!("  Blocked by: {}", blocked_ids.join(", "));
            }
            if !task.blocks.is_empty() {
                let block_ids: Vec<String> = task.blocks.iter().map(|id| self.fmt_id(id)).collect();
                println!("  Blocks: {}", block_ids.join(", "));
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_learning_list(&self, output: &str) {
        if let Ok(learnings) = serde_json::from_str::<Vec<db::Learning>>(output) {
            if learnings.is_empty() {
                println!("No learnings found");
            } else {
                for l in learnings {
                    println!("• {} - {}", self.fmt_id(&l.id), l.content);
                }
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_learning(&self, output: &str) {
        if let Ok(learning) = serde_json::from_str::<db::Learning>(output) {
            println!("Learning: {}", self.fmt_id(&learning.id));
            println!("  Content: {}", learning.content);
            println!("  Task: {}", self.fmt_id(&learning.task_id));
            if let Some(ref source) = learning.source_task_id {
                println!("  Source: {}", self.fmt_id(source));
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_detect(&self, output: &str) {
        if let Ok(info) = serde_json::from_str::<VcsInfo>(output) {
            match info.vcs_type {
                VcsType::Jj => println!("JJ repository at {}", info.root),
                VcsType::Git => println!("Git repository at {}", info.root),
                VcsType::None => println!("Not a repository"),
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_status(&self, output: &str) {
        if let Ok(status) = serde_json::from_str::<VcsStatus>(output) {
            if let Some(ref id) = status.working_copy_id {
                println!("Working copy: {}", self.fmt_id(&id));
            }
            if status.files.is_empty() {
                println!("No changes");
            } else {
                for f in &status.files {
                    let (symbol, style) = match f.status {
                        FileStatusKind::Modified => ('M', self.colors.pending),
                        FileStatusKind::Added => ('A', self.colors.completed),
                        FileStatusKind::Deleted => ('D', self.colors.blocked),
                        FileStatusKind::Renamed => ('R', self.colors.pending),
                        FileStatusKind::Untracked => ('?', self.colors.tree_line),
                        FileStatusKind::Conflict => ('C', self.colors.error),
                    };
                    println!("  {} {}", symbol.style(style), f.path);
                }
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_log(&self, output: &str) {
        if let Ok(entries) = serde_json::from_str::<Vec<LogEntry>>(output) {
            for entry in entries {
                println!("{} {} - {}", entry.id, entry.author, entry.description);
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_diff(&self, output: &str) {
        if let Ok(entries) = serde_json::from_str::<Vec<DiffEntry>>(output) {
            if entries.is_empty() {
                println!("No changes");
            } else {
                for entry in entries {
                    let (symbol, style) = match entry.change_type {
                        ChangeType::Added => ("+", self.colors.completed),
                        ChangeType::Deleted => ("-", self.colors.blocked),
                        ChangeType::Modified => ("~", self.colors.pending),
                        ChangeType::Renamed => ("→", self.colors.pending),
                    };
                    println!("{} {}", symbol.style(style), entry.path);
                }
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_commit(&self, output: &str) {
        if let Ok(result) = serde_json::from_str::<crate::vcs::CommitResult>(output) {
            println!("Committed: {} - {}", result.id, result.message);
        } else {
            println!("{}", output);
        }
    }

    fn print_vcs_cleanup(&self, output: &str) {
        use crate::commands::vcs::{CleanupResult, OrphanReason};

        if let Ok(result) = serde_json::from_str::<CleanupResult>(output) {
            if result.orphaned.is_empty() {
                println!("No orphaned branches found");
                return;
            }

            println!("Orphaned branches:");
            for branch in &result.orphaned {
                let reason = match branch.reason {
                    OrphanReason::TaskNotFound => "task deleted",
                    OrphanReason::TaskCompleted => "task completed",
                };
                println!("  {} ({})", branch.name.style(self.colors.pending), reason);
            }

            if !result.deleted.is_empty() {
                println!();
                println!(
                    "{} branches deleted",
                    result.deleted.len().style(self.colors.completed)
                );
            } else if !result.orphaned.is_empty() {
                println!();
                println!(
                    "Run with {} to delete orphaned branches",
                    "--delete".style(self.colors.pending)
                );
            }

            if !result.failed.is_empty() {
                println!();
                println!(
                    "{} branches failed to delete",
                    result.failed.len().style(self.colors.blocked)
                );
            }
        } else {
            println!("{}", output);
        }
    }

    fn print_data_export(&self, output: &str) {
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
}

impl Default for Printer {
    fn default() -> Self {
        Self::new(false)
    }
}
