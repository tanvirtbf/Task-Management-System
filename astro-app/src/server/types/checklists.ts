import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §15 Checklists. Identity + workspace scope
 * always come from `req.auth`; the body shapes below are what the validators
 * guarantee by the time a controller reads them.
 */

export interface CreateChecklistBody {
    name: string;
}
export interface CreateChecklistRequest extends AuthRequest {
    body: CreateChecklistBody;
}

export interface UpdateChecklistBody {
    name?: string;
    position?: number;
}
export interface UpdateChecklistRequest extends AuthRequest {
    body: UpdateChecklistBody;
}

export interface AddItemBody {
    text: string;
    assignee_id?: string | null;
    parent_item_id?: string | null;
    position?: number;
}
export interface AddItemRequest extends AuthRequest {
    body: AddItemBody;
}

export interface BulkAddItemsBody {
    texts: string[];
}
export interface BulkAddItemsRequest extends AuthRequest {
    body: BulkAddItemsBody;
}

export interface UpdateItemBody {
    text?: string;
    assignee_id?: string | null;
    position?: number;
}
export interface UpdateItemRequest extends AuthRequest {
    body: UpdateItemBody;
}

/** Endpoints that read only `:id` + auth (GET task lists, deletes, toggle). */
export type ChecklistReadRequest = AuthRequest;
