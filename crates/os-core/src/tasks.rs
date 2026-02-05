use crate::error::TaskError;
use crate::types::{
    AnyTaskId, CreateTaskInput, MilestoneId, RepoId, Task, TaskFilter, TaskProgress, TaskStatus,
    TaskTree, UpdateTaskInput,
};
use chrono::{DateTime, Utc};

pub trait TaskRepository {
    fn create(&self, input: CreateTaskInput) -> Result<Task, TaskError>;
    fn get(&self, id: &AnyTaskId) -> Result<Option<Task>, TaskError>;
    fn get_with_context(
        &self,
        id: &AnyTaskId,
    ) -> Result<Option<crate::types::TaskWithContext>, TaskError>;
    fn list(&self, filter: TaskFilter) -> Result<Vec<Task>, TaskError>;
    fn update(&self, id: &AnyTaskId, input: UpdateTaskInput) -> Result<Task, TaskError>;
    fn set_status(
        &self,
        id: &AnyTaskId,
        status: TaskStatus,
        started_at: Option<DateTime<Utc>>,
        completed_at: Option<DateTime<Utc>>,
    ) -> Result<Task, TaskError>;
    fn delete(&self, id: &AnyTaskId) -> Result<(), TaskError>;
    fn tree(&self, root_id: Option<&AnyTaskId>) -> Result<TaskTree, TaskError>;
    fn next_ready(
        &self,
        repo_id: &RepoId,
        scope: Option<&MilestoneId>,
    ) -> Result<Option<Task>, TaskError>;
    fn add_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError>;
    fn remove_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError>;
    fn progress(
        &self,
        repo_id: &RepoId,
        scope: Option<&AnyTaskId>,
    ) -> Result<TaskProgress, TaskError>;
}
