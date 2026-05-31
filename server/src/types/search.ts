/**
 * §24 Search types.
 *
 * Search has no request body — only `?q=&types=&limit=` query params (parsed in
 * the controller). The one shape worth naming is the wire `Comment` returned in
 * results: §14 Comments is not built and has no serializer, so search emits its
 * own snake_case projection that mirrors the actual `comments` table (NOT the
 * frontend `Comment` type, which carries reactions/resolve fields the DB lacks).
 */

/** The five resource kinds search can match. (`note` is intentionally absent — no notes table.) */
export type SearchType = "task" | "list" | "space" | "user" | "comment";

/**
 * Wire `Comment` for search results — mirrors `comments` schema columns.
 * `internal_id` and `deleted_at` never cross the wire (internal-only); soft-
 * deleted comments are excluded from results entirely.
 */
export interface WireSearchComment {
    id: string;
    task_id: string;
    parent_comment_id: string | null;
    author_id: string;
    body: string;
    edited_at: string | null;
    created_at: string;
}
