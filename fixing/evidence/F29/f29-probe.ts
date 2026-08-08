/**
 * F29 probe — ISS-039 · ISS-043 · ISS-045 · ISS-068, re-runnable.
 *
 *     cd server && npx tsx ../fixing/evidence/F29/f29-probe.ts
 *
 * F29 is four HTTP-behaviour fixes, and the authoritative proof is the 29 new
 * jest specs across tasks/create, tasks/update, checklists, templates/create
 * and custom-fields/set-value (see gate.txt). This probe covers the two layers
 * jest reaches only indirectly:
 *
 *   1. the VALIDATOR chains, exercised for real via `chain.run()` on plain
 *      request objects (no internals, no source matching) — pr_url's URL rule
 *      and both ISS-068 caps live there;
 *   2. the ICU runtime precondition the money fix leans on:
 *      `Intl.supportedValuesOf("currency")` must exist, contain BDT, and NOT
 *      contain junk — if a future Node build shipped small-icu, the currency
 *      check would silently degrade to format-only, and this is the tripwire.
 *
 * The service-level halves (ISS-039's type gate, phone/money depth) need a DB
 * and are proven by the jest suites alone, on purpose.
 */
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
    if (cond) {
        pass += 1;
        console.log("  PASS  " + label + (detail ? "   " + detail : ""));
    } else {
        fail += 1;
        console.log("  FAIL  " + label + (detail ? "   " + detail : ""));
    }
};
const section = (s: string) => console.log("\n--- " + s + " ---");

type Chain = { run: (req: unknown) => Promise<unknown> };

const main = async () => {
    console.log("================ F29 PROBE (ISS-039/043/045/068) ================");

    const { validationResult } = await import(
        "../../../server/node_modules/express-validator/lib/index.js"
    );
    const runChains = async (
        chains: unknown,
        body: Record<string, unknown>,
        params: Record<string, string> = { id: "x-1" },
    ) => {
        const req = { params, body, query: {}, headers: {}, cookies: {} };
        for (const chain of chains as Chain[]) await chain.run(req);
        return validationResult(req);
    };
    const errorFields = (result: {
        array: () => Array<{ path?: string; param?: string }>;
    }): string[] => result.array().map((e) => e.path ?? e.param ?? "?");

    // ── ISS-045: pr_url is a URL on BOTH task validators ─────────────────────
    section("ISS-045 — pr_url refuses javascript: (create AND update chains)");
    const { createTaskValidator, updateTaskValidator } = await import(
        "../../../server/src/validators/tasks"
    );
    for (const [label, chains] of [
        ["create", createTaskValidator],
        ["update", updateTaskValidator],
    ] as const) {
        const bad = await runChains(chains, {
            name: "x",
            primary_list_id: "l-1",
            pr_url: "javascript:alert(1)",
        });
        ok(
            label + ": javascript: pr_url is refused",
            errorFields(bad).includes("pr_url"),
        );
        const good = await runChains(chains, {
            name: "x",
            primary_list_id: "l-1",
            pr_url: "https://github.com/x/y/pull/1",
        });
        ok(
            label + ": an https PR link passes",
            !errorFields(good).includes("pr_url"),
        );
        const cleared = await runChains(chains, {
            name: "x",
            primary_list_id: "l-1",
            pr_url: null,
        });
        ok(
            label + ": explicit null (clearing) passes",
            !errorFields(cleared).includes("pr_url"),
        );
    }

    // ── ISS-068: both entry points capped at 200 ─────────────────────────────
    section("ISS-068 — the 200-item caps");
    const { bulkAddItemsValidator } = await import(
        "../../../server/src/validators/checklists"
    );
    const texts = (n: number) =>
        Array.from({ length: n }, (_, i) => "Step " + (i + 1));
    const bulk201 = await runChains(bulkAddItemsValidator, { texts: texts(201) });
    ok("bulk: 201 items refused", errorFields(bulk201).includes("texts"));
    const bulk200 = await runChains(bulkAddItemsValidator, { texts: texts(200) });
    ok("bulk: 200 items pass (the cap itself)", bulk200.isEmpty());

    const { createTemplateValidator } = await import(
        "../../../server/src/validators/templates"
    );
    const structure = (n: number) => ({
        type: "task",
        name: "Playbook",
        structure: {
            checklistName: "Steps",
            checklistItems: texts(n).map((t) => ({ text: t })),
        },
    });
    const tpl201 = await runChains(createTemplateValidator, structure(201));
    ok(
        "template: a structure carrying 201 items is refused",
        errorFields(tpl201).some((f) => String(f).includes("checklistItems")),
    );
    const tpl200 = await runChains(createTemplateValidator, structure(200));
    ok(
        "template: 200 items pass",
        !errorFields(tpl200).some((f) => String(f).includes("checklistItems")),
    );

    // ── ISS-043: the ICU precondition under the currency check ───────────────
    section("ISS-043 — ICU currency-list precondition (the money check's spine)");
    const intl = Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
    };
    const currencies = intl.supportedValuesOf?.("currency") ?? [];
    ok("Intl.supportedValuesOf('currency') exists and is populated", currencies.length > 100, String(currencies.length));
    ok("BDT is a known currency", currencies.includes("BDT"));
    ok("USD is a known currency", currencies.includes("USD"));
    ok("XYZ is NOT (the junk the check refuses)", !currencies.includes("XYZ"));
    ok("NOTACURRENCY fails even the format rule", !/^[A-Z]{3}$/.test("NOTACURRENCY"));

    // ── ISS-039/043 service halves — where the proof lives ───────────────────
    section("ISS-039 + phone/money service depth — proven by jest (see gate.txt)");
    console.log(
        "  INFO  tasks/create.test.ts  +7 specs (not_dev_type / severity_requires_bug_type / dev 201 / nulls)",
    );
    console.log(
        "  INFO  tasks/update.test.ts  +6 specs (patch gate / flip-to-dev 200 / re-type CLEARS git+severity+SLA)",
    );
    console.log(
        "  INFO  custom-fields/set-value.test.ts  +12 specs (BD forms, opt-out, negative amount, ISO-4217)",
    );

    console.log("\n================================================");
    console.log("  " + pass + " passed, " + fail + " failed");
    process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
    console.error("PROBE ERROR " + (e as Error).message);
    process.exit(1);
});
