"""Executable reference model for a bounded subset of design v0.1.

Not a production service: no LLM, embedding provider, HTTP/MCP server, complete
policy language, graph closure, real tool dispatch or backup erasure is present.
Fixtures model identities supplied by a trusted host, never model-supplied roles.
Reads and receipts cover one exact scope, without inherited scopes, conditions,
exception resolution, task-bound context compilation or signed wire receipts.
Receipt checks are observations, not atomic authorization for real actions.
CORRECT revises the system's understanding of an existing past/current effective
interval. AMEND and future REPLACE are deliberately unsupported: the full service
must preserve effective-time segments when implementing prospective changes.
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
import uuid
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1] / "spec" / "schema.sql"


class MemoryErrorBase(Exception):
    pass


class Denied(MemoryErrorBase):
    pass


class Conflict(MemoryErrorBase):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


class Store:
    def __init__(self, path, initialize=False):
        self.db = sqlite3.connect(str(path), isolation_level=None, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA synchronous=FULL")
        if initialize:
            self.db.executescript(SCHEMA.read_text(encoding="utf-8"))
            self.seed()

    def close(self):
        self.db.close()

    def seed(self):
        self.db.executemany("INSERT INTO tenants VALUES (?)", [("t1",), ("t2",)])
        self.db.executemany("INSERT INTO principals VALUES (?,?,?)", [
            ("owner", "t1", "user"), ("agent", "t1", "agent"),
            ("reader", "t1", "agent"), ("outsider", "t2", "user")])
        self.db.executemany("INSERT INTO scopes VALUES (?,?,?,?,?)", [
            ("global", "t1", None, "global", "Global"),
            ("a", "t1", "global", "project", "Project A"),
            ("b", "t1", "global", "project", "Project B"),
            ("foreign", "t2", None, "project", "Foreign")])
        self.db.execute("INSERT INTO scope_epochs(scope_id) SELECT scope_id FROM scopes")
        self.db.executemany("INSERT INTO grants VALUES (?,?,?,?,?,?)", [
            ("owner", "global", "t1", 1, 1, 1),
            ("owner", "a", "t1", 1, 1, 1), ("owner", "b", "t1", 1, 1, 1),
            ("agent", "a", "t1", 1, 1, 0), ("reader", "a", "t1", 1, 0, 0),
            ("outsider", "foreign", "t2", 1, 1, 1)])

    def authorize(self, actor, scope, permission="can_read"):
        if permission not in {"can_read", "can_write", "can_erase"}:
            raise Denied("unknown permission")
        row = self.db.execute(
            f"SELECT g.tenant_id FROM grants g WHERE actor_id=? AND scope_id=? AND {permission}=1",
            (actor, scope)).fetchone()
        if row is None:
            raise Denied("SCOPE_DENIED")
        return row["tenant_id"]

    def epoch(self, scope):
        row = self.db.execute("SELECT * FROM scope_epochs WHERE scope_id=?", (scope,)).fetchone()
        return dict(row)

    def mutate(self, actor, scope, key, operation, memory_id, now,
               content=None, kind="constraint", expected_revision=None,
               valid_from=None, valid_to=None, status="accepted", tier="active",
               fail_before_commit=False):
        """Human-authorized structured commands, not automatic NLP extraction."""
        request = dict(scope=scope, operation=operation, memory_id=memory_id, now=now,
                       content=content, kind=kind, expected_revision=expected_revision,
                       valid_from=valid_from, valid_to=valid_to, status=status, tier=tier)
        digest = hashlib.sha256(canonical(request).encode()).hexdigest()
        self.db.execute("BEGIN IMMEDIATE")
        try:
            tenant = self.authorize(actor, scope, "can_erase" if operation == "ERASE" else "can_write")
            previous = self.db.execute("SELECT * FROM mutation_receipts WHERE actor_id=? AND idempotency_key=?", (actor, key)).fetchone()
            if previous:
                if previous["request_hash"] != digest:
                    raise Conflict("IDEMPOTENCY_CONFLICT")
                self.db.execute("COMMIT")
                return json.loads(previous["result_json"])
            identity = self.db.execute("SELECT kind FROM principals WHERE actor_id=?", (actor,)).fetchone()[0]
            old = self.db.execute("SELECT * FROM current_revision WHERE memory_id=?", (memory_id,)).fetchone()
            if operation != "ASSERT":
                if old is None or old["scope_id"] != scope or old["erased_at"] is not None:
                    raise Conflict("NOT_FOUND")
                if expected_revision != old["revision"]:
                    raise Conflict("VERSION_CONFLICT")
                kind = old["kind"]
            elif old is not None:
                raise Conflict("DUPLICATE_ID")
            if kind == "constraint" and identity not in {"user", "host"}:
                raise Denied("INFERRED_AUTHORITY_NOT_ALLOWED")
            if operation not in {"ASSERT", "CORRECT", "REVOKE", "ERASE"}:
                raise Conflict("UNSUPPORTED_REFERENCE_OPERATION")
            if operation == "CORRECT" and (old["valid_from"] if valid_from is None else valid_from) > now:
                raise Conflict("FUTURE_CORRECTION_UNSUPPORTED")
            if operation == "REVOKE" and old["valid_to"] is not None:
                if old["valid_to"] <= now or old["valid_to"] == old["valid_from"]:
                    raise Conflict("RULE_ALREADY_ENDED")
            seq = self.db.execute(
                "INSERT INTO commit_log(operation_id,scope_id,actor_id,operation,committed_at) VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), scope, actor, operation, now)).lastrowid
            revision = 1 if old is None else old["revision"] + 1
            if operation == "ERASE":
                # Logical hiding plus online row cleanup for this bounded fixture.
                # No assertion of secure physical wipe, shared-source or backup purge.
                self.db.execute("UPDATE memory_records SET erased_at=? WHERE memory_id=?", (now, memory_id))
                self.db.execute("UPDATE memory_revisions SET content=NULL,subject=NULL,predicate=NULL,conditions_json='{}' WHERE memory_id=?", (memory_id,))
                self.db.execute("UPDATE source_events SET raw_text=NULL,erased_at=? WHERE event_id IN (SELECT source_event_id FROM memory_revisions WHERE memory_id=?)", (now, memory_id))
                self.db.execute("DELETE FROM index_projection WHERE memory_id=?", (memory_id,))
                self.db.execute("DELETE FROM memory_fts WHERE memory_id=?", (memory_id,))
                revision = old["revision"]
            else:
                source = str(uuid.uuid4())
                self.db.execute(
                    "INSERT INTO source_events(event_id,tenant_id,scope_id,actor_id,source_type,source_ref,raw_text,recorded_seq) VALUES (?,?,?,?,?,?,?,?)",
                    (source, tenant, scope, actor, "user_edit" if identity == "user" else "agent_proposal", source, content, seq))
                if old is None:
                    self.db.execute("INSERT INTO memory_records VALUES (?,?,?,?,NULL)", (memory_id, tenant, scope, revision))
                    start = now if valid_from is None else valid_from
                    end = valid_to
                    text = content
                    reason = None
                else:
                    self.db.execute("UPDATE memory_revisions SET system_to_seq=? WHERE memory_id=? AND revision=?", (seq, memory_id, old["revision"]))
                    self.db.execute("UPDATE memory_records SET head_revision=? WHERE memory_id=?", (revision, memory_id))
                    start = old["valid_from"] if valid_from is None else valid_from
                    end = old["valid_to"] if valid_to is None else valid_to
                    text = old["content"] if content is None else content
                    reason = old["end_reason"]
                    if operation == "REVOKE":
                        start = old["valid_from"]
                        end = max(now, start)
                        text = old["content"]
                        status, tier = old["assertion_status"], old["tier"]
                        reason = "revoke"
                self.db.execute("""INSERT INTO memory_revisions
                    (memory_id,revision,tenant_id,kind,assertion_status,subject,predicate,content,valid_from,valid_to,system_from_seq,source_event_id,tier,end_reason)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (memory_id, revision, tenant, kind, status, "project", "rule", text, start, end, seq, source, tier, reason))
            self.db.execute("UPDATE scope_epochs SET data_epoch=data_epoch+1, policy_epoch=policy_epoch+? WHERE scope_id=?", (int(kind == "constraint"), scope))
            self.db.execute("INSERT INTO outbox(commit_seq,event_kind,target_id,target_revision) VALUES (?,?,?,?)", (seq, "erase" if operation == "ERASE" else "refresh", memory_id, revision))
            result = dict(memory_id=memory_id, revision=revision, commit_seq=seq, epoch=self.epoch(scope))
            self.db.execute("INSERT INTO mutation_receipts VALUES (?,?,?,?,?)", (actor, key, digest, canonical(result), seq))
            if fail_before_commit:
                raise RuntimeError("injected before commit")
            self.db.execute("COMMIT")
            return result
        except BaseException:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def active(self, actor, scope, now, system_seq=None, constraints_only=False):
        self.authorize(actor, scope)
        args = [scope, now, now]
        if system_seq is None:
            version_clause = "m.head_revision=r.revision"
        else:
            version_clause = "r.system_from_seq<=? AND (r.system_to_seq IS NULL OR r.system_to_seq>?)"
            args += [system_seq, system_seq]
        sql = """SELECT r.* FROM memory_records m JOIN memory_revisions r ON m.memory_id=r.memory_id
                 WHERE m.scope_id=? AND m.erased_at IS NULL AND r.assertion_status='accepted'
                 AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?) AND """ + version_clause
        if constraints_only:
            sql += " AND r.kind='constraint'"
        return [dict(r) for r in self.db.execute(sql + " ORDER BY r.memory_id", args)]

    def filter_index_candidates(self, actor, scope, now, candidates):
        active = {r["memory_id"]: r for r in self.active(actor, scope, now)}
        return [active[mid] for mid, rev in candidates if mid in active and active[mid]["revision"] == rev]

    def publish_projection(self, memory_id, revision, generation="fixture"):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT * FROM current_revision WHERE memory_id=?", (memory_id,)).fetchone()
            valid = row is not None and row["erased_at"] is None and row["revision"] == revision
            if valid:
                digest = hashlib.sha256((row["content"] or "").encode()).hexdigest()
                self.db.execute("INSERT OR REPLACE INTO index_projection VALUES (?,?,?,?,?,NULL)", (memory_id, revision, generation, digest, "ready"))
            self.db.execute("COMMIT")
            return valid
        except BaseException:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def make_receipt(self, actor, scope, now, ttl=60000):
        self.db.execute("BEGIN")
        try:
            self.authorize(actor, scope)
            boundaries = []
            for row in self.db.execute("SELECT valid_from,valid_to FROM current_revision WHERE scope_id=? AND erased_at IS NULL AND kind='constraint' AND assertion_status='accepted'", (scope,)):
                boundaries += [t for t in row if t is not None and t > now]
            receipt = dict(actor=actor, scope=scope, epoch=self.epoch(scope), expires_at=min([now + ttl] + boundaries))
            self.db.execute("COMMIT")
            return receipt
        except BaseException:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def check_receipt(self, actor, receipt, now):
        self.authorize(actor, receipt["scope"])
        if receipt["actor"] != actor or now >= receipt["expires_at"]:
            raise Conflict("CONTEXT_STALE")
        epoch = self.epoch(receipt["scope"])
        if any(epoch[k] != receipt["epoch"][k] for k in ("policy_epoch", "acl_epoch")):
            raise Conflict("CONTEXT_STALE")
        return True

    def claim_task(self, actor, scope, task, now, ttl=100):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.authorize(actor, scope, "can_write")
            old = self.db.execute("SELECT * FROM task_leases WHERE task_id=?", (task,)).fetchone()
            if old and old["scope_id"] != scope:
                raise Denied("SCOPE_DENIED")
            if old and old["expires_at"] > now:
                raise Conflict("TASK_ALREADY_LEASED")
            fence = 1 if old is None else old["fence"] + 1
            if old is None:
                self.db.execute("INSERT INTO task_leases(task_id,scope_id,actor_id,fence,expires_at) VALUES (?,?,?,?,?)", (task, scope, actor, fence, now + ttl))
            else:
                self.db.execute("UPDATE task_leases SET actor_id=?,fence=?,expires_at=? WHERE task_id=?", (actor, fence, now + ttl, task))
            self.db.execute("COMMIT")
            return fence
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def check_task(self, actor, task, fence, now):
        row = self.db.execute("SELECT * FROM task_leases WHERE task_id=?", (task,)).fetchone()
        if row is None or row["actor_id"] != actor or row["fence"] != fence or now >= row["expires_at"]:
            raise Conflict("LEASE_STALE")
        self.authorize(actor, row["scope_id"], "can_write")
        return True
