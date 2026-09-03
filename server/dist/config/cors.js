"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOriginAllowed = exports.configuredOrigins = exports.lanOriginsAllowed = exports.LAN_ORIGIN = void 0;
const index_1 = require("./index");
/**
 * WHO MAY READ THIS API FROM A BROWSER.
 *
 * Lives in its own module rather than inline in `app.ts` for one practical
 * reason: importing `app.ts` pulls in every router, and the routers build their
 * repositories at module load, so a test that only wants to ask "is this origin
 * allowed?" would need a live database first. A policy this small should be
 * answerable on its own.
 *
 * The policy carries `credentials: true` (see `app.ts`), which is what makes it
 * matter: an origin reflected here can call the API **as the signed-in user**
 * and read the replies.
 */
/**
 * Loopback and the three RFC-1918 private ranges, any scheme, any port.
 *
 * Deliberately anchored at both ends. Without `$`, `http://192.168.1.50.evil.example`
 * would match its prefix; without `^`, so would `https://tasks.example.com@192.168.1.1`.
 * Note 11.x and 172.32.x are PUBLIC address space and must not match.
 */
exports.LAN_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i;
/**
 * KI-16: the LAN allowance is a DEV convenience, and it used to apply in
 * production too.
 *
 * Reflecting the whole private-address space means that on a ~100-person office
 * network, any page served from any machine on the LAN — a colleague's dev
 * server, a device somebody plugged in — could act as whoever was logged in. In
 * production the reason for the allowance does not exist: nginx serves the
 * client from the same origin as the API, so ordinary use is same-origin and
 * needs no CORS at all.
 *
 * Read per REQUEST, not at module load, so it is testable. The obvious
 * alternative — setting `NODE_ENV=prod` in a test — is the trap P2 documented:
 * `MailService` picks a REAL SMTP transport whenever `NODE_ENV` is not "test",
 * and this project's dev mailer delivers to real people (§A rule 4).
 */
const lanOriginsAllowed = () => {
    const override = process.env.CORS_ALLOW_LAN;
    if (override === "0" || override === "false")
        return false;
    if (override === "1" || override === "true")
        return true;
    return !index_1.Config.IS_PROD;
};
exports.lanOriginsAllowed = lanOriginsAllowed;
/** The origins named in `.env` — `FRONTEND_URL` plus `CORS_ALLOWED_ORIGINS`. */
const configuredOrigins = () => {
    const origins = [];
    if (index_1.Config.FRONTEND_URL)
        origins.push(index_1.Config.FRONTEND_URL);
    if (index_1.Config.CORS_ALLOWED_ORIGINS) {
        origins.push(...index_1.Config.CORS_ALLOWED_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean));
    }
    return origins;
};
exports.configuredOrigins = configuredOrigins;
/** The whole decision, in one place. */
const isOriginAllowed = (origin) => (0, exports.configuredOrigins)().includes(origin) ||
    ((0, exports.lanOriginsAllowed)() && exports.LAN_ORIGIN.test(origin));
exports.isOriginAllowed = isOriginAllowed;
