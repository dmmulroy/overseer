use crate::error::{OverseerError, TaskError};
use crate::events::EventRepository;
use crate::gates::GateRepository;
use crate::gates_config::{
    gate_inputs_for_repo, gate_inputs_for_task, load_repo_gates, parse_task_context,
};
use crate::gates_exec::{result_decision, run_gate, GateRunDecision};
use crate::git_ai::GitAiRepository;
use crate::help::HelpRepository;
use crate::learnings::LearningRepository;
use crate::repos::RepoRepository;
use crate::reviews::ReviewRepository;
use crate::sessions::{HarnessRepository, SessionRepository};
use crate::store::Store;
use crate::tasks::TaskRepository;
use crate::types::event::EventBody;
use crate::types::gate::{Gate, GateResult, GateScope};
use crate::types::git_ai::{GitAiReview, GitAiReviewInput, GitAiReviewOutput};
use crate::types::io::{
    CreateCommentInput, CreateGateInput, CreateHelpRequestInput, CreateTaskInput,
    HelpResponseInput, RequestChangesInput, TaskFilter, UpdateGateInput, UpdateTaskInput,
};
use crate::types::learning::{InheritedLearnings, Learning};
use crate::types::repo::Repo;
use crate::types::review::{Review, ReviewComment};
use crate::types::session::{Harness, Session};
use crate::types::task::{Task, TaskProgress, TaskTree, TaskWithContext};
use crate::types::vcs::{Diff, DiffFile, DiffHunk, DiffLine, DiffLineKind, TaskVcs};
use crate::types::{
    AnyTaskId, CommentId, GateId, GateStatus, HelpRequest, HelpRequestId, MilestoneId, RepoId,
    ReviewDecision, ReviewId, ReviewStatus, SessionStatus, TaskStatus, VcsType,
};
use crate::validation::{
    validate_blocker_cycle, validate_task_hierarchy, validate_task_kind,
    validate_task_status_transition,
};
use crate::vcs::TaskVcsRepository;
use chrono::Utc;
use os_events::bus::EventBus;
use os_events::types::{EventRecord, EventSource};
use os_vcs::backend::VcsBackend;
use os_vcs::git::GitBackend;
use os_vcs::jj::JjBackend;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct RequestContext {
    pub source: EventSource,
    pub correlation_id: Option<String>,
}

impl RequestContext {
    pub fn new(source: EventSource, correlation_id: Option<String>) -> Self {
        Self {
            source,
            correlation_id,
        }
    }
}

pub struct Overseer<S: Store> {
    store: S,
    event_bus: EventBus,
}

impl<S: Store> Overseer<S> {
    pub fn new(store: S, event_bus: EventBus) -> Self {
        Self { store, event_bus }
    }

    pub fn tasks(&self) -> TasksApi<'_, S> {
        TasksApi { core: self }
    }

    pub fn repos(&self) -> ReposApi<'_, S> {
        ReposApi { core: self }
    }

    pub fn learnings(&self) -> LearningsApi<'_, S> {
        LearningsApi { core: self }
    }

    pub fn events(&self) -> EventsApi<'_, S> {
        EventsApi { core: self }
    }

    pub fn help(&self) -> HelpApi<'_, S> {
        HelpApi { core: self }
    }

    pub fn gates(&self) -> GatesApi<'_, S> {
        GatesApi { core: self }
    }

    pub fn reviews(&self) -> ReviewsApi<'_, S> {
        ReviewsApi { core: self }
    }

    pub fn vcs(&self) -> VcsApi<'_, S> {
        VcsApi { core: self }
    }

    pub fn sessions(&self) -> SessionsApi<'_, S> {
        SessionsApi { core: self }
    }

    pub fn git_ai(&self) -> GitAiApi<'_, S> {
        GitAiApi { core: self }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    fn with_events<T, F>(&self, ctx: &RequestContext, f: F) -> Result<T, OverseerError>
    where
        F: FnOnce(&S) -> Result<(T, Vec<EventBody>), OverseerError>,
    {
        let (value, records) = self.store.with_tx(|store| {
            let (value, bodies) = f(store)?;
            let mut records = Vec::new();
            for body in bodies {
                let record = build_event_record(ctx, body)?;
                let record = store.events().append(record)?;
                records.push(record);
            }
            Ok((value, records))
        })?;
        for record in records {
            let _ = self.event_bus.publish(record);
        }
        Ok(value)
    }
}

