use crate::error::RepoError;
use crate::types::{Repo, RepoId};
use std::path::{Path, PathBuf};

pub trait RepoRepository {
    fn register(&self, path: PathBuf) -> Result<Repo, RepoError>;
    fn get(&self, id: &RepoId) -> Result<Option<Repo>, RepoError>;
    fn get_by_path(&self, path: &Path) -> Result<Option<Repo>, RepoError>;
    fn list(&self) -> Result<Vec<Repo>, RepoError>;
    fn unregister(&self, id: &RepoId) -> Result<(), RepoError>;
}
