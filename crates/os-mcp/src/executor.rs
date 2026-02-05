use crate::protocol::{McpError, McpRequest, McpResponse};
use os_core::types::io::{
    CreateCommentInput, CreateGateInput, CreateHelpRequestInput, CreateTaskInput,
    HelpResponseInput, RequestChangesInput, TaskFilter, UpdateGateInput, UpdateTaskInput,
};
use os_core::types::{
    AnyTaskId, CommentId, GateId, GateScope, HelpRequestId, MilestoneId, RepoId, ReviewId,
    TaskStatus,
};
use os_core::{Overseer, OverseerError, RequestContext};
use os_db::schema;
use os_db::store::DbStore;
use os_events::bus::EventBus;
use os_events::types::EventSource;
use rquickjs::{Context, Function, Object, Promise, Runtime, Value};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::cell::RefCell;
use std::io::{self, Read, Write};
use std::path::Path;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
struct ExecuteParams {
    code: String,
    timeout_ms: Option<u64>,
    correlation_id: Option<String>,
}

pub fn run_stdio() {
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    if input.trim().is_empty() {
        return;
    }
    let response = match serde_json::from_str::<McpRequest>(&input) {
        Ok(request) => handle_request(request),
        Err(err) => McpResponse::error("unknown".to_string(), "invalid_params", err.to_string()),
    };
    let _ = io::stdout().write_all(response.to_json().as_bytes());
}

fn handle_request(request: McpRequest) -> McpResponse {
    if request.method != "execute" {
        return McpResponse::error(request.id, "invalid_params", "unknown method".to_string());
    }
    let params: ExecuteParams = match serde_json::from_value(request.params) {
        Ok(params) => params,
        Err(err) => return McpResponse::error(request.id, "invalid_params", err.to_string()),
    };

    let timeout = Duration::from_millis(params.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let result = execute_js(&params.code, timeout, params.correlation_id);
    match result {
        Ok(value) => McpResponse::ok(request.id, value),
        Err(err) => McpResponse {
            id: request.id,
            result: None,
            error: Some(err),
        },
    }
}

fn execute_js(
    code: &str,
    timeout: Duration,
    correlation_id: Option<String>,
) -> Result<JsonValue, McpError> {
    let runtime = Runtime::new().map_err(|err| McpError {
        code: "js_runtime_error".to_string(),
        message: err.to_string(),
        data: None,
    })?;
    let ctx = Context::full(&runtime).map_err(|err| McpError {
        code: "js_runtime_error".to_string(),
        message: err.to_string(),
        data: None,
    })?;

    let timed_out = Arc::new(AtomicBool::new(false));
    let deadline = Instant::now() + timeout;
    let timed_out_flag = timed_out.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        if Instant::now() >= deadline {
            timed_out_flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    })));

    let logs: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    let logs_handle = logs.clone();
    let code = code.to_string();
    let result = ctx.with(|ctx| {
        let globals = ctx.globals();
        let log_fn = Function::new(ctx.clone(), move |message: String| {
            logs_handle.borrow_mut().push(message);
        })
        .map_err(to_mcp_error("js_runtime_error"))?;
        globals
            .set("__os_log", log_fn)
            .map_err(to_mcp_error("js_runtime_error"))?;

        let correlation_id = correlation_id.clone();
        let call_fn = Function::new(ctx.clone(), move |method: String, payload: String| {
            let args: Vec<JsonValue> = serde_json::from_str(&payload).unwrap_or_default();
            let response = match call_sdk(&method, args, correlation_id.clone()) {
                Ok(value) => json_success(value),
                Err(err) => json_error(err),
            };
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string())
        })
        .map_err(to_mcp_error("js_runtime_error"))?;
        globals
            .set("__os_call_raw", call_fn)
            .map_err(to_mcp_error("js_runtime_error"))?;

        ctx.eval::<(), _>(BOOTSTRAP)
            .map_err(to_mcp_error("js_runtime_error"))?;

        let value: Value = ctx.eval(code).map_err(to_mcp_error("js_runtime_error"))?;
        let value = if value.is_promise() {
            let promise = Promise::from_value(value).map_err(to_mcp_error("js_runtime_error"))?;
            promise
                .finish::<Value>()
                .map_err(to_mcp_error("js_runtime_error"))?
        } else {
            value
        };

        let json = stringify_value(ctx, value)?;
        Ok::<JsonValue, McpError>(json)
    });

    if timed_out.load(Ordering::Relaxed) {
        return Err(McpError {
            code: "timeout".to_string(),
            message: "execution timed out".to_string(),
            data: None,
        });
    }

    result.map(|value| {
        serde_json::json!({
            "ok": true,
            "value": value,
            "logs": logs.borrow().clone()
        })
    })
}

