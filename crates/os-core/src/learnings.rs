use crate::error::LearningError;
use crate::types::{AnyTaskId, InheritedLearnings, Learning};

pub trait LearningRepository {
    fn add(&self, task_id: &AnyTaskId, content: String) -> Result<Learning, LearningError>;
    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<Learning>, LearningError>;
    fn get_inherited(&self, task_id: &AnyTaskId) -> Result<InheritedLearnings, LearningError>;
    fn bubble(&self, from: &AnyTaskId, to: &AnyTaskId) -> Result<Vec<Learning>, LearningError>;
}
