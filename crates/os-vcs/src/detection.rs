use crate::backend::{VcsError, VcsType};
use std::path::Path;

pub fn detect_repo(repo_path: &Path) -> Result<VcsType, VcsError> {
    if repo_path.join(".jj").exists() {
        return Ok(VcsType::Jj);
    }
    if repo_path.join(".git").exists() {
        return Ok(VcsType::Git);
    }
    Err(VcsError::RepoNotFound)
}
