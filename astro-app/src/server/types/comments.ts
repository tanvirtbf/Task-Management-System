import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §14 Comments. Identity + workspace scope
 * always come from `req.auth`; the body shapes below are what the validators
 * guarantee by the time a controller reads them.
 */

export interface CreateCommentBody {
    body: string;
    /** A top-level comment id to reply to. Replies cannot themselves be replied to. */
    parent_comment_id?: string | null;
}
export interface CreateCommentRequest extends AuthRequest {
    body: CreateCommentBody;
}

export interface UpdateCommentBody {
    body: string;
}
export interface UpdateCommentRequest extends AuthRequest {
    body: UpdateCommentBody;
}

/** `GET /tasks/:id/comments` and `DELETE /comments/:id` read only `:id` + auth. */
export type ListCommentsRequest = AuthRequest;
export type DeleteCommentRequest = AuthRequest;
