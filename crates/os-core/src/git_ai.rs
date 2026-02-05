use crate::error::GitAiError;
use crate::types::git_ai::{GitAiReview, GitAiReviewInput, GitAiReviewOutput};
use crate::types::ids::ReviewId;

pub trait GitAiRepository {
    fn create(&self, input: GitAiReviewInput) -> Result<GitAiReview, GitAiError>;
    fn get(&self, review_id: &ReviewId) -> Result<Option<GitAiReview>, GitAiError>;
    fn set_result(
        &self,
        review_id: &ReviewId,
        output: GitAiReviewOutput,
    ) -> Result<GitAiReview, GitAiError>;
    fn set_failed(&self, review_id: &ReviewId, error: String) -> Result<GitAiReview, GitAiError>;
}
