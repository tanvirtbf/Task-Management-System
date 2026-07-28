"use strict";
/**
 * §16 attachment policy — the server-enforced upload rules. The spec is explicit
 * that size + MIME are validated BEFORE a signed URL is issued ("don't trust the
 * client to honour the policy"), so these live in one shared module consulted by
 * `POST /uploads/sign` (and reusable by the janitor/finalize sanity checks).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extForMime = exports.isMimeAllowed = exports.ALLOWED_MIME_TYPES = exports.READ_GET_TTL_SECONDS = exports.SIGN_PUT_TTL_SECONDS = exports.MAX_ATTACHMENT_BYTES = void 0;
/** 25 MB, per API_DESIGN §16 ("size ≤ 25 MB (configurable)"). */
exports.MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Signed PUT-URL validity for the upload step (API_DESIGN §16 `expires_in: 900`). */
exports.SIGN_PUT_TTL_SECONDS = 900;
/** Signed GET-URL validity for reads/downloads (Appendix A: "5-min validity"). */
exports.READ_GET_TTL_SECONDS = 300;
/**
 * Allowed upload MIME types — images + the common document formats a BeautyBooth
 * ops/CS team attaches to tasks. A request whose `mime_type` is not in this set
 * is rejected with `415 attachment.mime_not_allowed` before any signing.
 */
exports.ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
]);
/** Safe storage-key extension per MIME — never derived from the client filename. */
const MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
    "text/plain": "txt",
};
const isMimeAllowed = (mimeType) => exports.ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
exports.isMimeAllowed = isMimeAllowed;
/** The file extension for a validated MIME type (`bin` as a safe fallback). */
const extForMime = (mimeType) => MIME_EXTENSIONS[mimeType.toLowerCase()] ?? "bin";
exports.extForMime = extForMime;