fn stringify_value<'js>(ctx: rquickjs::Ctx<'js>, value: Value<'js>) -> Result<JsonValue, McpError> {
    let json: Object = ctx
        .globals()
        .get("JSON")
        .map_err(to_mcp_error("js_runtime_error"))?;
    let stringify: Function = json
        .get("stringify")
        .map_err(to_mcp_error("js_runtime_error"))?;
    let json_value: Value = stringify
        .call((value,))
        .map_err(to_mcp_error("js_runtime_error"))?;
    if json_value.is_null() || json_value.is_undefined() {
        return Ok(JsonValue::Null);
    }
    let json_str = json_value
        .as_string()
        .ok_or_else(|| McpError {
            code: "js_runtime_error".to_string(),
            message: "expected JSON string".to_string(),
            data: None,
        })?
        .to_string()
        .map_err(to_mcp_error("js_runtime_error"))?;
    serde_json::from_str(&json_str).map_err(|err| McpError {
        code: "js_runtime_error".to_string(),
        message: err.to_string(),
        data: None,
    })
}

fn call_sdk(
    method: &str,
    args: Vec<JsonValue>,
    correlation_id: Option<String>,
) -> Result<JsonValue, OverseerError> {
    let overseer = build_overseer()?;
    let ctx = RequestContext::new(EventSource::Mcp, correlation_id);
    match method {
        "tasks.create" => {
            let input: CreateTaskInput = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().create(&ctx, input)?)?)
        }
        "tasks.get" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().get(&id)?)?)
        }
        "tasks.list" => {
            let filter: TaskFilter = arg_or_default(&args, 0, default_task_filter())?;
            Ok(to_json(overseer.tasks().list(filter)?)?)
        }
        "tasks.update" => {
            let id: AnyTaskId = arg(&args, 0)?;
            let input: UpdateTaskInput = arg(&args, 1)?;
            Ok(to_json(overseer.tasks().update(&ctx, &id, input)?)?)
        }
        "tasks.delete" => {
            let id: AnyTaskId = arg(&args, 0)?;
            overseer.tasks().delete(&ctx, &id)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "tasks.start" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().start(&ctx, &id)?)?)
        }
        "tasks.submit" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().submit(&ctx, &id)?)?)
        }
        "tasks.cancel" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().cancel(&ctx, &id)?)?)
        }
        "tasks.force_complete" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.tasks().force_complete(&ctx, &id)?)?)
        }
        "tasks.set_status" => {
            let id: AnyTaskId = arg(&args, 0)?;
            let status: TaskStatus = arg(&args, 1)?;
            Ok(to_json(overseer.tasks().set_status(&ctx, &id, status)?)?)
        }
        "tasks.block" => {
            let id: AnyTaskId = arg(&args, 0)?;
            let blocker: AnyTaskId = arg(&args, 1)?;
            overseer.tasks().add_blocker(&ctx, &id, &blocker)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "tasks.unblock" => {
            let id: AnyTaskId = arg(&args, 0)?;
            let blocker: AnyTaskId = arg(&args, 1)?;
            overseer.tasks().remove_blocker(&ctx, &id, &blocker)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "tasks.tree" => {
            let root: Option<AnyTaskId> = arg_optional(&args, 0)?;
            Ok(to_json(overseer.tasks().tree(root.as_ref())?)?)
        }
        "tasks.progress" => {
            let repo_id: RepoId = arg(&args, 0)?;
            let root: Option<AnyTaskId> = arg_optional(&args, 1)?;
            Ok(to_json(
                overseer.tasks().progress(&repo_id, root.as_ref())?,
            )?)
        }
        "tasks.next_ready" => {
            let repo_id: RepoId = arg(&args, 0)?;
            let milestone: Option<MilestoneId> = arg_optional(&args, 1)?;
            Ok(to_json(
                overseer.tasks().next_ready(&repo_id, milestone.as_ref())?,
            )?)
        }
        "reviews.get" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().get(&id)?)?)
        }
        "reviews.get_active" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().get_active_for_task(&id)?)?)
        }
        "reviews.list" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().list_for_task(&id)?)?)
        }
        "reviews.comment" => {
            let input: CreateCommentInput = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().add_comment(&ctx, input)?)?)
        }
        "reviews.list_comments" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().list_comments(&id)?)?)
        }
        "reviews.resolve_comment" => {
            let id: CommentId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().resolve_comment(&ctx, &id)?)?)
        }
        "reviews.approve" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().approve(&ctx, &id)?)?)
        }
        "reviews.request_changes" => {
            let input: RequestChangesInput = arg(&args, 0)?;
            Ok(to_json(overseer.reviews().request_changes(&ctx, input)?)?)
        }
        "gates.add" => {
            let input: CreateGateInput = arg(&args, 0)?;
            Ok(to_json(overseer.gates().add(&ctx, input)?)?)
        }
        "gates.list" => {
            let scope: GateScope = arg(&args, 0)?;
            Ok(to_json(overseer.gates().list(&scope)?)?)
        }
        "gates.get_effective" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.gates().effective(&id)?)?)
        }
        "gates.remove" => {
            let id: GateId = arg(&args, 0)?;
            overseer.gates().remove(&ctx, &id)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "gates.update" => {
            let id: GateId = arg(&args, 0)?;
            let input: UpdateGateInput = arg(&args, 1)?;
            Ok(to_json(overseer.gates().update(&ctx, &id, input)?)?)
        }
        "gates.results" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.gates().results(&id)?)?)
        }
        "gates.rerun" => {
            let id: ReviewId = arg(&args, 0)?;
            overseer.gates().rerun(&ctx, &id)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "help.request" => {
            let input: CreateHelpRequestInput = arg(&args, 0)?;
            Ok(to_json(overseer.help().request(&ctx, input)?)?)
        }
        "help.respond" => {
            let id: HelpRequestId = arg(&args, 0)?;
            let input: HelpResponseInput = arg(&args, 1)?;
            Ok(to_json(overseer.help().respond(&ctx, &id, input)?)?)
        }
        "help.resume" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.help().resume(&ctx, &id)?)?)
        }
        "help.get_active" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.help().get_active(&id)?)?)
        }
        "help.list" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.help().list(&id)?)?)
        }
        "learnings.add" => {
            let id: AnyTaskId = arg(&args, 0)?;
            let content: String = arg(&args, 1)?;
            Ok(to_json(overseer.learnings().add(&ctx, &id, content)?)?)
        }
        "learnings.list" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.learnings().list(&id)?)?)
        }
        "learnings.get_inherited" => {
            let id: AnyTaskId = arg(&args, 0)?;
            Ok(to_json(overseer.learnings().inherited(&id)?)?)
        }
        "repos.register" => {
            let path: String = arg(&args, 0)?;
            Ok(to_json(overseer.repos().register(&ctx, path.into())?)?)
        }
        "repos.get" => {
            let id: RepoId = arg(&args, 0)?;
            Ok(to_json(overseer.repos().get(&id)?)?)
        }
        "repos.get_by_path" => {
            let path: String = arg(&args, 0)?;
            Ok(to_json(overseer.repos().get_by_path(Path::new(&path))?)?)
        }
        "repos.list" => Ok(to_json(overseer.repos().list()?)?),
        "repos.unregister" => {
            let id: RepoId = arg(&args, 0)?;
            overseer.repos().unregister(&ctx, &id)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "events.list" => {
            let after: Option<i64> = arg_optional(&args, 0)?;
            let limit: Option<u32> = arg_optional(&args, 1)?;
            Ok(to_json(overseer.events().list(after, limit)?)?)
        }
        "events.replay" => {
            let after: Option<i64> = arg_optional(&args, 0)?;
            let limit: Option<u32> = arg_optional(&args, 1)?;
            Ok(to_json(overseer.events().replay(after, limit)?)?)
        }
        "git_ai.review" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.git_ai().review(&ctx, &id)?)?)
        }
        "git_ai.get" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.git_ai().get(&id)?)?)
        }
        "git_ai.result" => {
            let id: ReviewId = arg(&args, 0)?;
            Ok(to_json(overseer.git_ai().result(&id)?)?)
        }
        _ => Err(OverseerError::Task(
            os_core::error::TaskError::InvalidInput {
                message: format!("unknown method: {method}"),
            },
        )),
    }
}

