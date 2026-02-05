use crate::error::HelpError;
use crate::types::{
    AnyTaskId, CreateHelpRequestInput, HelpRequest, HelpRequestId, HelpResponseInput, Task,
};

pub trait HelpRepository {
    fn request(&self, input: CreateHelpRequestInput) -> Result<HelpRequest, HelpError>;
    fn get_active(&self, task_id: &AnyTaskId) -> Result<Option<HelpRequest>, HelpError>;
    fn get(&self, id: &HelpRequestId) -> Result<Option<HelpRequest>, HelpError>;
    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<HelpRequest>, HelpError>;
    fn respond(
        &self,
        id: &HelpRequestId,
        input: HelpResponseInput,
    ) -> Result<HelpRequest, HelpError>;
    fn resume(&self, task_id: &AnyTaskId) -> Result<Task, HelpError>;
}
