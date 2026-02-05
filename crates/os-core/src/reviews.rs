use crate::error::ReviewError;
use crate::types::{
    AnyTaskId, CommentId, CreateCommentInput, Review, ReviewComment, ReviewId, ReviewStatus,
};

pub trait ReviewRepository {
    fn create(&self, task_id: &AnyTaskId) -> Result<Review, ReviewError>;
    fn get(&self, id: &ReviewId) -> Result<Option<Review>, ReviewError>;
    fn get_active_for_task(&self, task_id: &AnyTaskId) -> Result<Option<Review>, ReviewError>;
    fn list_for_task(&self, task_id: &AnyTaskId) -> Result<Vec<Review>, ReviewError>;
    fn list_by_status(&self, status: ReviewStatus) -> Result<Vec<Review>, ReviewError>;
    fn update_status(&self, id: &ReviewId, status: ReviewStatus) -> Result<Review, ReviewError>;
    fn add_comment(&self, input: CreateCommentInput) -> Result<ReviewComment, ReviewError>;
    fn list_comments(&self, review_id: &ReviewId) -> Result<Vec<ReviewComment>, ReviewError>;
    fn resolve_comment(&self, id: &CommentId) -> Result<ReviewComment, ReviewError>;
}
