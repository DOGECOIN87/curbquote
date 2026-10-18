import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("property_ingest", ROOT / "tools" / "authorized_property_ingest.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def record():
    return {"provider": "Synthetic fixture", "retrieved_at": "2026-10-17T00:00:00Z", "facts": {"address": "123 TEST ST", "stories": 1}, "source": {"permissions": {"mayStore": True, "mayExport": True}, "retentionDays": None, "expiresAt": None}}


class PropertyIngestTests(unittest.TestCase):
    def test_keeps_snapshots_and_original_values_separately(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "property.sqlite3")
            first = record()
            MODULE.store_normalized_record(path, first)
            second = record(); second["facts"]["stories"] = 2
            MODULE.store_normalized_record(path, second)
            with sqlite3.connect(path) as connection:
                values = connection.execute("SELECT facts_json FROM property_snapshots_v2 ORDER BY id").fetchall()
            self.assertEqual([json.loads(row[0])["stories"] for row in values], [1, 2])

    def test_denies_restricted_retention_before_creating_a_database(self):
        for key, value in [("retentionDays", 7), ("expiresAt", "2027-01-01T00:00:00Z")]:
            restricted = record(); restricted["source"][key] = value
            with self.assertRaises(PermissionError): MODULE.store_normalized_record("not-created.sqlite3", restricted)
        restricted = record(); restricted["source"]["permissions"]["mayStore"] = False
        with self.assertRaises(PermissionError): MODULE.store_normalized_record("not-created.sqlite3", restricted)

    def test_calls_shared_adapter_without_shell_interpolation(self):
        class Result:
            returncode = 0
            stdout = json.dumps(record())
        with patch.object(MODULE.subprocess, "run", return_value=Result()) as run:
            result = MODULE.fetch_provider_record("123 Test St, Austin, TX 78701")
            self.assertEqual(result["facts"]["stories"], 1)
            self.assertIsInstance(run.call_args.args[0], list)
            self.assertNotIn("shell", run.call_args.kwargs)

    def test_rejects_failed_or_unexportable_adapter_output(self):
        class Result:
            returncode = 2
            stdout = ""
        with patch.object(MODULE.subprocess, "run", return_value=Result()):
            with self.assertRaises(RuntimeError): MODULE.fetch_provider_record("123 Test St")
        value = record(); value["source"]["permissions"]["mayExport"] = False
        Result.returncode = 0; Result.stdout = json.dumps(value)
        with patch.object(MODULE.subprocess, "run", return_value=Result()):
            with self.assertRaises(RuntimeError): MODULE.fetch_provider_record("123 Test St")

    def test_unapproved_cli_exits_without_network_or_database_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "denied.sqlite3"
            environment = {**os.environ, "DATA_USE_APPROVED": "false"}
            result = MODULE.subprocess.run([sys.executable, str(ROOT / "tools" / "authorized_property_ingest.py"), "123 Test St, Austin, TX 78701", "--db", str(path)], capture_output=True, text=True, env=environment, timeout=12)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertFalse(path.exists())