fn build_overseer() -> Result<Overseer<DbStore>, OverseerError> {
    let db_path =
        std::env::var("OVERSEER_DB_PATH").unwrap_or_else(|_| ".overseer/tasks.db".to_string());
    if let Some(parent) = Path::new(&db_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = schema::open_and_migrate(&db_path).map_err(|err| OverseerError::Internal {
        message: err.to_string(),
    })?;
    let store = DbStore::new(conn);
    Ok(Overseer::new(store, EventBus::new(256)))
}

fn to_json<T: Serialize>(value: T) -> Result<JsonValue, OverseerError> {
    serde_json::to_value(value).map_err(|err| OverseerError::Internal {
        message: err.to_string(),
    })
}

fn arg<T: DeserializeOwned>(args: &[JsonValue], index: usize) -> Result<T, OverseerError> {
    let value = args.get(index).cloned().ok_or_else(|| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: format!("missing arg {index}"),
        })
    })?;
    serde_json::from_value(value).map_err(|err| {
        OverseerError::Task(os_core::error::TaskError::InvalidInput {
            message: err.to_string(),
        })
    })
}

fn arg_optional<T: DeserializeOwned>(
    args: &[JsonValue],
    index: usize,
) -> Result<Option<T>, OverseerError> {
    let Some(value) = args.get(index) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|err| {
            OverseerError::Task(os_core::error::TaskError::InvalidInput {
                message: err.to_string(),
            })
        })
}