pub struct TasksApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> TasksApi<'a, S> {
    pub fn create(
        &self,
        ctx: &RequestContext,
        input: CreateTaskInput,
    ) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let repo = store.repos().get(&input.repo_id)?;
            if repo.is_none() {
                return Err(OverseerError::Repo(crate::error::RepoError::RepoNotFound));
            }

            let parent_kind = match &input.parent_id {
                Some(parent_id) => {
                    let parent = store.tasks().get(parent_id)?;
                    let Some(parent) = parent else {
                        return Err(OverseerError::Task(TaskError::NotFound));
                    };
                    if parent.repo_id != input.repo_id {
                        return Err(OverseerError::Task(TaskError::InvalidInput {
                            message: "parent must be in same repo".to_string(),
                        }));
                    }
                    Some(parent.kind)
                }
                None => None,
            };

            for blocker in &input.blocked_by {
                let blocker_task = store.tasks().get(blocker)?;
                let Some(blocker_task) = blocker_task else {
                    return Err(OverseerError::Task(TaskError::NotFound));
                };
                if blocker_task.repo_id != input.repo_id {
                    return Err(OverseerError::Task(TaskError::InvalidInput {
                        message: "blocker must be in same repo".to_string(),
                    }));
                }
            }

            let (context, context_gates) = match input.context.as_deref() {
                Some(text) => parse_task_context(text)
                    .map(|(context, gates)| (Some(context), gates))
                    .map_err(|err| {
                        OverseerError::Task(TaskError::InvalidInput {
                            message: err.to_string(),
                        })
                    })?,
                None => (None, Vec::new()),
            };
            let input = CreateTaskInput { context, ..input };
            let task = store.tasks().create(input)?;
            validate_task_kind(&task)?;
            validate_task_hierarchy(&task, parent_kind)?;
            let mut events = vec![EventBody::TaskCreated { task: task.clone() }];
            for gate_input in gate_inputs_for_task(&task.id, &context_gates) {
                if let Ok(gate) = store.gates().add(gate_input) {
                    events.push(EventBody::GateAdded { gate });
                }
            }

            Ok((task.clone(), events))
        })
    }

    pub fn get(&self, id: &AnyTaskId) -> Result<Option<TaskWithContext>, OverseerError> {
        self.core
            .store
            .tasks()
            .get_with_context(id)
            .map_err(OverseerError::from)
    }

    pub fn list(&self, filter: TaskFilter) -> Result<Vec<Task>, OverseerError> {
        self.core
            .store
            .tasks()
            .list(filter)
            .map_err(OverseerError::from)
    }

    pub fn update(
        &self,
        ctx: &RequestContext,
        id: &AnyTaskId,
        input: UpdateTaskInput,
    ) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().update(id, input)?;
            Ok((task.clone(), vec![EventBody::TaskUpdated { task }]))
        })
    }

    pub fn delete(&self, ctx: &RequestContext, id: &AnyTaskId) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            store.tasks().delete(id)?;
            Ok((
                (),
                vec![EventBody::TaskDeleted {
                    task_id: id.clone(),
                }],
            ))
        })
    }

    pub fn tree(&self, root_id: Option<&AnyTaskId>) -> Result<TaskTree, OverseerError> {
        self.core
            .store
            .tasks()
            .tree(root_id)
            .map_err(OverseerError::from)
    }

    pub fn next_ready(
        &self,
        repo_id: &RepoId,
        scope: Option<&MilestoneId>,
    ) -> Result<Option<Task>, OverseerError> {
        self.core
            .store
            .tasks()
            .next_ready(repo_id, scope)
            .map_err(OverseerError::from)
    }

    pub fn progress(
        &self,
        repo_id: &RepoId,
        scope: Option<&AnyTaskId>,
    ) -> Result<TaskProgress, OverseerError> {
        self.core
            .store
            .tasks()
            .progress(repo_id, scope)
            .map_err(OverseerError::from)
    }

    pub fn add_blocker(
        &self,
        ctx: &RequestContext,
        task_id: &AnyTaskId,
        blocker_id: &AnyTaskId,
    ) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            if task_id == blocker_id {
                return Err(OverseerError::Task(TaskError::SelfBlock));
            }
            let task = store.tasks().get(task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            let blocker = store.tasks().get(blocker_id)?;
            let Some(blocker) = blocker else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            if task.repo_id != blocker.repo_id {
                return Err(OverseerError::Task(TaskError::InvalidInput {
                    message: "blocker must be in same repo".to_string(),
                }));
            }

            let tasks = store.tasks().list(TaskFilter {
                repo_id: Some(task.repo_id.clone()),
                parent_id: None,
                kind: None,
                status: None,
                ready: None,
                archived: None,
            })?;
            let mut graph = std::collections::HashMap::new();
            for task in tasks {
                graph.insert(task.id.clone(), task.blocked_by.clone());
            }
            validate_blocker_cycle(task_id, blocker_id, &graph)?;

            store.tasks().add_blocker(task_id, blocker_id)?;
            Ok((
                (),
                vec![EventBody::BlockerAdded {
                    task_id: task_id.clone(),
                    blocker_id: blocker_id.clone(),
                }],
            ))
        })
    }

    pub fn remove_blocker(
        &self,
        ctx: &RequestContext,
        task_id: &AnyTaskId,
        blocker_id: &AnyTaskId,
    ) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            store.tasks().remove_blocker(task_id, blocker_id)?;
            Ok((
                (),
                vec![EventBody::BlockerRemoved {
                    task_id: task_id.clone(),
                    blocker_id: blocker_id.clone(),
                }],
            ))
        })
    }

    pub fn set_status(
        &self,
        ctx: &RequestContext,
        id: &AnyTaskId,
        status: TaskStatus,
    ) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            validate_task_status_transition(task.status, status)?;
            let mut started_at = None;
            let mut completed_at = None;
            if status == TaskStatus::InProgress && task.started_at.is_none() {
                started_at = Some(Utc::now());
            }
            if status == TaskStatus::Completed && task.completed_at.is_none() {
                completed_at = Some(Utc::now());
            }
            let updated = store
                .tasks()
                .set_status(id, status, started_at, completed_at)?;
            Ok((
                updated.clone(),
                vec![EventBody::TaskStatusChanged {
                    task: updated.clone(),
                    from: task.status,
                    to: status,
                }],
            ))
        })
    }

    pub fn cancel(&self, ctx: &RequestContext, id: &AnyTaskId) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            validate_task_status_transition(task.status, TaskStatus::Cancelled)?;
            let updated = store
                .tasks()
                .set_status(id, TaskStatus::Cancelled, None, None)?;
            Ok((
                updated.clone(),
                vec![EventBody::TaskCancelled { task: updated }],
            ))
        })
    }

    pub fn force_complete(
        &self,
        ctx: &RequestContext,
        id: &AnyTaskId,
    ) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            validate_task_status_transition(task.status, TaskStatus::Completed)?;
            let completed_at = task.completed_at.or_else(|| Some(Utc::now()));
            let updated =
                store
                    .tasks()
                    .set_status(id, TaskStatus::Completed, None, completed_at)?;
            Ok((
                updated.clone(),
                vec![EventBody::TaskCompleted { task: updated }],
            ))
        })
    }

    pub fn start(&self, ctx: &RequestContext, id: &AnyTaskId) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            validate_task_status_transition(task.status, TaskStatus::InProgress)?;

            let tasks = store.tasks().list(TaskFilter {
                repo_id: Some(task.repo_id.clone()),
                parent_id: None,
                kind: None,
                status: None,
                ready: None,
                archived: None,
            })?;
            if is_effectively_blocked(&task, &tasks) {
                return Err(OverseerError::Task(TaskError::Conflict {
                    message: "task is blocked".to_string(),
                }));
            }

            if store.task_vcs().get(id)?.is_some() {
                return Err(OverseerError::Vcs(
                    crate::error::VcsError::RefAlreadyExists {
                        name: format!("task/{}", id.as_str()),
                    },
                ));
            }

            let repo = store.repos().get(&task.repo_id)?;
            let Some(repo) = repo else {
                return Err(OverseerError::Repo(crate::error::RepoError::RepoNotFound));
            };

            match repo.vcs_type {
                VcsType::Jj => JjBackend::ensure_clean(&repo.path)?,
                VcsType::Git => GitBackend::ensure_clean(&repo.path)?,
            };

            let (base_commit, start_commit) = match task.parent_id.as_ref() {
                Some(parent_id) => {
                    let parent_vcs = store.task_vcs().get(parent_id)?.ok_or_else(|| {
                        OverseerError::Task(TaskError::InvalidInput {
                            message: "parent task has no VCS".to_string(),
                        })
                    })?;
                    let parent_head = parent_vcs.head_commit.clone().ok_or_else(|| {
                        OverseerError::Task(TaskError::InvalidInput {
                            message: "parent task not submitted".to_string(),
                        })
                    })?;
                    match repo.vcs_type {
                        VcsType::Jj => JjBackend::checkout_ref(&repo.path, &parent_vcs.ref_name)?,
                        VcsType::Git => GitBackend::checkout_ref(&repo.path, &parent_vcs.ref_name)?,
                    };
                    (parent_head.clone(), parent_head)
                }
                None => {
                    let head = match repo.vcs_type {
                        VcsType::Jj => JjBackend::head_commit(&repo.path)?,
                        VcsType::Git => GitBackend::head_commit(&repo.path)?,
                    };
                    (head.clone(), head)
                }
            };
            let ref_name = format!("task/{}", id.as_str());
            let change_id = match repo.vcs_type {
                VcsType::Jj => JjBackend::create_ref(&repo.path, &ref_name)?,
                VcsType::Git => GitBackend::create_ref(&repo.path, &ref_name)?,
            };
            match repo.vcs_type {
                VcsType::Jj => JjBackend::checkout_ref(&repo.path, &ref_name)?,
                VcsType::Git => GitBackend::checkout_ref(&repo.path, &ref_name)?,
            };

            let now = Utc::now();
            let task_vcs = TaskVcs {
                task_id: task.id.clone(),
                repo_id: task.repo_id.clone(),
                vcs_type: repo.vcs_type,
                ref_name: ref_name.clone(),
                change_id,
                base_commit: base_commit.clone(),
                head_commit: None,
                start_commit,
                created_at: now,
                updated_at: now,
                archived_at: None,
            };
            store.task_vcs().create(task_vcs)?;

            let updated = store
                .tasks()
                .set_status(id, TaskStatus::InProgress, Some(now), None)?;
            Ok((
                updated.clone(),
                vec![
                    EventBody::TaskStarted {
                        task: updated.clone(),
                    },
                    EventBody::RefCreated {
                        task_id: id.clone(),
                        ref_name,
                    },
                ],
            ))
        })
    }

    pub fn submit(&self, ctx: &RequestContext, id: &AnyTaskId) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            validate_task_status_transition(task.status, TaskStatus::InReview)?;
            let task_vcs = store.task_vcs().get(id)?.ok_or_else(|| {
                OverseerError::Vcs(crate::error::VcsError::RefNotFound {
                    name: id.as_str().to_string(),
                })
            })?;
            let repo = store.repos().get(&task.repo_id)?;
            let Some(repo) = repo else {
                return Err(OverseerError::Repo(crate::error::RepoError::RepoNotFound));
            };

            let message = format!("task: {}", id.as_str());
            let rev = match repo.vcs_type {
                VcsType::Jj => JjBackend::commit_all(&repo.path, &message)?,
                VcsType::Git => GitBackend::commit_all(&repo.path, &message)?,
            };

            let mut updated_vcs = task_vcs.clone();
            updated_vcs.head_commit = Some(rev.clone());
            updated_vcs.updated_at = Utc::now();
            store.task_vcs().update(updated_vcs)?;

            let review = store.reviews().create(id)?;
            let updated = store
                .tasks()
                .set_status(id, TaskStatus::InReview, None, None)?;

            let mut events = vec![
                EventBody::TaskSubmitted {
                    task: updated.clone(),
                    review_id: review.id.clone(),
                },
                EventBody::ReviewCreated {
                    review: review.clone(),
                },
                EventBody::Committed {
                    task_id: id.clone(),
                    rev,
                },
            ];

            let gates = store.gates().get_effective(id)?;
            let mut results = Vec::new();
            if gates.is_empty() {
                let _ = store
                    .reviews()
                    .update_status(&review.id, ReviewStatus::AgentPending)?;
            } else {
                for gate in &gates {
                    events.push(EventBody::GateStarted {
                        gate_id: gate.id.clone(),
                        task_id: id.clone(),
                        review_id: review.id.clone(),
                    });

                    let mut result = run_gate(gate, id, &repo, &review.id, 1)?;
                    apply_gate_escalation(gate, &mut result);

                    store.gates().record_result(result.clone())?;
                    results.push(result.clone());
                    match result.status {
                        GateStatus::Passed => events.push(EventBody::GatePassed {
                            gate_id: gate.id.clone(),
                            result,
                        }),
                        GateStatus::Escalated => events.push(EventBody::GateEscalated {
                            gate_id: gate.id.clone(),
                            result,
                        }),
                        GateStatus::Failed | GateStatus::Timeout => {
                            events.push(EventBody::GateFailed {
                                gate_id: gate.id.clone(),
                                result,
                            });
                        }
                        GateStatus::Pending | GateStatus::Running => {}
                    }
                }

                let next_status = analyze_gate_results(&gates, &results);
                if next_status != review.status {
                    let _ = store.reviews().update_status(&review.id, next_status)?;
                }
            }

            Ok((updated.clone(), events))
        })
    }
}

