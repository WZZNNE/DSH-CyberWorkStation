"""Bounded protocol regressions, not a memory quality or production benchmark.

Two-connection interleavings and process exits exercise specific SQLite paths;
they do not establish power-loss durability, arbitrary concurrent correctness,
real action dispatch safety, scope inheritance or full context compilation.
"""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from reference_model import Store, Conflict, Denied


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "memory.db"
        self.s = Store(self.path, initialize=True)

    def tearDown(self):
        self.s.close()
        self.temp.cleanup()

    def add(self, mid="rule1", scope="a", **kw):
        return self.s.mutate("owner", scope, "add-" + mid, "ASSERT", mid, 100, content="禁止付费API", **kw)

    def test_01_schema_integrity(self):
        self.add()
        self.assertEqual(self.s.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(list(self.s.db.execute("PRAGMA foreign_key_check")), [])

    def test_02_current_read(self):
        self.add()
        self.assertEqual(self.s.active("reader", "a", 100)[0]["content"], "禁止付费API")

    def test_03_revoke_does_not_create_opposite(self):
        self.add()
        self.s.mutate("owner", "a", "revoke", "REVOKE", "rule1", 200, expected_revision=1)
        self.assertEqual(self.s.active("reader", "a", 200), [])
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM memory_records").fetchone()[0], 1)

    def test_04_bitemporal_history(self):
        first = self.add()
        self.s.mutate("owner", "a", "revoke", "REVOKE", "rule1", 200, expected_revision=1)
        self.assertEqual(len(self.s.active("reader", "a", 150)), 1)
        self.assertEqual(len(self.s.active("reader", "a", 250, first["commit_seq"])), 1)
        self.assertEqual(self.s.active("reader", "a", 250), [])

    def test_05_future_activation(self):
        self.add(valid_from=300)
        self.assertEqual(self.s.active("reader", "a", 299), [])
        self.assertEqual(len(self.s.active("reader", "a", 300)), 1)

    def test_06_half_open_interval(self):
        self.add(valid_from=100, valid_to=200)
        self.assertEqual(len(self.s.active("reader", "a", 199)), 1)
        self.assertEqual(self.s.active("reader", "a", 200), [])

    def test_07_scope_isolation(self):
        self.add("a-rule", "a")
        self.add("b-rule", "b")
        self.assertEqual([r["memory_id"] for r in self.s.active("reader", "a", 150)], ["a-rule"])
        with self.assertRaises(Denied):
            self.s.active("reader", "b", 150)

    def test_08_tenant_isolation(self):
        self.add()
        with self.assertRaises(Denied):
            self.s.active("outsider", "a", 150)

    def test_09_readonly_cannot_modify(self):
        self.add()
        with self.assertRaises(Denied):
            self.s.mutate("reader", "a", "x", "REVOKE", "rule1", 200, expected_revision=1)

    def test_10_agent_cannot_promote_own_constraint(self):
        with self.assertRaises(Denied):
            self.s.mutate("agent", "a", "x", "ASSERT", "invented", 100, content="用户禁止红色")
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM commit_log").fetchone()[0], 0)

    def test_11_pending_not_effective(self):
        self.add(status="pending")
        self.assertEqual(self.s.active("reader", "a", 150), [])

    def test_12_archived_constraint_remains_effective(self):
        self.add(tier="archive")
        self.assertEqual(len(self.s.active("reader", "a", 150, constraints_only=True)), 1)

    def test_13_idempotent_replay(self):
        a = self.add()
        b = self.add()
        self.assertEqual(a, b)
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 1)

    def test_14_idempotency_mismatched_payload(self):
        self.add()
        with self.assertRaises(Conflict):
            self.s.mutate("owner", "a", "add-rule1", "ASSERT", "rule1", 100, content="改为允许")

    def test_15_stale_version_across_connections(self):
        self.add()
        other = Store(self.path)
        try:
            self.s.mutate("owner", "a", "editA", "CORRECT", "rule1", 200, content="版本二", expected_revision=1)
            with self.assertRaises(Conflict):
                other.mutate("owner", "a", "editB", "CORRECT", "rule1", 210, content="旧写入者", expected_revision=1)
            self.assertEqual(self.s.active("owner", "a", 250)[0]["content"], "版本二")
        finally:
            other.close()

    def test_16_mutation_outbox_atomic_rollback(self):
        with self.assertRaises(RuntimeError):
            self.s.mutate("owner", "a", "fail", "ASSERT", "rule1", 100, content="x", fail_before_commit=True)
        for table in ("memory_records", "memory_revisions", "commit_log", "outbox", "mutation_receipts"):
            self.assertEqual(self.s.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_17_acknowledged_commit_survives_reopen(self):
        self.add()
        self.s.close()
        self.s = Store(self.path)
        self.assertEqual(len(self.s.active("owner", "a", 150)), 1)

    def test_18_uncommitted_process_crash_rolls_back(self):
        code = "import sqlite3,os,sys; c=sqlite3.connect(sys.argv[1]); c.execute('BEGIN IMMEDIATE'); c.execute(\"INSERT INTO tenants VALUES ('crashed')\"); os._exit(17)"
        result = subprocess.run([sys.executable, "-c", code, str(self.path)], capture_output=True)
        self.assertEqual(result.returncode, 17)
        self.assertIsNone(self.s.db.execute("SELECT * FROM tenants WHERE tenant_id='crashed'").fetchone())

    def test_19_stale_index_candidate_removed(self):
        self.add()
        self.s.mutate("owner", "a", "edit", "CORRECT", "rule1", 200, content="新正文", expected_revision=1)
        self.assertEqual(self.s.filter_index_candidates("owner", "a", 250, [("rule1", 1)]), [])

    def test_20_projection_after_completed_erasure_is_rejected(self):
        self.add()
        self.s.mutate("owner", "a", "erase", "ERASE", "rule1", 200, expected_revision=1)
        self.assertFalse(self.s.publish_projection("rule1", 1))

    def test_21_erasure_hides_history_and_clears_payload(self):
        first = self.add()
        self.s.publish_projection("rule1", 1)
        self.s.mutate("owner", "a", "erase", "ERASE", "rule1", 200, expected_revision=1)
        self.assertEqual(self.s.active("owner", "a", 150, first["commit_seq"]), [])
        self.assertIsNone(self.s.db.execute("SELECT content FROM memory_revisions").fetchone()[0])
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM index_projection").fetchone()[0], 0)

    def test_22_policy_epoch_invalidates_receipt(self):
        self.add()
        receipt = self.s.make_receipt("reader", "a", 150)
        self.s.mutate("owner", "a", "revoke", "REVOKE", "rule1", 200, expected_revision=1)
        with self.assertRaises(Conflict):
            self.s.check_receipt("reader", receipt, 201)

    def test_23_future_boundary_expires_without_write(self):
        self.add(valid_to=200)
        receipt = self.s.make_receipt("reader", "a", 150)
        self.assertTrue(self.s.check_receipt("reader", receipt, 199))
        with self.assertRaises(Conflict):
            self.s.check_receipt("reader", receipt, 200)

    def test_24_unrelated_note_does_not_invalidate_policy(self):
        self.add()
        receipt = self.s.make_receipt("reader", "a", 150)
        self.s.mutate("owner", "a", "note", "ASSERT", "note", 160, content="背景信息", kind="fact")
        self.assertTrue(self.s.check_receipt("reader", receipt, 170))

    def test_25_acl_change_invalidates_receipt(self):
        receipt = self.s.make_receipt("reader", "a", 100)
        self.s.db.execute("UPDATE scope_epochs SET acl_epoch=acl_epoch+1 WHERE scope_id='a'")
        with self.assertRaises(Conflict):
            self.s.check_receipt("reader", receipt, 110)

    def test_26_expired_task_fence_rejected(self):
        old = self.s.claim_task("agent", "a", "task", 100, ttl=100)
        new = self.s.claim_task("owner", "a", "task", 200, ttl=100)
        self.assertGreater(new, old)
        with self.assertRaises(Conflict):
            self.s.check_task("agent", "task", old, 210)
        self.assertTrue(self.s.check_task("owner", "task", new, 210))

    def test_27_database_rejects_cross_tenant_relation(self):
        self.add()
        self.s.mutate("outsider", "foreign", "add-other", "ASSERT", "other", 100, content="外部")
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.db.execute("INSERT INTO memory_relations VALUES (?,?,?,?,?,?)", ("t1", "rule1", 1, "other", 1, "depends_on"))

    def test_28_negative_effective_interval_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.add(valid_from=300, valid_to=200)
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 0)

    def test_29_correction_distinguishes_old_knowledge_from_revised_history(self):
        first = self.add()
        self.s.mutate("owner", "a", "correct", "CORRECT", "rule1", 200,
                      content="仅生产环境禁止付费API", expected_revision=1)
        self.assertEqual(self.s.active("reader", "a", 150)[0]["content"], "仅生产环境禁止付费API")
        self.assertEqual(self.s.active("reader", "a", 150, first["commit_seq"])[0]["content"], "禁止付费API")

    def test_30_future_correction_and_unimplemented_changes_leave_current_rule(self):
        self.add()
        for operation in ("CORRECT", "AMEND", "REPLACE"):
            with self.subTest(operation=operation), self.assertRaises(Conflict):
                self.s.mutate("owner", "a", "future-" + operation, operation, "rule1", 200,
                              content="将来允许", expected_revision=1, valid_from=300)
        self.assertEqual(self.s.active("reader", "a", 250)[0]["content"], "禁止付费API")
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM commit_log").fetchone()[0], 1)

    def test_31_repeated_revoke_cannot_extend_an_ended_interval(self):
        self.add()
        self.s.mutate("owner", "a", "revoke", "REVOKE", "rule1", 200, expected_revision=1)
        with self.assertRaisesRegex(Conflict, "RULE_ALREADY_ENDED"):
            self.s.mutate("owner", "a", "revoke-again", "REVOKE", "rule1", 300, expected_revision=2)
        self.assertEqual(self.s.active("reader", "a", 250), [])
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM commit_log").fetchone()[0], 2)

    def test_32_cancel_future_rule_has_empty_interval_and_does_not_reactivate(self):
        self.add(valid_from=300)
        self.s.mutate("owner", "a", "cancel", "REVOKE", "rule1", 200, expected_revision=1)
        self.assertEqual(self.s.active("reader", "a", 250), [])
        self.assertEqual(self.s.active("reader", "a", 300), [])
        with self.assertRaisesRegex(Conflict, "RULE_ALREADY_ENDED"):
            self.s.mutate("owner", "a", "cancel-again", "REVOKE", "rule1", 250, expected_revision=2)

    def test_33_expired_task_cannot_move_between_scopes_or_tenants(self):
        fence = self.s.claim_task("agent", "a", "task", 100, ttl=100)
        for actor, scope in (("owner", "b"), ("outsider", "foreign")):
            with self.subTest(actor=actor), self.assertRaises(Denied):
                self.s.claim_task(actor, scope, "task", 200)
        row = self.s.db.execute("SELECT scope_id,actor_id,fence FROM task_leases WHERE task_id='task'").fetchone()
        self.assertEqual(tuple(row), ("a", "agent", fence))

    def test_34_task_reclaim_keeps_saved_checkpoint(self):
        self.s.claim_task("agent", "a", "task", 100, ttl=100)
        checkpoint = json.dumps({"verified": ["file written"], "pending": ["run checks"]})
        self.s.db.execute("UPDATE task_leases SET checkpoint_json=?,checkpoint_revision=4 WHERE task_id='task'", (checkpoint,))
        fence = self.s.claim_task("owner", "a", "task", 200)
        row = self.s.db.execute("SELECT checkpoint_json,checkpoint_revision FROM task_leases WHERE task_id='task'").fetchone()
        self.assertEqual(tuple(row), (checkpoint, 4))
        self.assertTrue(self.s.check_task("owner", "task", fence, 201))

    def test_35_erasure_cannot_interleave_projection_validation_and_publish(self):
        self.add()
        other = Store(self.path)
        other.db.execute("PRAGMA busy_timeout=0")
        attempts = []
        errors = []

        def erase_before_projection_insert(statement):
            if not statement.startswith("INSERT OR REPLACE INTO index_projection"):
                return
            try:
                other.mutate("owner", "a", "erase-race", "ERASE", "rule1", 200, expected_revision=1)
                attempts.append("erased")
            except sqlite3.OperationalError as error:
                if error.sqlite_errorcode == sqlite3.SQLITE_BUSY:
                    attempts.append("busy")
                else:
                    errors.append(error)
            except BaseException as error:
                errors.append(error)

        try:
            self.s.db.set_trace_callback(erase_before_projection_insert)
            self.assertTrue(self.s.publish_projection("rule1", 1))
            self.s.db.set_trace_callback(None)
            self.assertEqual(errors, [])
            self.assertEqual(len(attempts), 1)
            if attempts == ["busy"]:
                other.mutate("owner", "a", "erase-race", "ERASE", "rule1", 200, expected_revision=1)
            self.assertEqual(self.s.active("reader", "a", 250), [])
            self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM index_projection").fetchone()[0], 0)
        finally:
            self.s.db.set_trace_callback(None)
            other.close()

    def test_36_receipt_does_not_mix_old_time_boundaries_with_new_epoch(self):
        self.add()
        other = Store(self.path)
        read_epoch = self.s.epoch

        def insert_future_rule_before_epoch_read(scope):
            other.mutate("owner", "a", "future", "ASSERT", "future", 160,
                         content="未来限制", valid_from=200)
            return read_epoch(scope)

        try:
            self.s.epoch = insert_future_rule_before_epoch_read
            receipt = self.s.make_receipt("reader", "a", 150)
        finally:
            self.s.epoch = read_epoch
            other.close()
        with self.assertRaisesRegex(Conflict, "CONTEXT_STALE"):
            self.s.check_receipt("reader", receipt, 200)
        fresh = self.s.make_receipt("reader", "a", 170)
        self.assertEqual(fresh["expires_at"], 200)

    def test_37_acknowledged_commit_survives_abrupt_process_exit(self):
        code = "\n".join([
            "import os,sys",
            "from reference_model import Store",
            "store = Store(sys.argv[1])",
            "result = store.mutate('owner','a','crash-commit','ASSERT','committed',100,content='saved')",
            "print(result['commit_seq'], flush=True)",
            "os._exit(23)",
        ])
        result = subprocess.run([sys.executable, "-B", "-c", code, str(self.path)],
                                cwd=Path(__file__).resolve().parent, capture_output=True,
                                text=True, timeout=20)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertTrue(result.stdout.strip().isdigit())
        self.s.close()
        self.s = Store(self.path)
        self.assertEqual(self.s.active("reader", "a", 150)[0]["content"], "saved")
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM mutation_receipts").fetchone()[0], 1)
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 1)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ProtocolTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "kind": "bounded_reference_model_validation",
        "tests_run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "passed": result.wasSuccessful(),
        "python": sys.version.split()[0],
        "sqlite": sqlite3.sqlite_version,
        "validated_scope": ["single-scope structured mutations", "retroactive correction and bitemporal lookup", "selected two-connection interleavings", "SQLite process-exit recovery", "fixture receipt and lease checks"],
        "not_validated": ["LLM intent accuracy", "embedding recall", "HTTP/MCP", "scope inheritance and exception resolution", "complete context compilation and receipt authenticity", "future replacement", "real action dispatch", "full erasure/backups", "power-loss durability", "production concurrency/performance", "academic novelty"],
    }
    Path(__file__).with_name("results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sys.exit(0 if result.wasSuccessful() else 1)
