"use strict";
// =============================================================================
// F23 — shared pagination helpers (ISS-007 · ISS-008).
//
// ISS-007: four §1 collection endpoints (/lists, /spaces, /tags, /task-types)
// returned the full `{data, pagination}` envelope with `has_more: false` no
// matter what `limit` was passed — every row, always. `paginateArray` gives
// them a real limit + a working opaque cursor without teaching four
// position-ordered repos keyset pagination they do not need (the sets are
// dozens of rows, read whole and sliced here).
//
// ISS-008: cursors the server never issued were half-accepted. `garbage` is
// alphanumeric, so lenient base64 decoding produced mojibake that silently
// restarted pagination at page 1 — WITH a fresh next_cursor, so a client that
// retries a corrupted cursor loops forever. And a tampered
// `<valid-cursor>XX` decoded to a different window. `strictDecodeCursor`
// refuses both: the decoded text must round-trip to the exact input bytes and
// contain only printable ASCII.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateArray = exports.parseLimit = exports.strictDecodeCursor = exports.MAX_LIMIT = exports.DEFAULT_LIMIT = void 0;
const errors_1 = require("../errors");
/** §1 defaults for the collection family. */
exports.DEFAULT_LIMIT = 100;
exports.MAX_LIMIT = 200;
/**
 * Decode an opaque cursor STRICTLY: base64url alphabet only, must decode to
 * printable ASCII, and must re-encode to the byte-identical input. Everything
 * else is `400 pagination.invalid_cursor` — the rule ISS-008 asks for: every
 * cursor this server did not issue is refused.
 */
const strictDecodeCursor = (cursor) => {
    const fail = () => {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    };
    if (!/^[A-Za-z0-9_-]+$/.test(cursor))
        fail();
    const buf = Buffer.from(cursor, "base64url");
    const decoded = buf.toString("utf8");
    if (decoded.length === 0)
        fail();
    // eslint-disable-next-line no-control-regex
    if (/[^\x20-\x7E]/.test(decoded))
        fail();
    if (buf.toString("base64url") !== cursor)
        fail();
    return decoded;
};
exports.strictDecodeCursor = strictDecodeCursor;
/** Parse `?limit` with the §1 default/max; a non-integer or out-of-range value is a clean 422. */
const parseLimit = (raw) => {
    if (raw === undefined)
        return exports.DEFAULT_LIMIT;
    const s = String(raw);
    if (!/^\d+$/.test(s)) {
        throw errors_1.AppError.validationFailed([
            { field: "limit", issue: "must be a positive integer" },
        ]);
    }
    const n = Number(s);
    if (n < 1 || n > exports.MAX_LIMIT) {
        throw errors_1.AppError.validationFailed([
            { field: "limit", issue: `must be between 1 and ${exports.MAX_LIMIT}` },
        ]);
    }
    return n;
};
exports.parseLimit = parseLimit;
/**
 * Slice an already-ordered, fully-read collection into the §1 envelope with a
 * REAL limit and a working offset cursor (`o:<n>`, opaque to clients).
 */
const paginateArray = (rows, rawLimit, rawCursor) => {
    const limit = (0, exports.parseLimit)(rawLimit);
    let offset = 0;
    if (rawCursor !== undefined) {
        const decoded = (0, exports.strictDecodeCursor)(String(rawCursor));
        const m = /^o:(\d{1,9})$/.exec(decoded);
        if (!m) {
            throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
        }
        offset = Number(m[1]);
    }
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < rows.length;
    return {
        data: page,
        pagination: {
            next_cursor: hasMore
                ? Buffer.from(`o:${nextOffset}`, "utf8").toString("base64url")
                : null,
            has_more: hasMore,
            total_estimate: rows.length,
        },
    };
};
exports.paginateArray = paginateArray;
