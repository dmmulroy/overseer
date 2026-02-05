use crate::types::enums::VcsType;
use crate::types::ids::RepoId;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Repo {
    pub id: RepoId,
    #[schema(value_type = String)]
    pub path: PathBuf,
    pub name: String,
    pub vcs_type: VcsType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
