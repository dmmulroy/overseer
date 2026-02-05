use os_core::error::{OverseerError, TaskError};
use os_core::store::Store;
use rusqlite::Connection;

use crate::event_repo::EventRepo;
use crate::gate_repo::GateRepo;
use crate::git_ai_repo::GitAiRepo;
use crate::help_repo::HelpRepo;
use crate::learning_repo::LearningRepo;
use crate::repo_repo::RepoRepo;
use crate::review_repo::ReviewRepo;
use crate::session_repo::SessionRepo;
use crate::task_repo::TaskRepo;
use crate::task_vcs_repo::TaskVcsRepo;

pub struct DbStore {
    conn: Connection,
}

impl DbStore {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}

impl Store for DbStore {
    type Tasks<'a>
        = TaskRepo<'a>
    where
        Self: 'a;
    type Reviews<'a>
        = ReviewRepo<'a>
    where
        Self: 'a;
    type Gates<'a>
        = GateRepo<'a>
    where
        Self: 'a;
    type Help<'a>
        = HelpRepo<'a>
    where
        Self: 'a;
    type Learnings<'a>
        = LearningRepo<'a>
    where
        Self: 'a;
    type Repos<'a>
        = RepoRepo<'a>
    where
        Self: 'a;
    type Events<'a>
        = EventRepo<'a>
    where
        Self: 'a;
    type Sessions<'a>
        = SessionRepo<'a>
    where
        Self: 'a;
    type Harnesses<'a>
        = SessionRepo<'a>
    where
        Self: 'a;
    type TaskVcs<'a>
        = TaskVcsRepo<'a>
    where
        Self: 'a;
    type GitAi<'a>
        = GitAiRepo<'a>
    where
        Self: 'a;

    fn tasks(&self) -> Self::Tasks<'_> {
        TaskRepo::new(&self.conn)
    }

    fn reviews(&self) -> Self::Reviews<'_> {
        ReviewRepo::new(&self.conn)
    }

    fn gates(&self) -> Self::Gates<'_> {
        GateRepo::new(&self.conn)
    }

    fn help(&self) -> Self::Help<'_> {
        HelpRepo::new(&self.conn)
    }

    fn learnings(&self) -> Self::Learnings<'_> {
        LearningRepo::new(&self.conn)
    }

    fn repos(&self) -> Self::Repos<'_> {
        RepoRepo::new(&self.conn)
    }

    fn events(&self) -> Self::Events<'_> {
        EventRepo::new(&self.conn)
    }

    fn sessions(&self) -> Self::Sessions<'_> {
        SessionRepo::new(&self.conn)
    }

    fn harnesses(&self) -> Self::Harnesses<'_> {
        SessionRepo::new(&self.conn)
    }

    fn task_vcs(&self) -> Self::TaskVcs<'_> {
        TaskVcsRepo::new(&self.conn)
    }

    fn git_ai(&self) -> Self::GitAi<'_> {
        GitAiRepo::new(&self.conn)
    }

    fn with_tx<F, T>(&self, f: F) -> Result<T, OverseerError>
    where
        F: FnOnce(&Self) -> Result<T, OverseerError>,
    {
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(|err| {
            OverseerError::Task(TaskError::InvalidInput {
                message: err.to_string(),
            })
        })?;
        let result = f(self);
        match result {
            Ok(value) => {
                self.conn.execute_batch("COMMIT").map_err(|err| {
                    OverseerError::Task(TaskError::InvalidInput {
                        message: err.to_string(),
                    })
                })?;
                Ok(value)
            }
            Err(err) => {
                self.conn
                    .execute_batch("ROLLBACK")
                    .map_err(|rollback_err| {
                        OverseerError::Task(TaskError::InvalidInput {
                            message: rollback_err.to_string(),
                        })
                    })?;
                Err(err)
            }
        }
    }
}
