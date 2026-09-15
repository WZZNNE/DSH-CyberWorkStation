"""Build machine-readable draft contracts; does not install or run a service."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec"


def obj(properties, required=(), description=None):
    out = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        out["required"] = list(required)
    if description:
        out["description"] = description
    return out


def ref(name):
    return {"$ref": "#/components/schemas/" + name}


def arr(items):
    return {"type": "array", "items": items}


S = {"type": "string", "minLength": 1}
I = {"type": "integer", "minimum": 0}
D = {"type": "string", "format": "date-time"}
nullable_date = {"type": ["string", "null"], "format": "date-time"}
kind = {"type": "string", "enum": ["constraint", "goal", "preference", "fact", "decision", "procedure", "work_state", "hypothesis"]}
operation = {"type": "string", "enum": ["ASSERT", "AMEND", "REPLACE", "REVOKE", "EXCEPT", "CORRECT", "ARCHIVE", "ERASE"]}
schemas = {}
schemas["Error"] = obj({"code": S, "message": S, "retryable": {"type": "boolean"}}, ["code", "message", "retryable"])
schemas["EvidenceRef"] = obj({"event_id": S, "quote": {"type": "string", "maxLength": 4000}}, ["event_id"])
schemas["Epoch"] = obj({"scope_id": S, "policy_epoch": I, "data_epoch": I, "acl_epoch": I}, ["scope_id", "policy_epoch", "data_epoch", "acl_epoch"])
schemas["VersionRef"] = obj({"memory_id": S, "revision": {"type": "integer", "minimum": 1}}, ["memory_id", "revision"])
schemas["SourceRef"] = obj({"event_id": S, "source_type": S}, ["event_id", "source_type"])
schemas["RelationRef"] = obj({"type": {"type": "string", "enum": ["replaces", "exception_to", "derived_from", "depends_on"]}, "target_id": S, "target_revision": {"type": "integer", "minimum": 1}}, ["type", "target_id", "target_revision"])
schemas["Memory"] = obj({
    "memory_id": S, "revision": {"type": "integer", "minimum": 1}, "scope_id": S,
    "kind": kind, "content": {"type": "string"}, "subject": S, "predicate": S,
    "assertion_status": {"type": "string", "enum": ["accepted", "pending", "disputed"]},
    "valid_from": D, "valid_to": nullable_date,
    "conditions": {"type": "object", "additionalProperties": True},
    "evidence_refs": arr(ref("EvidenceRef")), "source": ref("SourceRef"), "relations": arr(ref("RelationRef")),
    "enforcement": {"type": "string", "enum": ["context_only", "tool_guarded", "unresolved"]}
}, ["memory_id", "revision", "scope_id", "kind", "content", "assertion_status", "valid_from", "valid_to", "evidence_refs", "enforcement"])
schemas["EventRequest"] = obj({
    "scope_id": S, "source_ref": S,
    "source_type": {"type": "string", "enum": ["user_message", "user_edit", "tool_observation", "agent_proposal", "import"]},
    "text": {"type": "string", "maxLength": 262144}, "occurred_at": D
}, ["scope_id", "source_ref", "source_type", "text"], "Trusted host endpoint; source_type is checked against the authenticated principal and host evidence.")
schemas["EventReceipt"] = obj({"event_id": S, "committed_seq": I, "extraction_state": {"type": "string", "enum": ["pending", "completed", "failed"]}}, ["event_id", "committed_seq", "extraction_state"])
schemas["MutationRequest"] = obj({
    "scope_id": S, "operation": operation, "memory_id": S,
    "expected_revision": {"type": "integer", "minimum": 1}, "source_event_id": S,
    "kind": kind, "content": {"type": "string", "maxLength": 32000},
    "subject": S, "predicate": S, "valid_from": D, "valid_to": nullable_date,
    "conditions": {"type": "object", "additionalProperties": True},
    "target_memory_id": S, "target_expected_revision": {"type": "integer", "minimum": 1},
    "reason": {"type": "string", "maxLength": 2000}
}, ["scope_id", "operation", "memory_id", "source_event_id"])
schemas["MutationRequest"]["allOf"] = [
    {"if": {"properties": {"operation": {"enum": ["AMEND", "REVOKE", "CORRECT", "ARCHIVE", "ERASE"]}}}, "then": {"required": ["expected_revision"]}},
    {"if": {"properties": {"operation": {"enum": ["ASSERT", "REPLACE", "EXCEPT"]}}}, "then": {"required": ["kind", "content"]}},
    {"if": {"properties": {"operation": {"enum": ["REPLACE", "EXCEPT"]}}}, "then": {"required": ["target_memory_id", "target_expected_revision"]}}
]
schemas["MutationReceipt"] = obj({"memory_id": S, "revision": {"type": "integer", "minimum": 1}, "commit_seq": I, "epochs": arr(ref("Epoch"))}, ["memory_id", "revision", "commit_seq", "epochs"])
schemas["ProposalRequest"] = obj({"scope_id": S, "source_event_id": S, "proposal": ref("MutationRequest"), "evidence_refs": arr(ref("EvidenceRef")), "interpretation": {"type": "string", "enum": ["explicit", "inferred", "ambiguous"]}}, ["scope_id", "source_event_id", "proposal", "evidence_refs", "interpretation"])
schemas["ProposalReceipt"] = obj({"proposal_id": S, "state": {"type": "string", "enum": ["accepted", "pending", "rejected"]}, "reason": {"type": "string"}}, ["proposal_id", "state"])
schemas["ContextRequest"] = obj({"scope_id": S, "task_id": S, "query": {"type": "string", "maxLength": 16000}, "action_type": S, "max_background_tokens": {"type": "integer", "minimum": 0, "maximum": 12000, "default": 3000}, "as_of_valid": D, "as_of_system_seq": I}, ["scope_id", "task_id", "query"])
schemas["ContextReceipt"] = obj({"receipt_id": S, "actor_id": S, "task_id": S, "snapshot_seq": I, "scope_epochs": arr(ref("Epoch")), "memory_versions": arr(ref("VersionRef")), "expires_at": D}, ["receipt_id", "actor_id", "task_id", "snapshot_seq", "scope_epochs", "memory_versions", "expires_at"])
schemas["ContextBundle"] = obj({"constraints": arr(ref("Memory")), "background": arr(ref("Memory")), "unresolved": arr({"type": "string"}), "receipt": ref("ContextReceipt")}, ["constraints", "background", "unresolved", "receipt"])
schemas["ActionCheckRequest"] = obj({"receipt_id": S, "task_id": S, "action_type": S, "resource": S, "task_fence": {"type": "integer", "minimum": 1}}, ["receipt_id", "task_id", "action_type", "resource"])
schemas["ActionCheckResult"] = obj({"allowed": {"type": "boolean"}, "reason": {"type": "string"}, "epochs": arr(ref("Epoch"))}, ["allowed", "reason", "epochs"], "Precheck only. Strong enforcement requires a controlled gateway to serialize validation with action acceptance; this response alone cannot authorize delayed external execution.")
schemas["ErasureRequest"] = obj({"scope_id": S, "memory_ids": {"type": "array", "items": S, "minItems": 1, "maxItems": 100}, "expected_revisions": arr(ref("VersionRef")), "include_source_content": {"type": "boolean", "default": True}, "reason": {"type": "string"}}, ["scope_id", "memory_ids", "expected_revisions"])
schemas["ErasureJob"] = obj({"job_id": S, "state": {"type": "string", "enum": ["online_hidden", "purging", "backup_pending", "completed", "failed"]}, "online_hidden_at": D, "backup_deadline": nullable_date, "controlled_targets": arr(S), "uncontrolled_targets": arr(S)}, ["job_id", "state", "online_hidden_at", "controlled_targets", "uncontrolled_targets"])
schemas["ChangePage"] = obj({"changes": arr(obj({"commit_seq": I, "scope_id": S, "operation": S, "memory_id": S}, ["commit_seq", "scope_id", "operation"])), "next_cursor": {"type": ["string", "null"]}}, ["changes", "next_cursor"])
schemas["CheckpointRequest"] = obj({"scope_id": S, "task_fence": {"type": "integer", "minimum": 1}, "expected_revision": I, "state": {"type": "object", "additionalProperties": True}}, ["scope_id", "task_fence", "expected_revision", "state"])
schemas["CheckpointReceipt"] = obj({"revision": I, "commit_seq": I}, ["revision", "commit_seq"])
schemas["Health"] = obj({"status": {"type": "string", "enum": ["ok", "degraded", "unavailable"]}}, ["status"])


def endpoint(operation_id, summary, result, request=None, path_id=None, query=None, write=False):
    out = {"operationId": operation_id, "summary": summary, "responses": {
        "200": {"description": "Success", "content": {"application/json": {"schema": ref(result)}}},
        "default": {"description": "Structured error", "content": {"application/json": {"schema": ref("Error")}}}
    }}
    params = []
    if path_id:
        params.append({"name": path_id, "in": "path", "required": True, "schema": S})
    for name in query or []:
        params.append({"name": name, "in": "query", "schema": S})
    if write:
        params.append({"name": "Idempotency-Key", "in": "header", "required": True, "schema": S})
    if params:
        out["parameters"] = params
    if request:
        out["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(request)}}}
    return out


paths = {
    "/v1/events": {"post": endpoint("ingestEvent", "持久化可信来源事件", "EventReceipt", "EventRequest", write=True)},
    "/v1/proposals": {"post": endpoint("proposeMemory", "提交记忆变更提案", "ProposalReceipt", "ProposalRequest", write=True)},
    "/v1/mutations": {"post": endpoint("commitMutation", "提交授权记忆变更", "MutationReceipt", "MutationRequest", write=True)},
    "/v1/context": {"post": endpoint("getContext", "组装当前约束和背景", "ContextBundle", "ContextRequest")},
    "/v1/memories/{id}": {"get": endpoint("getMemory", "读取有权限的记忆版本", "Memory", path_id="id", query=["revision", "as_of_valid", "as_of_system_seq"])},
    "/v1/action-checks": {"post": endpoint("checkAction", "动作网关预检查构件", "ActionCheckResult", "ActionCheckRequest")},
    "/v1/erasures": {"post": endpoint("eraseMemory", "屏蔽内容并启动清除作业", "ErasureJob", "ErasureRequest", write=True)},
    "/v1/erasures/{id}": {"get": endpoint("getErasure", "查看清除进度", "ErasureJob", path_id="id")},
    "/v1/changes": {"get": endpoint("listChanges", "读取可见增量变更", "ChangePage", query=["cursor"])},
    "/v1/checkpoints/{task_id}": {"put": endpoint("saveCheckpoint", "按任务租约保存检查点", "CheckpointReceipt", "CheckpointRequest", path_id="task_id", write=True)},
    "/v1/health": {"get": endpoint("health", "非敏感服务状态", "Health")}
}
api = {
    "openapi": "3.1.0",
    "info": {"title": "External Project Memory Service", "version": "0.1.0-design", "description": "Design contract only. Not an installed server. Local authenticated HTTP bearer credentials are issued by a trusted host. Remote MCP authorization is implemented separately according to the selected MCP specification."},
    "servers": [{"url": "http://127.0.0.1:9873", "description": "Proposed local development address; no service is started by this document."}],
    "security": [{"HostCredential": []}],
    "paths": paths,
    "components": {"securitySchemes": {"HostCredential": {"type": "http", "scheme": "bearer", "description": "Host-issued credential. Actor and allowed scopes are server-side bindings, not model arguments."}}, "schemas": schemas}
}
examples = {
    "description": "Synthetic schema examples, not records from the user's conversations.",
    "event": {"scope_id": "project_alpha", "source_ref": "message_41", "source_type": "user_message", "text": "本项目禁止使用付费 API", "occurred_at": "2026-09-15T00:00:00Z"},
    "assert": {"scope_id": "project_alpha", "operation": "ASSERT", "memory_id": "mem_api_budget", "source_event_id": "evt_41", "kind": "constraint", "content": "本项目禁止使用付费 API", "valid_from": "2026-09-15T00:00:00Z"},
    "future_replace": {"scope_id": "project_alpha", "operation": "REPLACE", "memory_id": "mem_api_budget_v2", "target_memory_id": "mem_api_budget", "target_expected_revision": 1, "source_event_id": "evt_42", "kind": "constraint", "content": "允许使用已批准预算内的付费 API", "valid_from": "2026-10-01T00:00:00Z"},
    "revoke": {"scope_id": "project_alpha", "operation": "REVOKE", "memory_id": "mem_api_budget", "expected_revision": 1, "source_event_id": "evt_43", "reason": "用户解除要求"},
    "context": {"scope_id": "project_alpha", "task_id": "backend_1", "query": "接入外部搜索接口", "action_type": "external_api", "max_background_tokens": 3000},
    "erase": {"scope_id": "project_alpha", "memory_ids": ["mem_api_budget"], "expected_revisions": [{"memory_id": "mem_api_budget", "revision": 1}], "include_source_content": True}
}
SPEC.mkdir(exist_ok=True)
for name, value in [("openapi.json", api), ("examples.json", examples)]:
    (SPEC / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# Internal reference and example shape checks; not a complete OAS validator.
def walk(value):
    if isinstance(value, dict):
        if "$ref" in value:
            assert value["$ref"].startswith("#/components/schemas/")
            assert value["$ref"].split("/")[-1] in schemas
        for v in value.values():
            walk(v)
    elif isinstance(value, list):
        for v in value:
            walk(v)

walk(api)
for example, schema_name in [("event", "EventRequest"), ("assert", "MutationRequest"), ("future_replace", "MutationRequest"), ("revoke", "MutationRequest"), ("context", "ContextRequest"), ("erase", "ErasureRequest")]:
    assert set(schemas[schema_name]["required"]) <= set(examples[example])
    assert set(examples[example]) <= set(schemas[schema_name]["properties"])
print(json.dumps({"paths": len(paths), "schemas": len(schemas), "examples": len(examples) - 1, "internal_refs": "passed", "complete_openapi_validation": False}))
