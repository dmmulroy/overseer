use std::io::{BufRead, BufReader, Error as IoError, ErrorKind};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use crate::error::Result;

const DEFAULT_PORT: u16 = 6969;

#[derive(clap::Args, Debug)]
pub struct UiArgs {
    /// Port to run the UI server on
    #[arg(long, short, default_value_t = DEFAULT_PORT)]
    pub port: u16,

    /// Don't open browser automatically
    #[arg(long)]
    pub no_open: bool,
}

pub enum UiResult {
    Started { port: u16, url: String },
}

/// Find the ui package directory relative to the CLI binary or workspace
fn find_ui_dir() -> Result<PathBuf> {
    // Try relative to current exe (installed scenario)
    if let Ok(exe) = std::env::current_exe() {
        // exe is in target/release or ~/.cargo/bin - look for ui relative to workspace
        if let Some(parent) = exe.parent() {
            // Check if we're in target/{debug,release}
            if parent.ends_with("debug") || parent.ends_with("release") {
                if let Some(target) = parent.parent() {
                    if let Some(workspace) = target.parent() {
                        let ui_dir = workspace.join("ui");
                        if ui_dir.exists() {
                            return Ok(ui_dir);
                        }
                    }
                }
            }
        }
    }

    // Try relative to cwd (dev scenario)
    let cwd = std::env::current_dir()?;

    // Check if we're in the workspace root
    let ui_dir = cwd.join("ui");
    if ui_dir.exists() {
        return Ok(ui_dir);
    }

    // Check if we're in a subdirectory of the workspace
    if let Some(parent) = cwd.parent() {
        let ui_dir = parent.join("ui");
        if ui_dir.exists() {
            return Ok(ui_dir);
        }
    }

    Err(IoError::new(ErrorKind::NotFound, "ui directory not found").into())
}

/// Spawn the UI dev server
fn spawn_server(ui_dir: &PathBuf, port: u16) -> Result<Child> {
    // Check if node_modules exists
    let node_modules = ui_dir.join("node_modules");
    if !node_modules.exists() {
        return Err(IoError::new(
            ErrorKind::NotFound,
            "ui/node_modules not found - run npm install",
        )
        .into());
    }

    // Pass cwd to UI server so CLI uses correct database
    // (UI runs from ui/ but should use db from where `os ui` was invoked)
    let cli_cwd = std::env::current_dir()?;

    // Pass path to this binary so UI uses the same CLI version
    let cli_path = std::env::current_exe()?;

    // Spawn npm run dev with PORT, OVERSEER_CLI_CWD, and OVERSEER_CLI_PATH env vars
    let child = Command::new("npm")
        .args(["run", "dev"])
        .env("PORT", port.to_string())
        .env("OVERSEER_CLI_CWD", &cli_cwd)
        .env("OVERSEER_CLI_PATH", &cli_path)
        .current_dir(ui_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    Ok(child)
}

/// Wait for server to be ready by watching stdout for the ready message
fn wait_for_ready(child: &mut Child, port: u16) -> Result<String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| IoError::other("Failed to capture stdout"))?;

    let reader = BufReader::new(stdout);
    let url = format!("http://localhost:{port}");

    for line in reader.lines() {
        let line = line?;
        // Print server output
        eprintln!("{line}");

        // Hono outputs "listening on http://localhost:PORT" when ready
        if line.contains("listening on") && line.contains(&port.to_string()) {
            return Ok(url);
        }
    }

    Err(IoError::other("Server exited before becoming ready").into())
}

pub fn handle(args: UiArgs) -> Result<UiResult> {
    let ui_dir = find_ui_dir()?;
    let port = args.port;

    eprintln!("Starting UI server on port {port}...");

    let mut child = spawn_server(&ui_dir, port)?;
    let url = wait_for_ready(&mut child, port)?;

    if !args.no_open {
        eprintln!("Opening browser...");
        if let Err(e) = open::that(&url) {
            eprintln!("Warning: Failed to open browser: {e}");
        }
    }

    eprintln!("UI running at {url}");
    eprintln!("Press Ctrl+C to stop");

    // Wait for child to exit (blocking - Ctrl+C will kill both)
    let _ = child.wait();

    Ok(UiResult::Started { port, url })
}
