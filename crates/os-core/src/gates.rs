use crate::error::GateError;
use crate::types::{
    AnyTaskId, CreateGateInput, Gate, GateId, GateResult, GateScope, ReviewId, UpdateGateInput,
};

pub trait GateRepository {
    fn add(&self, input: CreateGateInput) -> Result<Gate, GateError>;
    fn get(&self, id: &GateId) -> Result<Option<Gate>, GateError>;
    fn get_effective(&self, task_id: &AnyTaskId) -> Result<Vec<Gate>, GateError>;
    fn list(&self, scope: &GateScope) -> Result<Vec<Gate>, GateError>;
    fn remove(&self, id: &GateId) -> Result<(), GateError>;
    fn update(&self, id: &GateId, input: UpdateGateInput) -> Result<Gate, GateError>;
    fn record_result(&self, result: GateResult) -> Result<(), GateError>;
    fn get_results(&self, review_id: &ReviewId) -> Result<Vec<GateResult>, GateError>;
}
