use crate::error::VcsError;
use crate::types::{AnyTaskId, Diff, RepoId, TaskVcs};
use chrono::{DateTime, Utc};

pub trait TaskVcsRepository {
    fn create(&self, task_vcs: TaskVcs) -> Result<TaskVcs, VcsError>;
    fn get(&self, task_id: &AnyTaskId) -> Result<Option<TaskVcs>, VcsError>;
    fn list(&self, repo_id: &RepoId) -> Result<Vec<TaskVcs>, VcsError>;
    fn update(&self, task_vcs: TaskVcs) -> Result<TaskVcs, VcsError>;
    fn set_archived(
        &self,
        task_id: &AnyTaskId,
        archived_at: DateTime<Utc>,
    ) -> Result<TaskVcs, VcsError>;
}

pub trait VcsRepository {
    fn get_task_vcs(&self, task_id: &AnyTaskId) -> Result<Option<TaskVcs>, VcsError>;
    fn list_task_vcs(&self, repo_id: &RepoId) -> Result<Vec<TaskVcs>, VcsError>;
    fn archive(&self, task_id: &AnyTaskId) -> Result<TaskVcs, VcsError>;
    fn diff(&self, task_id: &AnyTaskId) -> Result<Diff, VcsError>;
}
