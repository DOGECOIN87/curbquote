#!/usr/bin/env python3
"""Adapted from the supplied authorized_property_ingest.py.

Uses CurbQuote's shared Node adapter for approved-grant enforcement, field mapping,
validation, DNS-pinned HTTPS, bounded responses and safe errors. Requires Node 22+.
No raw provider response is stored. The original attachment remains unchanged.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

ADAPTER = Path(__file__).resolve().parents[1] / "scripts" / "property-ingest.mjs"


def fetch_provider_record(address: str) -> dict:
    try:
        result = subprocess.run(["node", str(ADAPTER), address], capture_output=True, text=True, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("The shared property adapter could not run. Check Node 22+ and provider configuration.") from None
    if result.returncode:
        raise RuntimeError("Authorized property lookup or export was denied or unavailable. Check the provider grant and server configuration.")
    try:
        record = json.loads(result.stdout)
        if not isinstance(record, dict) or not isinstance(record.get("facts"), dict) or not isinstance(record.get("source"), dict):
            raise ValueError
        if record["source"].get("permissions", {}).get("mayExport") is not True:
            raise ValueError
    except (ValueError, TypeError):
        raise RuntimeError("The shared property adapter returned an invalid or restricted record.") from None
    return record


def store_normalized_record(db_path: str, record: dict) -> None:
    source = record["source"]
    if source.get("permissions", {}).get("mayStore") is not True or source.get("expiresAt") is not None or source.get("retentionDays") is not None:
        raise PermissionError("This grant does not permit unmanaged SQLite retention. Use --no-store only if export is permitted.")
    normalized_address = " ".join(str(record["facts"].get("address", "")).split()).casefold()
    if not normalized_address:
        raise ValueError("A provider-reported address is required before storing a property record.")
    path = Path(db_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        # v2 keeps immutable snapshots; it does not overwrite the supplied script's legacy table.
        connection.execute("""CREATE TABLE IF NOT EXISTS property_snapshots_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            normalized_address TEXT NOT NULL,
            facts_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            retrieved_at TEXT NOT NULL
        )""")
        connection.execute("CREATE INDEX IF NOT EXISTS property_snapshots_v2_lookup ON property_snapshots_v2(provider, normalized_address, retrieved_at DESC)")
        connection.execute("INSERT INTO property_snapshots_v2(provider,normalized_address,facts_json,source_json,retrieved_at) VALUES(?,?,?,?,?)", (
            record["provider"], normalized_address,
            json.dumps(record["facts"], separators=(",", ":")),
            json.dumps(source, separators=(",", ":")), record["retrieved_at"],
        ))


def main() -> int:
    parser = argparse.ArgumentParser(description="Import one property through CurbQuote's authorized JSON adapter.")
    parser.add_argument("address", help="Property address to look up")
    parser.add_argument("--db", default="~/.property_adapter_mvp.sqlite3", help="Local SQLite path")
    parser.add_argument("--no-store", action="store_true", help="Print the permitted normalized export without storing it")
    args = parser.parse_args()
    try:
        record = fetch_provider_record(args.address)
        if not args.no_store:
            store_normalized_record(args.db, record)
        record["stored"] = not args.no_store
        print(json.dumps(record, indent=2, ensure_ascii=False))
        return 0
    except (ValueError, PermissionError, RuntimeError, OSError, sqlite3.Error):
        print("error: Property import could not complete. Check the approved grant, export/storage permissions, Node runtime and database access.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