pub struct ReposApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> ReposApi<'a, S> {
    pub fn register(
        &self,
        ctx: &RequestContext,
        path: std::path::PathBuf,
    ) -> Result<Repo, OverseerError> {
        self.core.with_events(ctx, |store| {
            let repo = store.repos().register(path)?;
            let mut events = vec![EventBody::RepoRegistered { repo: repo.clone() }];
            let gates = load_repo_gates(&repo.path).map_err(OverseerError::from)?;
            for gate_input in gate_inputs_for_repo(&repo.id, &gates) {
                if let Ok(gate) = store.gates().add(gate_input) {
                    events.push(EventBody::GateAdded { gate });
                }
            }
            Ok((repo.clone(), events))
        })
    }

    pub fn get(&self, id: &RepoId) -> Result<Option<Repo>, OverseerError> {
        self.core.store.repos().get(id).map_err(OverseerError::from)
    }

    pub fn get_by_path(&self, path: &std::path::Path) -> Result<Option<Repo>, OverseerError> {
        self.core
            .store
            .repos()
            .get_by_path(path)
            .map_err(OverseerError::from)
    }

    pub fn list(&self) -> Result<Vec<Repo>, OverseerError> {
        self.core.store.repos().list().map_err(OverseerError::from)
    }

    pub fn unregister(&self, ctx: &RequestContext, id: &RepoId) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            store.repos().unregister(id)?;
            Ok((
                (),
                vec![EventBody::RepoUnregistered {
                    repo_id: id.clone(),
                }],
            ))
        })
    }
}