fn arg_or_default<T: DeserializeOwned>(
    args: &[JsonValue],
    index: usize,
    default: T,
) -> Result<T, OverseerError> {
    match arg_optional(args, index)? {
        Some(value) => Ok(value),
        None => Ok(default),
    }
}

fn default_task_filter() -> TaskFilter {
    TaskFilter {
        repo_id: None,
        parent_id: None,
        kind: None,
        status: None,
        ready: None,
        archived: None,
    }
}

fn json_success(value: JsonValue) -> JsonValue {
    serde_json::json!({ "ok": true, "value": value })
}

fn json_error(err: OverseerError) -> JsonValue {
    serde_json::json!({
        "ok": false,
        "error": {
            "code": "sdk_error",
            "message": err.to_string(),
            "tag": error_tag(&err)
        }
    })
}

fn error_tag(err: &OverseerError) -> &'static str {
    match err {
        OverseerError::Task(_) => "task_error",
        OverseerError::Review(_) => "review_error",
        OverseerError::Gate(_) => "gate_error",
        OverseerError::Help(_) => "help_error",
        OverseerError::Learning(_) => "learning_error",
        OverseerError::Repo(_) => "repo_error",
        OverseerError::Vcs(_) => "vcs_error",
        OverseerError::GitAi(_) => "git_ai_error",
        OverseerError::Internal { .. } => "internal_error",
    }
}

fn to_mcp_error(code: &'static str) -> impl FnOnce(rquickjs::Error) -> McpError {
    move |err| McpError {
        code: code.to_string(),
        message: err.to_string(),
        data: None,
    }
}

