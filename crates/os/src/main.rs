use clap::{Parser, Subcommand};
use os_events::bus::EventBus;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "os")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve,
    Mcp,
    Openapi,
    Completions { shell: String },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve => {
            os_serve::openapi::ensure_initialized();
            let db_path = std::env::var("OVERSEER_DB_PATH")
                .unwrap_or_else(|_| ".overseer/tasks.db".to_string());
            if let Some(parent) = Path::new(&db_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let port = std::env::var("OVERSEER_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(4820);
            let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
            let event_bus = EventBus::new(1024);
            let relay_state = Arc::new(os_serve::relay::RelayState::new());
            let state = os_serve::AppState {
                db_path: db_path.clone(),
                event_bus,
                idempotency: os_serve::IdempotencyLocks::new(),
                relay: relay_state,
            };
            let _ = cleanup_idempotency(&db_path);
            let poll_state = state.clone();
            tokio::spawn(async move { os_serve::gate_polling::run(poll_state).await });
            if let Err(err) = os_serve::serve(state, addr).await {
                eprintln!("serve error: {err}");
            }
        }
        Command::Mcp => {
            os_mcp::executor::run_stdio();
        }
        Command::Openapi => {
            let spec = os_serve::openapi::generate_spec();
            println!("{}", spec);
        }
        Command::Completions { shell: _ } => {
            // Placeholder until clap completions are wired.
        }
    }
}

fn cleanup_idempotency(path: &str) -> Result<(), String> {
    let conn = os_db::schema::open_and_migrate(path).map_err(|err| err.to_string())?;
    let store = os_db::idempotency::IdempotencyStore::new(&conn);
    let _ = store.cleanup(chrono::Utc::now());
    Ok(())
}