pub struct LearningsApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> LearningsApi<'a, S> {
    pub fn add(
        &self,
        ctx: &RequestContext,
        task_id: &AnyTaskId,
        content: String,
    ) -> Result<Learning, OverseerError> {
        self.core.with_events(ctx, |store| {
            let learning = store.learnings().add(task_id, content)?;
            Ok((
                learning.clone(),
                vec![EventBody::LearningAdded { learning }],
            ))
        })
    }

    pub fn list(&self, task_id: &AnyTaskId) -> Result<Vec<Learning>, OverseerError> {
        self.core
            .store
            .learnings()
            .list(task_id)
            .map_err(OverseerError::from)
    }

    pub fn inherited(&self, task_id: &AnyTaskId) -> Result<InheritedLearnings, OverseerError> {
        self.core
            .store
            .learnings()
            .get_inherited(task_id)
            .map_err(OverseerError::from)
    }
}

pub struct EventsApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> EventsApi<'a, S> {
    pub fn list(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError> {
        self.core.store.events().list(after, limit)
    }

    pub fn replay(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<EventRecord>, OverseerError> {
        self.core.store.events().replay(after, limit)
    }
}

pub struct HelpApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> HelpApi<'a, S> {
    pub fn request(
        &self,
        ctx: &RequestContext,
        input: CreateHelpRequestInput,
    ) -> Result<HelpRequest, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(&input.task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            match task.status {
                TaskStatus::Pending | TaskStatus::InProgress | TaskStatus::InReview => {}
                _ => {
                    return Err(OverseerError::Help(crate::error::HelpError::InvalidState {
                        message: "task not in active state".to_string(),
                    }))
                }
            }
            let help_request = store.help().request(input)?;
            let updated =
                store
                    .tasks()
                    .set_status(&task.id, TaskStatus::AwaitingHuman, None, None)?;
            Ok((
                help_request.clone(),
                vec![
                    EventBody::HelpRequested {
                        help_request: help_request.clone(),
                    },
                    EventBody::TaskStatusChanged {
                        task: updated,
                        from: task.status,
                        to: TaskStatus::AwaitingHuman,
                    },
                ],
            ))
        })
    }

    pub fn respond(
        &self,
        ctx: &RequestContext,
        id: &HelpRequestId,
        input: HelpResponseInput,
    ) -> Result<HelpRequest, OverseerError> {
        self.core.with_events(ctx, |store| {
            let help_request = store.help().respond(id, input)?;
            Ok((
                help_request.clone(),
                vec![EventBody::HelpResponded { help_request }],
            ))
        })
    }

    pub fn resume(&self, ctx: &RequestContext, task_id: &AnyTaskId) -> Result<Task, OverseerError> {
        self.core.with_events(ctx, |store| {
            let active = store.help().get_active(task_id)?;
            let Some(active) = active else {
                return Err(OverseerError::Help(crate::error::HelpError::HelpNotFound));
            };
            let task = store.help().resume(task_id)?;
            let refreshed = store.help().get(&active.id)?;
            let help_request = refreshed.unwrap_or(active);
            Ok((
                task.clone(),
                vec![EventBody::HelpResumed { task, help_request }],
            ))
        })
    }

    pub fn get_active(&self, task_id: &AnyTaskId) -> Result<Option<HelpRequest>, OverseerError> {
        self.core
            .store
            .help()
            .get_active(task_id)
            .map_err(OverseerError::from)
    }

    pub fn get(&self, id: &HelpRequestId) -> Result<Option<HelpRequest>, OverseerError> {
        self.core.store.help().get(id).map_err(OverseerError::from)
    }

    pub fn list(&self, task_id: &AnyTaskId) -> Result<Vec<HelpRequest>, OverseerError> {
        self.core
            .store
            .help()
            .list(task_id)
            .map_err(OverseerError::from)
    }
}