const BOOTSTRAP: &str = r#"
globalThis.__os_call = function(method, ...args) {
  const raw = __os_call_raw(method, JSON.stringify(args));
  const res = JSON.parse(raw || "{}");
  if (!res.ok) {
    const err = new Error(res.error && res.error.message ? res.error.message : "sdk error");
    err.code = res.error && res.error.code ? res.error.code : "sdk_error";
    err.tag = res.error && res.error.tag ? res.error.tag : "sdk_error";
    throw err;
  }
  return res.value;
};

globalThis.console = {
  log: (...args) => {
    const msg = args
      .map((value) => {
        if (typeof value === "string") return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      })
      .join(" ");
    __os_log(msg);
  }
};

globalThis.tasks = {
  create: (input) => __os_call("tasks.create", input),
  get: (id) => __os_call("tasks.get", id),
  list: (filter) => __os_call("tasks.list", filter),
  update: (id, input) => __os_call("tasks.update", id, input),
  delete: (id) => __os_call("tasks.delete", id),
  start: (id) => __os_call("tasks.start", id),
  submit: (id) => __os_call("tasks.submit", id),
  cancel: (id) => __os_call("tasks.cancel", id),
  forceComplete: (id) => __os_call("tasks.force_complete", id),
  setStatus: (id, status) => __os_call("tasks.set_status", id, status),
  block: (id, blockerId) => __os_call("tasks.block", id, blockerId),
  unblock: (id, blockerId) => __os_call("tasks.unblock", id, blockerId),
  tree: (rootId) => __os_call("tasks.tree", rootId),
  progress: (repoId, rootId) => __os_call("tasks.progress", repoId, rootId),
  nextReady: (repoId, milestoneId) => __os_call("tasks.next_ready", repoId, milestoneId)
};

globalThis.reviews = {
  get: (id) => __os_call("reviews.get", id),
  getActive: (taskId) => __os_call("reviews.get_active", taskId),
  list: (taskId) => __os_call("reviews.list", taskId),
  comment: (input) => __os_call("reviews.comment", input),
  listComments: (reviewId) => __os_call("reviews.list_comments", reviewId),
  resolveComment: (commentId) => __os_call("reviews.resolve_comment", commentId),
  approve: (reviewId) => __os_call("reviews.approve", reviewId),
  requestChanges: (input) => __os_call("reviews.request_changes", input)
};

globalThis.gates = {
  add: (input) => __os_call("gates.add", input),
  list: (scope) => __os_call("gates.list", scope),
  effective: (taskId) => __os_call("gates.get_effective", taskId),
  remove: (gateId) => __os_call("gates.remove", gateId),
  update: (gateId, input) => __os_call("gates.update", gateId, input),
  results: (reviewId) => __os_call("gates.results", reviewId),
  rerun: (reviewId) => __os_call("gates.rerun", reviewId)
};

globalThis.help = {
  request: (input) => __os_call("help.request", input),
  respond: (id, input) => __os_call("help.respond", id, input),
  resume: (taskId) => __os_call("help.resume", taskId),
  getActive: (taskId) => __os_call("help.get_active", taskId),
  list: (taskId) => __os_call("help.list", taskId)
};

globalThis.learnings = {
  add: (taskId, content) => __os_call("learnings.add", taskId, content),
  list: (taskId) => __os_call("learnings.list", taskId),
  inherited: (taskId) => __os_call("learnings.get_inherited", taskId)
};

globalThis.repos = {
  register: (path) => __os_call("repos.register", path),
  get: (id) => __os_call("repos.get", id),
  getByPath: (path) => __os_call("repos.get_by_path", path),
  list: () => __os_call("repos.list"),
  unregister: (id) => __os_call("repos.unregister", id)
};

globalThis.events = {
  list: (after, limit) => __os_call("events.list", after, limit),
  replay: (after, limit) => __os_call("events.replay", after, limit)
};

globalThis.gitAi = {
  review: (reviewId) => __os_call("git_ai.review", reviewId),
  get: (reviewId) => __os_call("git_ai.get", reviewId),
  result: (reviewId) => __os_call("git_ai.result", reviewId)
};
"#;
