"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageMode = exports.stubStorageAllowed = exports.r2Configured = void 0;
const index_1 = require("./index");
/** All four `CLOUDFLARE_R2_*` values present — anything less cannot sign. */
const r2Configured = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY &&
    process.env.CLOUDFLARE_R2_SECRET_KEY &&
    process.env.CLOUDFLARE_R2_BUCKET);
exports.r2Configured = r2Configured;
/**
 * May the no-network stub stand in for storage right now?
 *
 * Default: yes everywhere except production. `STORAGE_ALLOW_STUB=0` forces the
 * production answer without touching `NODE_ENV`; `=1` allows the stub even in
 * production, which is only ever right for a deliberate smoke test and is why
 * the value has to be typed out by a human.
 */
const stubStorageAllowed = () => {
    const override = process.env.STORAGE_ALLOW_STUB;
    if (override === "0" || override === "false")
        return false;
    if (override === "1" || override === "true")
        return true;
    return !index_1.Config.IS_PROD;
};
exports.stubStorageAllowed = stubStorageAllowed;
/**
 * The whole decision, in one place.
 *
 * Under `NODE_ENV=test` the answer is never "live": `config/index.ts` layers
 * `.env.test` ON TOP of the base `.env`, so real R2 credentials leak into the
 * jest process the same way SMTP and VAPID ones do, and a suite that reached a
 * real bucket would write objects nobody ever cleans up.
 */
const storageMode = () => {
    if (index_1.Config.NODE_ENV === "test") {
        return (0, exports.stubStorageAllowed)() ? "stub" : "unavailable";
    }
    if ((0, exports.r2Configured)())
        return "live";
    return (0, exports.stubStorageAllowed)() ? "stub" : "unavailable";
};
exports.storageMode = storageMode;