pub struct GatesApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> GatesApi<'a, S> {
    pub fn add(&self, ctx: &RequestContext, input: CreateGateInput) -> Result<Gate, OverseerError> {
        self.core.with_events(ctx, |store| {
            let gate = store.gates().add(input)?;
            Ok((gate.clone(), vec![EventBody::GateAdded { gate }]))
        })
    }

    pub fn list(&self, scope: &GateScope) -> Result<Vec<Gate>, OverseerError> {
        self.core
            .store
            .gates()
            .list(scope)
            .map_err(OverseerError::from)
    }

    pub fn effective(&self, task_id: &AnyTaskId) -> Result<Vec<Gate>, OverseerError> {
        self.core
            .store
            .gates()
            .get_effective(task_id)
            .map_err(OverseerError::from)
    }

    pub fn update(
        &self,
        ctx: &RequestContext,
        id: &GateId,
        input: UpdateGateInput,
    ) -> Result<Gate, OverseerError> {
        self.core.with_events(ctx, |store| {
            let gate = store.gates().update(id, input)?;
            Ok((gate.clone(), vec![EventBody::GateUpdated { gate }]))
        })
    }

    pub fn remove(&self, ctx: &RequestContext, id: &GateId) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            store.gates().remove(id)?;
            Ok((
                (),
                vec![EventBody::GateRemoved {
                    gate_id: id.clone(),
                }],
            ))
        })
    }

    pub fn results(&self, review_id: &ReviewId) -> Result<Vec<GateResult>, OverseerError> {
        self.core
            .store
            .gates()
            .get_results(review_id)
            .map_err(OverseerError::from)
    }

    pub fn rerun(&self, ctx: &RequestContext, review_id: &ReviewId) -> Result<(), OverseerError> {
        self.core.with_events(ctx, |store| {
            let review = store.reviews().get(review_id)?;
            let Some(review) = review else {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::ReviewNotFound,
                ));
            };
            if !matches!(
                review.status,
                ReviewStatus::GatesPending | ReviewStatus::GatesEscalated
            ) {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::InvalidTransition {
                        from: review.status,
                        to: ReviewStatus::GatesPending,
                    },
                ));
            }
            let task = store.tasks().get(&review.task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            let repo = store.repos().get(&task.repo_id)?;
            let Some(repo) = repo else {
                return Err(OverseerError::Repo(crate::error::RepoError::RepoNotFound));
            };

            let gates = store.gates().get_effective(&task.id)?;
            let prior_results = store.gates().get_results(review_id)?;
            let mut last_attempts = std::collections::HashMap::new();
            for result in prior_results {
                let entry = last_attempts
                    .entry(result.gate_id.clone())
                    .or_insert(result.clone());
                if entry.attempt < result.attempt {
                    *entry = result;
                }
            }

            let mut events = Vec::new();
            let mut results = Vec::new();

            for gate in &gates {
                events.push(EventBody::GateStarted {
                    gate_id: gate.id.clone(),
                    task_id: task.id.clone(),
                    review_id: review.id.clone(),
                });

                let attempt = match last_attempts.get(&gate.id) {
                    Some(last) if last.status == GateStatus::Pending => last.attempt,
                    Some(last) => last.attempt + 1,
                    None => 1,
                };

                let mut result = if attempt > gate.max_retries {
                    GateResult {
                        gate_id: gate.id.clone(),
                        task_id: task.id.clone(),
                        review_id: review.id.clone(),
                        status: GateStatus::Escalated,
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: None,
                        attempt,
                        started_at: Utc::now(),
                        completed_at: Some(Utc::now()),
                    }
                } else {
                    run_gate(gate, &task.id, &repo, &review.id, attempt)?
                };

                apply_gate_escalation(gate, &mut result);

                store.gates().record_result(result.clone())?;
                results.push(result.clone());
                match result.status {
                    GateStatus::Passed => events.push(EventBody::GatePassed {
                        gate_id: gate.id.clone(),
                        result,
                    }),
                    GateStatus::Escalated => events.push(EventBody::GateEscalated {
                        gate_id: gate.id.clone(),
                        result,
                    }),
                    GateStatus::Failed | GateStatus::Timeout => {
                        events.push(EventBody::GateFailed {
                            gate_id: gate.id.clone(),
                            result,
                        });
                    }
                    GateStatus::Pending | GateStatus::Running => {}
                }
            }

            let next_status = analyze_gate_results(&gates, &results);
            let _ = store.reviews().update_status(&review.id, next_status)?;

            Ok(((), events))
        })
    }

    pub fn poll_pending(&self, ctx: &RequestContext) -> Result<u32, OverseerError> {
        self.core.with_events(ctx, |store| {
            let reviews = store.reviews().list_by_status(ReviewStatus::GatesPending)?;
            let mut events = Vec::new();
            let mut updated = 0;

            for review in reviews {
                let results = store.gates().get_results(&review.id)?;
                let pending: Vec<GateResult> = results
                    .iter()
                    .filter(|result| result.status == GateStatus::Pending)
                    .cloned()
                    .collect();
                if pending.is_empty() {
                    continue;
                }

                let task = store.tasks().get(&review.task_id)?;
                let Some(task) = task else {
                    continue;
                };
                let repo = store.repos().get(&task.repo_id)?;
                let Some(repo) = repo else {
                    continue;
                };
                let gates = store.gates().get_effective(&task.id)?;

                let mut changed = false;
                for pending_result in pending {
                    let gate = store.gates().get(&pending_result.gate_id)?;
                    let Some(gate) = gate else {
                        continue;
                    };

                    let elapsed = Utc::now() - pending_result.started_at;
                    if elapsed.num_seconds() > i64::from(gate.max_pending_secs) {
                        let mut timeout = pending_result.clone();
                        timeout.status = GateStatus::Timeout;
                        timeout.completed_at = Some(Utc::now());
                        apply_gate_escalation(&gate, &mut timeout);
                        store.gates().record_result(timeout.clone())?;
                        events.push(EventBody::GateFailed {
                            gate_id: gate.id.clone(),
                            result: timeout,
                        });
                        changed = true;
                        continue;
                    }

                    let poll_interval =
                        chrono::Duration::seconds(i64::from(gate.poll_interval_secs));
                    if pending_result.started_at + poll_interval > Utc::now() {
                        continue;
                    }

                    events.push(EventBody::GateStarted {
                        gate_id: gate.id.clone(),
                        task_id: task.id.clone(),
                        review_id: review.id.clone(),
                    });

                    let mut result =
                        run_gate(&gate, &task.id, &repo, &review.id, pending_result.attempt)?;
                    apply_gate_escalation(&gate, &mut result);
                    store.gates().record_result(result.clone())?;
                    match result.status {
                        GateStatus::Passed => events.push(EventBody::GatePassed {
                            gate_id: gate.id.clone(),
                            result,
                        }),
                        GateStatus::Escalated => events.push(EventBody::GateEscalated {
                            gate_id: gate.id.clone(),
                            result,
                        }),
                        GateStatus::Failed | GateStatus::Timeout => {
                            events.push(EventBody::GateFailed {
                                gate_id: gate.id.clone(),
                                result,
                            });
                        }
                        GateStatus::Pending | GateStatus::Running => {}
                    }
                    changed = true;
                }

                if changed {
                    let refreshed = store.gates().get_results(&review.id)?;
                    let next_status = analyze_gate_results(&gates, &refreshed);
                    if next_status != review.status {
                        let _ = store.reviews().update_status(&review.id, next_status)?;
                        updated += 1;
                    }
                }
            }

            Ok((updated, events))
        })
    }
}

