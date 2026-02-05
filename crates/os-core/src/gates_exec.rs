use crate::error::{GateError, OverseerError};
use crate::types::enums::GateStatus;
use crate::types::gate::{Gate, GateResult};
use crate::types::ids::{AnyTaskId, GateId, ReviewId};
use crate::types::repo::Repo;
use chrono::Utc;
use std::io::Read as _;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const OUTPUT_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateRunDecision {
    Passed,
    Pending,
    Failed,
    Timeout,
}

pub fn run_gate(
    gate: &Gate,
    task_id: &AnyTaskId,
    repo: &Repo,
    review_id: &ReviewId,
    attempt: u32,
) -> Result<GateResult, OverseerError> {
    let argv = shell_words::split(&gate.command).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    let (program, args) = argv.split_first().ok_or_else(|| GateError::InvalidInput {
        message: "gate command empty".to_string(),
    })?;

    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(&repo.path)
        .env("OVERSEER_TASK_ID", task_id.as_str())
        .env("OVERSEER_REPO_ID", repo.id.as_str())
        .env(
            "OVERSEER_REPO_PATH",
            repo.path.to_string_lossy().to_string(),
        )
        .env("OVERSEER_REVIEW_ID", review_id.as_str())
        .env("OVERSEER_GATE_NAME", &gate.name)
        .env("OVERSEER_ATTEMPT", attempt.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let started_at = Utc::now();
    let mut child = command.spawn().map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;

    let timeout = Duration::from_secs(u64::from(gate.timeout_secs));
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    loop {
        if let Some(_status) = child.try_wait().map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })? {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let output = child
        .wait_with_output()
        .map_err(|err| GateError::InvalidInput {
            message: err.to_string(),
        })?;

    let stdout = limit_output(output.stdout);
    let stderr = limit_output(output.stderr);
    let exit_code = output.status.code();
    let completed_at = Some(Utc::now());

    let decision = if timed_out {
        GateRunDecision::Timeout
    } else {
        match exit_code {
            Some(0) => GateRunDecision::Passed,
            Some(75) => GateRunDecision::Pending,
            Some(_) => GateRunDecision::Failed,
            None => GateRunDecision::Failed,
        }
    };

    let status = match decision {
        GateRunDecision::Passed => GateStatus::Passed,
        GateRunDecision::Pending => GateStatus::Pending,
        GateRunDecision::Failed => GateStatus::Failed,
        GateRunDecision::Timeout => GateStatus::Timeout,
    };

    Ok(GateResult {
        gate_id: gate.id.clone(),
        task_id: task_id.clone(),
        review_id: review_id.clone(),
        status,
        stdout,
        stderr,
        exit_code,
        attempt,
        started_at,
        completed_at,
    })
}

fn limit_output(data: Vec<u8>) -> String {
    let mut sliced = data;
    if sliced.len() > OUTPUT_LIMIT {
        sliced.truncate(OUTPUT_LIMIT);
    }
    let mut out = String::new();
    let mut reader = &sliced[..];
    let _ = reader.read_to_string(&mut out);
    out
}

pub fn result_decision(result: &GateResult) -> GateRunDecision {
    match result.status {
        GateStatus::Passed => GateRunDecision::Passed,
        GateStatus::Pending => GateRunDecision::Pending,
        GateStatus::Failed => GateRunDecision::Failed,
        GateStatus::Timeout => GateRunDecision::Timeout,
        GateStatus::Escalated | GateStatus::Running => GateRunDecision::Failed,
    }
}

pub fn escalated_result(
    gate_id: GateId,
    task_id: &AnyTaskId,
    review_id: &ReviewId,
    attempt: u32,
) -> GateResult {
    GateResult {
        gate_id,
        task_id: task_id.clone(),
        review_id: review_id.clone(),
        status: GateStatus::Escalated,
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
        attempt,
        started_at: Utc::now(),
        completed_at: Some(Utc::now()),
    }
}
