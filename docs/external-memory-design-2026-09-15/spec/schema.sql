-- External project memory service: core reference schema, design v0.1.
-- Application authorization and semantic validation are still required.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY
);
CREATE TABLE principals (
  actor_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  kind TEXT NOT NULL CHECK(kind IN ('user','host','agent','worker')),
  UNIQUE(actor_id,tenant_id)
);
CREATE TABLE scopes (
  scope_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  parent_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('global','project','branch','task')),
  name TEXT NOT NULL,
  UNIQUE(scope_id,tenant_id),
  FOREIGN KEY(parent_id,tenant_id) REFERENCES scopes(scope_id,tenant_id)
);
CREATE TABLE grants (
  actor_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK(can_read IN (0,1)),
  can_write INTEGER NOT NULL DEFAULT 0 CHECK(can_write IN (0,1)),
  can_erase INTEGER NOT NULL DEFAULT 0 CHECK(can_erase IN (0,1)),
  PRIMARY KEY(actor_id,scope_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES principals(actor_id,tenant_id),
  FOREIGN KEY(scope_id,tenant_id) REFERENCES scopes(scope_id,tenant_id)
);
CREATE TABLE scope_epochs (
  scope_id TEXT PRIMARY KEY REFERENCES scopes(scope_id),
  policy_epoch INTEGER NOT NULL DEFAULT 0,
  data_epoch INTEGER NOT NULL DEFAULT 0,
  acl_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE commit_log (
  commit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
  actor_id TEXT NOT NULL REFERENCES principals(actor_id),
  operation TEXT NOT NULL,
  committed_at INTEGER NOT NULL
);
CREATE TABLE source_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('user_message','user_edit','tool_observation','agent_proposal','import')),
  source_ref TEXT NOT NULL,
  raw_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  recorded_seq INTEGER NOT NULL REFERENCES commit_log(commit_seq),
  erased_at INTEGER,
  UNIQUE(event_id,tenant_id),
  UNIQUE(actor_id,source_ref),
  FOREIGN KEY(scope_id,tenant_id) REFERENCES scopes(scope_id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES principals(actor_id,tenant_id)
);
CREATE TABLE memory_records (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK(head_revision >= 1),
  erased_at INTEGER,
  UNIQUE(memory_id,tenant_id),
  FOREIGN KEY(scope_id,tenant_id) REFERENCES scopes(scope_id,tenant_id),
  FOREIGN KEY(memory_id,head_revision) REFERENCES memory_revisions(memory_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE memory_revisions (
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('constraint','goal','preference','fact','decision','procedure','work_state','hypothesis')),
  assertion_status TEXT NOT NULL CHECK(assertion_status IN ('accepted','pending','disputed')),
  subject TEXT,
  predicate TEXT,
  content TEXT,
  conditions_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(conditions_json)),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  system_from_seq INTEGER NOT NULL REFERENCES commit_log(commit_seq),
  system_to_seq INTEGER REFERENCES commit_log(commit_seq),
  source_event_id TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'active' CHECK(tier IN ('pinned','active','archive')),
  end_reason TEXT CHECK(end_reason IN ('revoke','replace','expire')),
  PRIMARY KEY(memory_id,revision),
  CHECK(valid_to IS NULL OR valid_to >= valid_from),
  CHECK(system_to_seq IS NULL OR system_to_seq > system_from_seq),
  FOREIGN KEY(memory_id,tenant_id) REFERENCES memory_records(memory_id,tenant_id),
  FOREIGN KEY(source_event_id,tenant_id) REFERENCES source_events(event_id,tenant_id)
);
CREATE UNIQUE INDEX one_open_system_version ON memory_revisions(memory_id) WHERE system_to_seq IS NULL;
CREATE INDEX memory_scope ON memory_records(scope_id,erased_at);
CREATE INDEX valid_lookup ON memory_revisions(kind,assertion_status,valid_from,valid_to);
CREATE TABLE memory_relations (
  tenant_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('replaces','exception_to','derived_from','depends_on')),
  PRIMARY KEY(source_id,source_revision,target_id,target_revision,relation_type),
  FOREIGN KEY(source_id,tenant_id) REFERENCES memory_records(memory_id,tenant_id),
  FOREIGN KEY(target_id,tenant_id) REFERENCES memory_records(memory_id,tenant_id),
  FOREIGN KEY(source_id,source_revision) REFERENCES memory_revisions(memory_id,revision),
  FOREIGN KEY(target_id,target_revision) REFERENCES memory_revisions(memory_id,revision)
);
CREATE TABLE mutation_receipts (
  actor_id TEXT NOT NULL REFERENCES principals(actor_id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  commit_seq INTEGER NOT NULL REFERENCES commit_log(commit_seq),
  PRIMARY KEY(actor_id,idempotency_key)
);
CREATE TABLE outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_seq INTEGER NOT NULL REFERENCES commit_log(commit_seq),
  event_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_revision INTEGER,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  UNIQUE(commit_seq,event_kind,target_id)
);
CREATE TABLE index_projection (
  memory_id TEXT NOT NULL REFERENCES memory_records(memory_id),
  revision INTEGER NOT NULL,
  generation TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','stale')),
  embedding BLOB,
  PRIMARY KEY(memory_id,generation),
  FOREIGN KEY(memory_id,revision) REFERENCES memory_revisions(memory_id,revision)
);
CREATE VIRTUAL TABLE memory_fts USING fts5(memory_id UNINDEXED, revision UNINDEXED, scope_id UNINDEXED, terms);
CREATE TABLE context_receipts (
  receipt_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES principals(actor_id),
  task_id TEXT NOT NULL,
  snapshot_seq INTEGER NOT NULL,
  scope_epochs_json TEXT NOT NULL CHECK(json_valid(scope_epochs_json)),
  memory_versions_json TEXT NOT NULL CHECK(json_valid(memory_versions_json)),
  expires_at INTEGER NOT NULL
);
CREATE TABLE task_leases (
  task_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES scopes(scope_id),
  actor_id TEXT NOT NULL REFERENCES principals(actor_id),
  fence INTEGER NOT NULL CHECK(fence > 0),
  expires_at INTEGER NOT NULL,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  checkpoint_revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE erasure_jobs (
  job_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES principals(actor_id),
  target_ids_json TEXT NOT NULL CHECK(json_valid(target_ids_json)),
  online_hidden_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('online_hidden','purging','backup_pending','completed','failed')),
  backup_deadline INTEGER,
  progress_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(progress_json))
);

-- This view is not an authorization boundary. Always join/check grants in service.
CREATE VIEW current_revision AS
SELECT m.scope_id,m.erased_at,r.*
FROM memory_records m JOIN memory_revisions r
ON m.memory_id=r.memory_id AND m.head_revision=r.revision;