pub struct ReviewsApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> ReviewsApi<'a, S> {
    pub fn get(&self, id: &ReviewId) -> Result<Option<Review>, OverseerError> {
        self.core
            .store
            .reviews()
            .get(id)
            .map_err(OverseerError::from)
    }

    pub fn get_active_for_task(
        &self,
        task_id: &AnyTaskId,
    ) -> Result<Option<Review>, OverseerError> {
        self.core
            .store
            .reviews()
            .get_active_for_task(task_id)
            .map_err(OverseerError::from)
    }

    pub fn list_for_task(&self, task_id: &AnyTaskId) -> Result<Vec<Review>, OverseerError> {
        self.core
            .store
            .reviews()
            .list_for_task(task_id)
            .map_err(OverseerError::from)
    }

    pub fn add_comment(
        &self,
        ctx: &RequestContext,
        input: CreateCommentInput,
    ) -> Result<ReviewComment, OverseerError> {
        self.core.with_events(ctx, |store| {
            let comment = store.reviews().add_comment(input)?;
            Ok((comment.clone(), vec![EventBody::CommentAdded { comment }]))
        })
    }

    pub fn list_comments(&self, review_id: &ReviewId) -> Result<Vec<ReviewComment>, OverseerError> {
        self.core
            .store
            .reviews()
            .list_comments(review_id)
            .map_err(OverseerError::from)
    }

    pub fn resolve_comment(
        &self,
        ctx: &RequestContext,
        id: &CommentId,
    ) -> Result<ReviewComment, OverseerError> {
        self.core.with_events(ctx, |store| {
            let comment = store.reviews().resolve_comment(id)?;
            Ok((
                comment.clone(),
                vec![EventBody::CommentResolved { comment }],
            ))
        })
    }

    pub fn approve(&self, ctx: &RequestContext, id: &ReviewId) -> Result<Review, OverseerError> {
        self.core.with_events(ctx, |store| {
            let review = store.reviews().get(id)?;
            let Some(review) = review else {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::ReviewNotFound,
                ));
            };
            let next = match review.status {
                ReviewStatus::AgentPending => ReviewStatus::HumanPending,
                ReviewStatus::HumanPending => ReviewStatus::Approved,
                _ => {
                    return Err(OverseerError::Review(
                        crate::error::ReviewError::InvalidTransition {
                            from: review.status,
                            to: ReviewStatus::Approved,
                        },
                    ))
                }
            };
            let updated = store.reviews().update_status(id, next)?;
            let mut events = vec![EventBody::ReviewApproved {
                review: updated.clone(),
            }];
            if next == ReviewStatus::Approved {
                let task = store.tasks().get(&updated.task_id)?;
                if let Some(task) = task {
                    let completed_at = task.completed_at.or_else(|| Some(Utc::now()));
                    let updated_task = store.tasks().set_status(
                        &task.id,
                        TaskStatus::Completed,
                        None,
                        completed_at,
                    )?;
                    events.push(EventBody::TaskCompleted { task: updated_task });
                }
            }
            Ok((updated, events))
        })
    }

    pub fn request_changes(
        &self,
        ctx: &RequestContext,
        input: RequestChangesInput,
    ) -> Result<Review, OverseerError> {
        self.core.with_events(ctx, |store| {
            let review = store.reviews().get(&input.review_id)?;
            let Some(review) = review else {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::ReviewNotFound,
                ));
            };
            let updated = store
                .reviews()
                .update_status(&input.review_id, ReviewStatus::ChangesRequested)?;
            let mut comments = Vec::new();
            for comment_input in input.comments {
                comments.push(store.reviews().add_comment(comment_input)?);
            }
            let task = store.tasks().get(&review.task_id)?;
            let mut events = Vec::new();
            if let Some(task) = task {
                let updated_task =
                    store
                        .tasks()
                        .set_status(&task.id, TaskStatus::InProgress, None, None)?;
                events.push(EventBody::TaskStatusChanged {
                    task: updated_task,
                    from: task.status,
                    to: TaskStatus::InProgress,
                });
            }
            events.push(EventBody::ChangesRequested {
                review: updated.clone(),
                comments: comments.clone(),
            });
            Ok((updated, events))
        })
    }
}

pub struct VcsApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> VcsApi<'a, S> {
    pub fn get_task_vcs(&self, task_id: &AnyTaskId) -> Result<Option<TaskVcs>, OverseerError> {
        self.core
            .store
            .task_vcs()
            .get(task_id)
            .map_err(OverseerError::from)
    }

    pub fn list_task_vcs(&self, repo_id: &RepoId) -> Result<Vec<TaskVcs>, OverseerError> {
        self.core
            .store
            .task_vcs()
            .list(repo_id)
            .map_err(OverseerError::from)
    }

    pub fn archive(
        &self,
        ctx: &RequestContext,
        task_id: &AnyTaskId,
    ) -> Result<TaskVcs, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            if !matches!(task.status, TaskStatus::Completed | TaskStatus::Cancelled) {
                return Err(OverseerError::Task(TaskError::InvalidTransition {
                    from: task.status,
                    to: TaskStatus::Completed,
                }));
            }
            let task_vcs = store.task_vcs().get(task_id)?.ok_or_else(|| {
                OverseerError::Vcs(crate::error::VcsError::RefNotFound {
                    name: task_id.as_str().to_string(),
                })
            })?;
            let repo = store.repos().get(&task.repo_id)?;
            let Some(repo) = repo else {
                return Err(OverseerError::Repo(crate::error::RepoError::RepoNotFound));
            };
            match repo.vcs_type {
                VcsType::Jj => JjBackend::delete_ref(&repo.path, &task_vcs.ref_name)?,
                VcsType::Git => GitBackend::delete_ref(&repo.path, &task_vcs.ref_name)?,
            };
            let archived_at = Utc::now();
            let updated = store.task_vcs().set_archived(task_id, archived_at)?;
            Ok((
                updated.clone(),
                vec![EventBody::TaskArchived {
                    task_id: task_id.clone(),
                }],
            ))
        })
    }

    pub fn diff(&self, task_id: &AnyTaskId) -> Result<Diff, OverseerError> {
        let task_vcs = self.core.store.task_vcs().get(task_id)?.ok_or_else(|| {
            OverseerError::Vcs(crate::error::VcsError::RefNotFound {
                name: task_id.as_str().to_string(),
            })
        })?;
        let repo = self
            .core
            .store
            .repos()
            .get(&task_vcs.repo_id)?
            .ok_or_else(|| OverseerError::Repo(crate::error::RepoError::RepoNotFound))?;
        let diff = match repo.vcs_type {
            VcsType::Jj => JjBackend::diff_range(
                &repo.path,
                &task_vcs.base_commit,
                &task_vcs
                    .head_commit
                    .clone()
                    .unwrap_or_else(|| task_vcs.base_commit.clone()),
            )?,
            VcsType::Git => GitBackend::diff_range(
                &repo.path,
                &task_vcs.base_commit,
                &task_vcs
                    .head_commit
                    .clone()
                    .unwrap_or_else(|| task_vcs.base_commit.clone()),
            )?,
        };
        Ok(parse_unified_diff(diff.base, diff.head, diff.unified))
    }
}

