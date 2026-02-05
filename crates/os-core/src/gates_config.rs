use crate::error::{GateError, TaskError};
use crate::types::gate::GateScope;
use crate::types::ids::{AnyTaskId, RepoId};
use crate::types::io::CreateGateInput;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct GateConfigEntry {
    pub name: String,
    pub command: String,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub poll_interval_secs: Option<u32>,
    pub max_pending_secs: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct RepoGateFile {
    #[serde(default)]
    gate: Vec<GateConfigEntry>,
}

#[derive(Debug, Deserialize)]
struct FrontMatter {
    #[serde(default)]
    gates: Vec<GateConfigEntry>,
}

pub fn load_repo_gates(repo_path: &Path) -> Result<Vec<GateConfigEntry>, GateError> {
    let gates_path = repo_path.join(".overseer").join("gates.toml");
    let content = match fs::read_to_string(&gates_path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => {
            return Err(GateError::InvalidInput {
                message: err.to_string(),
            })
        }
    };
    let parsed: RepoGateFile = toml::from_str(&content).map_err(|err| GateError::InvalidInput {
        message: err.to_string(),
    })?;
    Ok(parsed.gate)
}

pub fn parse_task_context(context: &str) -> Result<(String, Vec<GateConfigEntry>), TaskError> {
    let mut lines = context.lines();
    let Some(first) = lines.next() else {
        return Ok((String::new(), Vec::new()));
    };
    if first.trim() != "---" {
        return Ok((context.to_string(), Vec::new()));
    }

    let mut yaml_lines = Vec::new();
    let mut remainder_lines = Vec::new();
    let mut in_front_matter = true;
    for line in lines {
        if in_front_matter && line.trim() == "---" {
            in_front_matter = false;
            continue;
        }
        if in_front_matter {
            yaml_lines.push(line);
        } else {
            remainder_lines.push(line);
        }
    }

    let yaml = yaml_lines.join("\n");
    let parsed: FrontMatter =
        serde_yaml::from_str(&yaml).map_err(|err| TaskError::InvalidInput {
            message: err.to_string(),
        })?;
    let remainder = remainder_lines.join("\n").trim().to_string();
    Ok((remainder, parsed.gates))
}

pub fn gate_inputs_for_repo(repo_id: &RepoId, gates: &[GateConfigEntry]) -> Vec<CreateGateInput> {
    gates
        .iter()
        .map(|gate| CreateGateInput {
            scope: GateScope::Repo(repo_id.clone()),
            name: gate.name.clone(),
            command: gate.command.clone(),
            timeout_secs: gate.timeout_secs,
            max_retries: gate.max_retries,
            poll_interval_secs: gate.poll_interval_secs,
            max_pending_secs: gate.max_pending_secs,
        })
        .collect()
}

pub fn gate_inputs_for_task(
    task_id: &AnyTaskId,
    gates: &[GateConfigEntry],
) -> Vec<CreateGateInput> {
    gates
        .iter()
        .map(|gate| CreateGateInput {
            scope: GateScope::Task(task_id.clone()),
            name: gate.name.clone(),
            command: gate.command.clone(),
            timeout_secs: gate.timeout_secs,
            max_retries: gate.max_retries,
            poll_interval_secs: gate.poll_interval_secs,
            max_pending_secs: gate.max_pending_secs,
        })
        .collect()
}
