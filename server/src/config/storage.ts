import { Config } from "./index";

/**
 * WHERE THE BYTES ACTUALLY GO.
 *
 * `R2Service` ships with a deterministic no-network stub so the suite (and a
 * dev machine with no bucket) can exercise the whole attachment lifecycle
 * without credentials. That stub is a good idea in dev and a DISASTER in
 * production, which is KI-19:
 *
 *   the shipped client uploads through `POST /tasks/:id/attachments`, whose
 *   service calls `R2Service.putObject`. Under the stub that method is a no-op
 *   that resolves. The row is then marked `complete`, the API answers 201 with
 *   a plausible `https://r2.fake/...` URL, and the person sees their file
 *   attached to the task. Nothing was stored. Nothing failed. Nobody is told.
 *
 * So the mode is a first-class decision rather than a side effect of which
 * environment variables happen to be set, and it lives here — next to
 * `cors.ts`, which exists for the same reason — so it can be answered without
 * booting a router (they build repositories at import, which needs a database).
 *
 * Read per CALL, not at module load. The obvious way to test the production
 * branch — set `NODE_ENV=prod` — is the trap §A rule 4 documents: `MailService`
 * picks a REAL SMTP transport whenever `NODE_ENV` is not "test", and this
 * project's dev mailer delivers to real people. `STORAGE_ALLOW_STUB` is the
 * same escape hatch `CORS_ALLOW_LAN` gave KI-16, and it is genuinely useful in
 * ops too: a staging box can be told to refuse the stub without pretending to
 * be production.
 */

export type StorageMode =
    /** Real R2 credentials — objects are stored and retrieved for real. */
    | "live"
    /** Deterministic fakes, zero network. Dev/test only, and only on purpose. */
    | "stub"
    /** No credentials where fakes are NOT acceptable. Every call must fail loudly. */
    | "unavailable";

/** All four `CLOUDFLARE_R2_*` values present — anything less cannot sign. */
export const r2Configured = (): boolean =>
    Boolean(
        process.env.CLOUDFLARE_ACCOUNT_ID &&
            process.env.CLOUDFLARE_R2_ACCESS_KEY &&
            process.env.CLOUDFLARE_R2_SECRET_KEY &&
            process.env.CLOUDFLARE_R2_BUCKET,
    );

/**
 * May the no-network stub stand in for storage right now?
 *
 * Default: yes everywhere except production. `STORAGE_ALLOW_STUB=0` forces the
 * production answer without touching `NODE_ENV`; `=1` allows the stub even in
 * production, which is only ever right for a deliberate smoke test and is why
 * the value has to be typed out by a human.
 */
export const stubStorageAllowed = (): boolean => {
    const override = process.env.STORAGE_ALLOW_STUB;
    if (override === "0" || override === "false") return false;
    if (override === "1" || override === "true") return true;
    return !Config.IS_PROD;
};

/**
 * The whole decision, in one place.
 *
 * Under `NODE_ENV=test` the answer is never "live": `config/index.ts` layers
 * `.env.test` ON TOP of the base `.env`, so real R2 credentials leak into the
 * jest process the same way SMTP and VAPID ones do, and a suite that reached a
 * real bucket would write objects nobody ever cleans up.
 */
export const storageMode = (): StorageMode => {
    if (Config.NODE_ENV === "test") {
        return stubStorageAllowed() ? "stub" : "unavailable";
    }
    if (r2Configured()) return "live";
    return stubStorageAllowed() ? "stub" : "unavailable";
};