pub struct SessionsApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> SessionsApi<'a, S> {
    pub fn register_harness(
        &self,
        ctx: &RequestContext,
        harness_id: String,
        capabilities: Vec<String>,
    ) -> Result<Harness, OverseerError> {
        self.core.with_events(ctx, |store| {
            let harness = store
                .harnesses()
                .register(harness_id.clone(), capabilities)?;
            Ok((
                harness.clone(),
                vec![EventBody::HarnessConnected { harness_id }],
            ))
        })
    }

    pub fn list_harnesses(&self) -> Result<Vec<Harness>, OverseerError> {
        self.core
            .store
            .harnesses()
            .list()
            .map_err(OverseerError::from)
    }

    pub fn set_harness_connected(
        &self,
        ctx: &RequestContext,
        harness_id: &str,
        connected: bool,
    ) -> Result<Harness, OverseerError> {
        self.core.with_events(ctx, |store| {
            let harness = store.harnesses().set_connected(harness_id, connected)?;
            let event = if connected {
                EventBody::HarnessConnected {
                    harness_id: harness.id.clone(),
                }
            } else {
                EventBody::HarnessDisconnected {
                    harness_id: harness.id.clone(),
                }
            };
            Ok((harness.clone(), vec![event]))
        })
    }

    pub fn start_session(
        &self,
        ctx: &RequestContext,
        task_id: &AnyTaskId,
        harness_id: String,
    ) -> Result<Session, OverseerError> {
        self.core.with_events(ctx, |store| {
            let task = store.tasks().get(task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            let _ = store.harnesses().get(&harness_id)?;
            if let Some(active) = store.sessions().get_active_for_task(&task.id)? {
                if matches!(
                    active.status,
                    SessionStatus::Pending | SessionStatus::Active
                ) {
                    return Err(OverseerError::Task(TaskError::Conflict {
                        message: "session already active for task".to_string(),
                    }));
                }
            }
            let session = store.sessions().create(&task.id, harness_id.clone())?;
            Ok((
                session.clone(),
                vec![EventBody::SessionStarted {
                    session_id: session.id.clone(),
                    task_id: task.id.clone(),
                    harness_id,
                }],
            ))
        })
    }

    pub fn heartbeat(
        &self,
        ctx: &RequestContext,
        session_id: &str,
    ) -> Result<Session, OverseerError> {
        self.core.with_events(ctx, |store| {
            let session = store.sessions().heartbeat(session_id)?;
            Ok((session.clone(), Vec::new()))
        })
    }

    pub fn complete(
        &self,
        ctx: &RequestContext,
        session_id: &str,
        status: SessionStatus,
        error: Option<String>,
    ) -> Result<Session, OverseerError> {
        self.core.with_events(ctx, |store| {
            let session = store
                .sessions()
                .complete(session_id, status, error.clone())?;
            let event = match status {
                SessionStatus::Completed => EventBody::SessionCompleted {
                    session_id: session.id.clone(),
                },
                SessionStatus::Failed => EventBody::SessionFailed {
                    session_id: session.id.clone(),
                    error: error.unwrap_or_else(|| "session failed".to_string()),
                },
                SessionStatus::Cancelled => EventBody::SessionFailed {
                    session_id: session.id.clone(),
                    error: "session cancelled".to_string(),
                },
                SessionStatus::Pending | SessionStatus::Active => EventBody::SessionFailed {
                    session_id: session.id.clone(),
                    error: "invalid completion state".to_string(),
                },
            };
            Ok((session.clone(), vec![event]))
        })
    }
}

pub struct GitAiApi<'a, S: Store> {
    core: &'a Overseer<S>,
}

impl<'a, S: Store> GitAiApi<'a, S> {
    pub fn review(
        &self,
        ctx: &RequestContext,
        review_id: &ReviewId,
    ) -> Result<GitAiReview, OverseerError> {
        let diff = {
            let review = self.core.store.reviews().get(review_id)?;
            let Some(review) = review else {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::ReviewNotFound,
                ));
            };
            let task_id = review.task_id.clone();
            self.core.vcs().diff(&task_id)?
        };

        self.core.with_events(ctx, |store| {
            let existing = store.git_ai().get(review_id)?;
            if let Some(existing) = existing {
                return Ok((existing, Vec::new()));
            }

            let review = store.reviews().get(review_id)?;
            let Some(review) = review else {
                return Err(OverseerError::Review(
                    crate::error::ReviewError::ReviewNotFound,
                ));
            };
            let task = store.tasks().get(&review.task_id)?;
            let Some(task) = task else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            let task_with_context = store.tasks().get_with_context(&task.id)?;
            let Some(task_with_context) = task_with_context else {
                return Err(OverseerError::Task(TaskError::NotFound));
            };
            let gate_results = store.gates().get_results(review_id)?;

            let input = GitAiReviewInput {
                task_id: task.id.clone(),
                review_id: review.id.clone(),
                diff: diff.clone(),
                task_context: task_with_context.context,
                learnings: task_with_context.learnings,
                gate_results,
            };

            let mut events = vec![EventBody::GitAiStarted {
                task_id: task.id.clone(),
                review_id: review.id.clone(),
            }];

            let record = store.git_ai().create(input)?;

            let output = match run_git_ai_provider(&record.input) {
                Ok(output) => output,
                Err(err) => {
                    let failed = store.git_ai().set_failed(review_id, err.to_string())?;
                    events.push(EventBody::GitAiFailed {
                        task_id: task.id.clone(),
                        review_id: review.id.clone(),
                        error: err.to_string(),
                    });
                    return Ok((failed, events));
                }
            };

            let decision = output.decision;
            let record = store.git_ai().set_result(review_id, output.clone())?;

            match decision {
                ReviewDecision::Approve => {
                    let _ = store
                        .reviews()
                        .update_status(review_id, ReviewStatus::HumanPending)?;
                }
                ReviewDecision::RequestChanges => {
                    let updated = store
                        .reviews()
                        .update_status(review_id, ReviewStatus::ChangesRequested)?;
                    let mut comments = Vec::new();
                    for comment in output.comments {
                        comments.push(store.reviews().add_comment(comment)?);
                    }
                    let updated_task =
                        store
                            .tasks()
                            .set_status(&task.id, TaskStatus::InProgress, None, None)?;
                    events.push(EventBody::TaskStatusChanged {
                        task: updated_task,
                        from: task.status,
                        to: TaskStatus::InProgress,
                    });
                    events.push(EventBody::ChangesRequested {
                        review: updated,
                        comments,
                    });
                }
            }

            events.push(EventBody::GitAiCompleted {
                task_id: task.id.clone(),
                review_id: review.id.clone(),
            });

            Ok((record, events))
        })
    }

    pub fn get(&self, review_id: &ReviewId) -> Result<Option<GitAiReview>, OverseerError> {
        self.core
            .store
            .git_ai()
            .get(review_id)
            .map_err(OverseerError::from)
    }

    pub fn result(&self, review_id: &ReviewId) -> Result<Option<GitAiReviewOutput>, OverseerError> {
        let record = self.core.store.git_ai().get(review_id)?;
        Ok(record.and_then(|value| value.output))
    }
}

fn build_event_record(ctx: &RequestContext, body: EventBody) -> Result<EventRecord, OverseerError> {
    let value = serde_json::to_value(body).map_err(|err| OverseerError::Internal {
        message: err.to_string(),
    })?;
    Ok(EventRecord {
        id: String::new(),
        seq: 0,
        at: Utc::now(),
        correlation_id: ctx.correlation_id.clone(),
        source: ctx.source,
        body: value,
    })
}

