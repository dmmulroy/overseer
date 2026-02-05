use crate::types::enums::TaskKind;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use ulid::Ulid;
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct MilestoneId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct TaskId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct SubtaskId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct LearningId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct ReviewId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct CommentId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct RepoId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct GateId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(transparent)]
#[schema(as = String)]
pub struct HelpRequestId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(untagged)]
#[schema(as = String)]
pub enum AnyTaskId {
    Milestone(MilestoneId),
    Task(TaskId),
    Subtask(SubtaskId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdError {
    InvalidPrefix { expected: &'static str, got: String },
    InvalidUlid { value: String },
    InvalidFormat { value: String },
}

impl fmt::Display for IdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPrefix { expected, got } => {
                write!(f, "invalid prefix: expected {expected}, got {got}")
            }
            Self::InvalidUlid { value } => write!(f, "invalid ulid: {value}"),
            Self::InvalidFormat { value } => write!(f, "invalid id format: {value}"),
        }
    }
}

impl std::error::Error for IdError {}

fn validate_prefixed(value: &str, prefix: &'static str) -> Result<(), IdError> {
    let Some(rest) = value.strip_prefix(prefix) else {
        let got = value.split('_').next().unwrap_or("").to_string();
        return Err(IdError::InvalidPrefix {
            expected: prefix,
            got,
        });
    };
    if rest.len() != 26 {
        return Err(IdError::InvalidFormat {
            value: value.to_string(),
        });
    }
    Ulid::from_str(rest).map_err(|_| IdError::InvalidUlid {
        value: value.to_string(),
    })?;
    Ok(())
}

macro_rules! id_type {
    ($name:ident, $prefix:expr) => {
        impl $name {
            pub const PREFIX: &'static str = $prefix;

            pub fn new(value: String) -> Result<Self, IdError> {
                validate_prefixed(&value, Self::PREFIX)?;
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl FromStr for $name {
            type Err = IdError;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Self::new(s.to_string())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::new(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

id_type!(MilestoneId, "ms_");
id_type!(TaskId, "task_");
id_type!(SubtaskId, "sub_");
id_type!(LearningId, "lrn_");
id_type!(ReviewId, "rev_");
id_type!(CommentId, "cmt_");
id_type!(RepoId, "repo_");
id_type!(GateId, "gate_");
id_type!(HelpRequestId, "help_");

impl<'de> Deserialize<'de> for AnyTaskId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        AnyTaskId::parse(&value).map_err(serde::de::Error::custom)
    }
}

impl AnyTaskId {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Milestone(id) => id.as_str(),
            Self::Task(id) => id.as_str(),
            Self::Subtask(id) => id.as_str(),
        }
    }

    pub fn kind(&self) -> TaskKind {
        match self {
            Self::Milestone(_) => TaskKind::Milestone,
            Self::Task(_) => TaskKind::Task,
            Self::Subtask(_) => TaskKind::Subtask,
        }
    }

    pub fn parse(value: &str) -> Result<Self, IdError> {
        if value.starts_with(MilestoneId::PREFIX) {
            return Ok(Self::Milestone(MilestoneId::from_str(value)?));
        }
        if value.starts_with(TaskId::PREFIX) {
            return Ok(Self::Task(TaskId::from_str(value)?));
        }
        if value.starts_with(SubtaskId::PREFIX) {
            return Ok(Self::Subtask(SubtaskId::from_str(value)?));
        }
        Err(IdError::InvalidPrefix {
            expected: "ms_|task_|sub_",
            got: value.split('_').next().unwrap_or("").to_string(),
        })
    }
}

impl FromStr for AnyTaskId {
    type Err = IdError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}
