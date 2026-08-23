#!/usr/bin/env node
/**
 * Machine-readable completion gate.
 * Parses PROJECT_STATUS.md and exits non-zero if any mandatory P0 item
 * is not VERIFIED (BLOCKED_EXTERNAL is allowed only for P1 items).
 *
 * Usage: pnpm verify:completion
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const md = readFileSync(join(root, "PROJECT_STATUS.md"), "utf8");

const rows = [
  ...md.matchAll(
    // Tolerant of prettier column alignment (variable spaces around pipes).
    /^\|\s*(P[01]-\d+[a-z0-9.]*)\s*\|\s*(P[01])\s*\|.*\|\s*(NOT_STARTED|IN_PROGRESS|BLOCKED_EXTERNAL|FAILED|VERIFIED)\s*\|/gim,
  ),
];

if (rows.length === 0) {
  console.error("FAIL: no status rows parsed from PROJECT_STATUS.md");
  process.exit(1);
}

// Mandatory = P0 rows only. P1 rows are roadmap/advisory: they are reported
// but never fail the gate (the repository's completion condition is
// "all mandatory P0 issues VERIFIED", per the recovery protocol).
const failures = [];
const advisory = [];
for (const [, id, pri, status] of rows) {
  if (status === "VERIFIED") continue;
  if (pri === "P0") {
    failures.push(`${id} [${pri}] = ${status}`);
  } else {
    advisory.push(`${id} [${pri}] = ${status}`);
  }
}

console.log(`Parsed ${rows.length} ledger entries.`);
if (advisory.length > 0) {
  console.log(`P1 roadmap items not yet VERIFIED (advisory, non-blocking):`);
  for (const a of advisory) console.log(`  • ${a}`);
}
if (failures.length > 0) {
  console.error(`COMPLETION GATE FAILED — ${failures.length} non-verified mandatory P0 item(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("COMPLETION GATE PASSED — all P0 items VERIFIED.");
