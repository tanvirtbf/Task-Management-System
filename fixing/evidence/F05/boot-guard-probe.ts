/**
 * F5 — importing the DB module runs the DB_TIMEZONE guard at module load.
 * The runner (boot-guard.sh) invokes this under different env combos and
 * asserts which ones refuse to start. Import only — no connection is made.
 */
import "../../../server/src/db/client";
console.log("BOOTED (no refusal)");
