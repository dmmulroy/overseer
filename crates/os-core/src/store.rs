use crate::events::EventRepository;
use crate::gates::GateRepository;
use crate::git_ai::GitAiRepository;
use crate::help::HelpRepository;
use crate::learnings::LearningRepository;
use crate::repos::RepoRepository;
use crate::reviews::ReviewRepository;
use crate::sessions::{HarnessRepository, SessionRepository};
use crate::tasks::TaskRepository;
use crate::vcs::TaskVcsRepository;
use crate::OverseerError;

pub trait Store {
    type Tasks<'a>: TaskRepository
    where
        Self: 'a;
    type Reviews<'a>: ReviewRepository
    where
        Self: 'a;
    type Gates<'a>: GateRepository
    where
        Self: 'a;
    type Help<'a>: HelpRepository
    where
        Self: 'a;
    type Learnings<'a>: LearningRepository
    where
        Self: 'a;
    type Repos<'a>: RepoRepository
    where
        Self: 'a;
    type Events<'a>: EventRepository
    where
        Self: 'a;
    type Sessions<'a>: SessionRepository
    where
        Self: 'a;
    type Harnesses<'a>: HarnessRepository
    where
        Self: 'a;
    type TaskVcs<'a>: TaskVcsRepository
    where
        Self: 'a;
    type GitAi<'a>: GitAiRepository
    where
        Self: 'a;

    fn tasks(&self) -> Self::Tasks<'_>;
    fn reviews(&self) -> Self::Reviews<'_>;
    fn gates(&self) -> Self::Gates<'_>;
    fn help(&self) -> Self::Help<'_>;
    fn learnings(&self) -> Self::Learnings<'_>;
    fn repos(&self) -> Self::Repos<'_>;
    fn events(&self) -> Self::Events<'_>;
    fn sessions(&self) -> Self::Sessions<'_>;
    fn harnesses(&self) -> Self::Harnesses<'_>;
    fn task_vcs(&self) -> Self::TaskVcs<'_>;
    fn git_ai(&self) -> Self::GitAi<'_>;

    fn with_tx<F, T>(&self, f: F) -> Result<T, OverseerError>
    where
        F: FnOnce(&Self) -> Result<T, OverseerError>;
}