fn is_effectively_blocked(task: &Task, tasks: &[Task]) -> bool {
    let mut by_id = std::collections::HashMap::new();
    for item in tasks {
        by_id.insert(item.id.as_str(), item);
    }
    let mut current = Some(task.id.as_str());
    while let Some(id) = current {
        let Some(current_task) = by_id.get(id) else {
            break;
        };
        for blocker in &current_task.blocked_by {
            if let Some(blocker_task) = by_id.get(blocker.as_str()) {
                if !matches!(
                    blocker_task.status,
                    TaskStatus::Completed | TaskStatus::Cancelled
                ) {
                    return true;
                }
            } else {
                return true;
            }
        }
        current = current_task.parent_id.as_ref().map(AnyTaskId::as_str);
    }
    false
}

fn parse_unified_diff(base: String, head: String, unified: String) -> Diff {
    let mut files: Vec<DiffFile> = Vec::new();
    let mut current_file: Option<DiffFile> = None;
    let mut current_hunk: Option<DiffHunk> = None;

    let flush_hunk = |file: &mut Option<DiffFile>, hunk: &mut Option<DiffHunk>| {
        if let Some(h) = hunk.take() {
            if let Some(f) = file.as_mut() {
                f.hunks.push(h);
            }
        }
    };

    let flush_file = |files: &mut Vec<DiffFile>, file: &mut Option<DiffFile>| {
        if let Some(f) = file.take() {
            files.push(f);
        }
    };

    for line in unified.lines() {
        if line.starts_with("diff --git ") {
            flush_hunk(&mut current_file, &mut current_hunk);
            flush_file(&mut files, &mut current_file);
            let path = parse_diff_path(line).unwrap_or_else(|| "unknown".to_string());
            current_file = Some(DiffFile {
                path,
                hunks: Vec::new(),
            });
            continue;
        }

        if line.starts_with("@@ ") {
            flush_hunk(&mut current_file, &mut current_hunk);
            if let Some((hunk, header)) = parse_hunk_header(line) {
                current_hunk = Some(DiffHunk {
                    old_start: hunk.0,
                    old_lines: hunk.1,
                    new_start: hunk.2,
                    new_lines: hunk.3,
                    header,
                    lines: Vec::new(),
                });
            }
            continue;
        }

        if let Some(hunk) = current_hunk.as_mut() {
            if let Some((kind, content)) = parse_diff_line(line) {
                hunk.lines.push(DiffLine { kind, content });
            }
        }
    }

    flush_hunk(&mut current_file, &mut current_hunk);
    flush_file(&mut files, &mut current_file);

    Diff {
        base,
        head,
        unified,
        files,
    }
}

fn apply_gate_escalation(gate: &Gate, result: &mut GateResult) {
    let decision = result_decision(result);
    if matches!(decision, GateRunDecision::Failed | GateRunDecision::Timeout)
        && result.attempt >= gate.max_retries
    {
        result.status = GateStatus::Escalated;
    }
}

fn analyze_gate_results(gates: &[Gate], results: &[GateResult]) -> ReviewStatus {
    let latest = latest_gate_results(results);
    let mut any_pending = false;
    let mut any_retryable_failure = false;
    let mut any_escalated = false;

    for gate in gates {
        let Some(result) = latest.get(&gate.id) else {
            any_pending = true;
            continue;
        };
        match result.status {
            GateStatus::Passed => {}
            GateStatus::Pending | GateStatus::Running => {
                any_pending = true;
            }
            GateStatus::Escalated => {
                any_escalated = true;
            }
            GateStatus::Failed | GateStatus::Timeout => {
                if result.attempt >= gate.max_retries {
                    any_escalated = true;
                } else {
                    any_retryable_failure = true;
                }
            }
        }
    }

    if any_escalated {
        ReviewStatus::GatesEscalated
    } else if any_pending || any_retryable_failure {
        ReviewStatus::GatesPending
    } else {
        ReviewStatus::AgentPending
    }
}

fn latest_gate_results(results: &[GateResult]) -> HashMap<GateId, GateResult> {
    let mut map = HashMap::new();
    for result in results {
        let entry = map
            .entry(result.gate_id.clone())
            .or_insert_with(|| result.clone());
        if result.attempt > entry.attempt
            || (result.attempt == entry.attempt && result.started_at > entry.started_at)
        {
            *entry = result.clone();
        }
    }
    map
}

fn run_git_ai_provider(_input: &GitAiReviewInput) -> Result<GitAiReviewOutput, OverseerError> {
    let mode = std::env::var("OVERSEER_GIT_AI_MODE").unwrap_or_else(|_| "stub".to_string());
    if mode == "disabled" {
        return Err(OverseerError::GitAi(
            crate::error::GitAiError::ProviderUnavailable,
        ));
    }

    let summary = Some("git-ai stub review".to_string());
    Ok(GitAiReviewOutput {
        decision: ReviewDecision::Approve,
        comments: Vec::new(),
        summary,
    })
}

fn parse_diff_path(line: &str) -> Option<String> {
    let mut parts = line.split_whitespace();
    let _diff = parts.next()?;
    let _git = parts.next()?;
    let _a = parts.next()?;
    let b = parts.next()?;
    Some(b.trim_start_matches("b/").to_string())
}

fn parse_hunk_header(line: &str) -> Option<((u32, u32, u32, u32), String)> {
    let trimmed = line.strip_prefix("@@ ")?;
    let mut parts = trimmed.split(" @@");
    let ranges = parts.next()?.trim();
    let header = parts.next().unwrap_or("").trim().to_string();
    let mut range_parts = ranges.split_whitespace();
    let old_range = range_parts.next()?;
    let new_range = range_parts.next()?;
    let (old_start, old_lines) = parse_range(old_range);
    let (new_start, new_lines) = parse_range(new_range);
    Some(((old_start, old_lines, new_start, new_lines), header))
}

fn parse_range(value: &str) -> (u32, u32) {
    let trimmed = value.trim();
    let trimmed = trimmed.trim_start_matches(['-', '+']);
    let mut parts = trimmed.split(',');
    let start = parts
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let lines = parts
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1);
    (start, lines)
}

fn parse_diff_line(line: &str) -> Option<(DiffLineKind, String)> {
    let mut chars = line.chars();
    let kind = match chars.next()? {
        '+' => DiffLineKind::Add,
        '-' => DiffLineKind::Remove,
        ' ' => DiffLineKind::Context,
        _ => return None,
    };
    Some((kind, chars.collect()))
}
