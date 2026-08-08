/**
 * F12 — the password policy's decision table, as a runnable check.
 *
 * Every row is either an ISS-083 example that MUST be refused, a fixture the
 * existing suite depends on, or a case that would be wrong to refuse.
 */
import { passwordPolicyError } from "../../../server/src/validators/passwordPolicy";

const CASES: Array<[string, boolean, string]> = [
    // ── ISS-083's five, all previously accepted (204) ────────────────────────
    ["password", false, "ISS-083 — the most common password in the world"],
    ["12345678", false, "ISS-083 — sequential digits"],
    ["PASSWORD", false, "ISS-083 — dictionary word"],
    ["aaaaaaaa", false, "ISS-083 — one character repeated"],
    ["alllowercase", false, "ISS-083 — 12 letters, one class"],
    // ── the same class, added by F12 ─────────────────────────────────────────
    ["Password1!", false, "denylist survives decoration"],
    ["password123", false, "denylist survives trailing digits"],
    ["abcdefgh", false, "straight alphabet run"],
    ["qwerty123", false, "keyboard walk"],
    ["11111111", false, "repeated character"],
    ["short7!", false, "below the 8-char minimum"],
    ["beautybooth", false, "the company's own name"],
    // ── must still be ACCEPTED ───────────────────────────────────────────────
    ["Str0ng#Pass", true, "4 classes, 11 chars"],
    ["correct horse battery staple", true, "passphrase — length exempts it"],
    ["পাসওয়ার্ড🔥1", true, "Bangla + emoji — non-ASCII exempts it"],
    ["Ünïcödé-Pass", true, "accented Latin — non-ASCII exempt"],
    // ── fixtures the existing ~3,500-test suite depends on ───────────────────
    ["OldPass#1", true, "existing test fixture"],
    ["NewPass#2", true, "existing test fixture"],
    ["SamePass#1", true, "existing test fixture"],
    ["Another1!", true, "existing test fixture"],
    ["An0ther#Pass", true, "existing test fixture"],
    ["passwordA-distinct", true, "contains 'password' but is not it"],
    ["passwordB-distinct", true, "contains 'password' but is not it"],
    ["Owner@12345", true, "the seeded demo credential"],
];

let bad = 0;
const pad = (s: string, n: number) => s.padEnd(n);
console.log("\n  === F12 password policy — decision table ===\n");
console.log("  " + pad("candidate", 32) + pad("want", 9) + pad("got", 9) + "reason");
for (const [pw, shouldPass, why] of CASES) {
    const err = passwordPolicyError(pw);
    const passed = err === null;
    const ok = passed === shouldPass;
    if (!ok) bad++;
    console.log(
        "  " +
            pad(JSON.stringify(pw).slice(0, 31), 32) +
            pad(shouldPass ? "accept" : "refuse", 9) +
            pad((ok ? "" : "*** ") + (passed ? "accept" : "refuse"), 9) +
            (passed ? why : (err ?? "")).slice(0, 58),
    );
}
console.log(
    bad === 0
        ? "\n  PASS — " + CASES.length + "/" + CASES.length + " decisions correct.\n"
        : "\n  *** " + bad + " WRONG DECISION(S) ***\n",
);
process.exit(bad === 0 ? 0 : 1);
