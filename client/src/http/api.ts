import type {
    Credentials,
    Folder,
    HomeKpiSet,
    List,
    LoginResponse,
    MyWorkBucket,
    Notification,
    Space,
    Status,
    Tag,
    Task,
    TaskType,
    User,
    Workspace,
} from "../types";
import type {
    CustomField,
    Form,
    FormFieldDef,
    FormSubmission,
} from "../types/custom-fields";
import type { Template } from "../types/template";
import type {
    Attachment,
    Checklist,
    ChecklistItem,
    Comment,
} from "../types/extras";
import type { Sprint, SprintStatus } from "../types/sprint";
import { api, unwrapData } from "./client";
import {
    flattenDependencies,
    mapAttachment,
    mapNotification,
    mapOnCallShift,
    mapTask,
    mapWorkspace,
    taskToWire,
    workspaceToWire,
    type FlatDependency,
    type OnCallShiftView,
    type TaskActivityEntry,
    type WireAttachment,
    type WireNotification,
    type WireDependenciesView,
    type WireOnCallShift,
    type WireTask,
    type WireWorkspace,
} from "./mappers";

/**
 * Real backend endpoint functions. Responses are snake→camel converted by the
 * `client.ts` interceptor; collection endpoints are `{data,pagination}` (unwrap
 * with `unwrapData`) unless noted BARE. The few structurally-different resources
 * (workspace, task) go through the per-resource mappers.
 *
 * Method names mirror the mock-api surface so call-sites migrate 1:1
 * (`mockApi.spaces.list()` → `spacesApi.list()`).
 */

// ─── Auth (§2) ────────────────────────────────────────────────────────────────
export const authApi = {
    login: async (credentials: Credentials): Promise<LoginResponse> =>
        (await api.post<LoginResponse>("/auth/login", credentials)).data,
    me: async (): Promise<User> => (await api.get<User>("/auth/me")).data,
    logout: async (): Promise<void> => {
        await api.post("/auth/logout");
    },
    logoutAll: async (): Promise<void> => {
        await api.post("/auth/logout-all");
    },
    // 204 — verifies the current password server-side, then rotates it. Other
    // sessions stay valid (V1 — no forced global sign-out).
    changePassword: async (
        currentPassword: string,
        newPassword: string,
    ): Promise<void> => {
        await api.post("/auth/change-password", {
            currentPassword,
            newPassword,
        });
    },
    forgotPassword: async (email: string): Promise<void> => {
        await api.post("/auth/forgot-password", { email });
    },
    resetPassword: async (token: string, newPassword: string): Promise<void> => {
        await api.post("/auth/reset-password", { token, newPassword });
    },
};

// ─── Workspace (§3) ─ FLAT wire ↔ nested FE settings; bare object ─────────────
export const workspaceApi = {
    get: async (): Promise<Workspace> =>
        mapWorkspace((await api.get<WireWorkspace>("/workspace")).data),
    update: async (patch: Partial<Workspace>): Promise<Workspace> =>
        mapWorkspace(
            (
                await api.patch<WireWorkspace>(
                    "/workspace",
                    workspaceToWire(patch),
                )
            ).data,
        ),
};

// ─── Spaces (§5) ─ list is {data}; single is bare ─────────────────────────────
export const spacesApi = {
    list: async (): Promise<Space[]> =>
        unwrapData<Space[]>(await api.get<{ data: Space[] }>("/spaces")),
    getById: async (id: string): Promise<Space> =>
        (await api.get<Space>(`/spaces/${id}`)).data,
    create: async (input: Partial<Space>): Promise<Space> =>
        (await api.post<Space>("/spaces", input)).data,
    update: async (id: string, patch: Partial<Space>): Promise<Space> =>
        (await api.patch<Space>(`/spaces/${id}`, patch)).data,
    archive: async (id: string): Promise<void> => {
        await api.post(`/spaces/${id}/archive`);
    },
    unarchive: async (id: string): Promise<void> => {
        await api.post(`/spaces/${id}/unarchive`);
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/spaces/${id}`);
    },
};

// ─── Users (§4) ─ list is {data}; single is bare ─────────────────────────────
export const usersApi = {
    list: async (): Promise<User[]> =>
        unwrapData<User[]>(await api.get<{ data: User[] }>("/users")),
    getById: async (id: string): Promise<User> =>
        (await api.get<User>(`/users/${id}`)).data,
    invite: async (input: {
        firstName: string;
        lastName: string;
        email: string;
        role: User["role"];
    }): Promise<User> => (await api.post<User>("/users/invite", input)).data,
    updateRole: async (id: string, role: User["role"]): Promise<User> =>
        (await api.patch<User>(`/users/${id}/role`, { role })).data,
    updateProfile: async (
        id: string,
        patch: Partial<
            Pick<
                User,
                "firstName" | "lastName" | "email" | "timezone" | "avatarUrl"
            >
        >,
    ): Promise<User> => (await api.patch<User>(`/users/${id}`, patch)).data,
    // 204 — the row rules (owner-immutable, no-self) live server-side.
    deactivate: async (id: string): Promise<void> => {
        await api.post(`/users/${id}/deactivate`);
    },
    reactivate: async (id: string): Promise<void> => {
        await api.post(`/users/${id}/reactivate`);
    },
    // 202 — admin-triggered password-reset email (NOT a self change-password).
    resetPassword: async (id: string): Promise<void> => {
        await api.post(`/users/${id}/reset-password`);
    },
};

// ─── Lists (§6) ─ collections are {data}; single is bare; folderId is FE-only ─
export const listsApi = {
    listAll: async (): Promise<List[]> =>
        unwrapData<List[]>(await api.get<{ data: List[] }>("/lists")),
    listBySpace: async (spaceId: string): Promise<List[]> =>
        unwrapData<List[]>(
            await api.get<{ data: List[] }>(`/spaces/${spaceId}/lists`),
        ),
    getById: async (id: string): Promise<List> =>
        (await api.get<List>(`/lists/${id}`)).data,
    create: async (input: Partial<List>): Promise<List> =>
        (await api.post<List>("/lists", input)).data,
    update: async (id: string, patch: Partial<List>): Promise<List> =>
        (await api.patch<List>(`/lists/${id}`, patch)).data,
    archive: async (id: string): Promise<void> => {
        await api.post(`/lists/${id}/archive`);
    },
    unarchive: async (id: string): Promise<void> => {
        await api.post(`/lists/${id}/unarchive`);
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/lists/${id}`);
    },
};

// ─── Statuses (§7) ─ BARE array (no envelope); CRUD spans /lists + /statuses ──
export const statusesApi = {
    byList: async (listId: string): Promise<Status[]> =>
        (await api.get<Status[]>(`/lists/${listId}/statuses`)).data,
    create: async (listId: string, input: Partial<Status>): Promise<Status> =>
        (await api.post<Status>(`/lists/${listId}/statuses`, input)).data,
    update: async (id: string, patch: Partial<Status>): Promise<Status> =>
        (await api.patch<Status>(`/statuses/${id}`, patch)).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/statuses/${id}`);
    },
    /** Bulk-reposition a list's statuses; body is a bare `{id,position}[]`. */
    reorder: async (
        listId: string,
        items: { id: string; position: number }[],
    ): Promise<Status[]> =>
        (await api.patch<Status[]>(`/lists/${listId}/statuses/reorder`, items))
            .data,
};

// ─── Task types (§8) ─ {data} envelope; create/update bare; workspace-scoped ──
export const taskTypesApi = {
    list: async (): Promise<TaskType[]> =>
        unwrapData<TaskType[]>(
            await api.get<{ data: TaskType[] }>("/task-types"),
        ),
    create: async (input: Partial<TaskType>): Promise<TaskType> =>
        (await api.post<TaskType>("/task-types", input)).data,
    update: async (id: string, patch: Partial<TaskType>): Promise<TaskType> =>
        (await api.patch<TaskType>(`/task-types/${id}`, patch)).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/task-types/${id}`);
    },
};

// ─── Tags (§9) ─ {data} envelope; create/update bare. Tags are WORKSPACE-WIDE ─
// server-side (no space scoping), so `bySpace` returns the full set — the param
// is kept for call-site compatibility but ignored.
export const tagsApi = {
    list: async (): Promise<Tag[]> =>
        unwrapData<Tag[]>(await api.get<{ data: Tag[] }>("/tags")),
    bySpace: async (_spaceId?: string): Promise<Tag[]> =>
        unwrapData<Tag[]>(await api.get<{ data: Tag[] }>("/tags")),
    create: async (input: { name: string; color?: string }): Promise<Tag> =>
        (await api.post<Tag>("/tags", input)).data,
    update: async (
        id: string,
        patch: { name?: string; color?: string },
    ): Promise<Tag> => (await api.patch<Tag>(`/tags/${id}`, patch)).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/tags/${id}`);
    },
};

// ─── Folders ─ NO BACKEND (hierarchy is Workspace→Space→List). Always empty. ──
export const foldersApi = {
    list: async (): Promise<Folder[]> => [],
    listBySpace: async (): Promise<Folder[]> => [],
};

// ─── Custom fields (§17) ─ BARE arrays; definition CRUD (task VALUES are P3) ──
export const customFieldsApi = {
    list: async (): Promise<CustomField[]> =>
        (await api.get<CustomField[]>("/custom-fields")).data,
    byList: async (listId: string): Promise<CustomField[]> =>
        (await api.get<CustomField[]>(`/lists/${listId}/custom-fields`)).data,
    create: async (input: Partial<CustomField>): Promise<CustomField> =>
        (await api.post<CustomField>("/custom-fields", input)).data,
    update: async (
        id: string,
        patch: Partial<CustomField>,
    ): Promise<CustomField> =>
        (await api.patch<CustomField>(`/custom-fields/${id}`, patch)).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/custom-fields/${id}`);
    },
};

// ─── Templates (§23) ─ list {data}; single/create/update bare; apply→result ───
export const templatesApi = {
    list: async (): Promise<Template[]> =>
        unwrapData<Template[]>(
            await api.get<{ data: Template[] }>("/templates"),
        ),
    byType: async (type: Template["type"]): Promise<Template[]> =>
        unwrapData<Template[]>(
            await api.get<{ data: Template[] }>("/templates", {
                params: { type },
            }),
        ),
    getById: async (id: string): Promise<Template> =>
        (await api.get<Template>(`/templates/${id}`)).data,
    // `structure` keys are verbatim camelCase on the wire → skip the request
    // decamelize (would rename taskTypeId→task_type_id and drop the structure).
    create: async (input: Partial<Template>): Promise<Template> =>
        (
            await api.post<Template>("/templates", input, {
                skipDecamelize: true,
            })
        ).data,
    update: async (id: string, patch: Partial<Template>): Promise<Template> =>
        (
            await api.patch<Template>(`/templates/${id}`, patch, {
                skipDecamelize: true,
            })
        ).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/templates/${id}`);
    },
    apply: async (
        id: string,
        input: {
            taskName?: string;
            name?: string;
            listId?: string;
            spaceId?: string;
            anchorDate?: string;
        },
    ): Promise<{ entityId: string; entityType: string; message: string }> =>
        (
            await api.post<{
                entityId: string;
                entityType: string;
                message: string;
            }>(`/templates/${id}/apply`, input)
        ).data,
};

// ─── Tasks (§10) ─ list is {data}; single/my-work/subtasks are bare ───────────
export const tasksApi = {
    listByList: async (listId: string): Promise<Task[]> =>
        unwrapData<WireTask[]>(
            await api.get<{ data: WireTask[] }>(`/lists/${listId}/tasks`),
        ).map(mapTask),
    getById: async (id: string): Promise<Task> =>
        mapTask((await api.get<WireTask>(`/tasks/${id}`)).data),
    subtasks: async (parentId: string): Promise<Task[]> =>
        (await api.get<WireTask[]>(`/tasks/${parentId}/subtasks`)).data.map(
            mapTask,
        ),
    /** Buckets: today/overdue/next/unscheduled/done (bare object). JWT-derived. */
    myWork: async (): Promise<MyWorkBucket> => {
        const b = (await api.get<Record<string, WireTask[]>>("/tasks/my-work"))
            .data;
        const bucket = (k: string): Task[] => (b[k] ?? []).map(mapTask);
        return {
            today: bucket("today"),
            overdue: bucket("overdue"),
            next: bucket("next"),
            unscheduled: bucket("unscheduled"),
            done: bucket("done"),
        };
    },
    create: async (
        input: Partial<Task> & { name: string; primaryListId: string },
    ): Promise<Task> =>
        mapTask((await api.post<WireTask>("/tasks", taskToWire(input))).data),
    // NOTE: optimistic-concurrency (ETag/If-Match) is deferred (R4) — this PATCH
    // is last-write-wins until then (If-Match is opt-in server-side).
    update: async (id: string, patch: Partial<Task>): Promise<Task> =>
        mapTask(
            (await api.patch<WireTask>(`/tasks/${id}`, taskToWire(patch))).data,
        ),
    bulkUpdate: async (ids: string[], patch: Partial<Task>): Promise<Task[]> => {
        const res = await api.post<{ tasks: WireTask[] }>("/tasks/bulk", {
            taskIds: ids,
            patch: taskToWire(patch),
        });
        return (res.data.tasks ?? []).map(mapTask);
    },
    archive: async (id: string): Promise<void> => {
        await api.post(`/tasks/${id}/archive`);
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/tasks/${id}`);
    },
    // ─ §11 membership: delta mutations (204). PATCH does NOT accept these ─────
    addAssignees: async (id: string, userIds: string[]): Promise<void> => {
        await api.post(`/tasks/${id}/assignees`, { userIds });
    },
    removeAssignee: async (id: string, userId: string): Promise<void> => {
        await api.delete(`/tasks/${id}/assignees/${userId}`);
    },
    addTags: async (id: string, tagIds: string[]): Promise<void> => {
        await api.post(`/tasks/${id}/tags`, { tagIds });
    },
    removeTag: async (id: string, tagId: string): Promise<void> => {
        await api.delete(`/tasks/${id}/tags/${tagId}`);
    },
    watch: async (id: string): Promise<void> => {
        await api.post(`/tasks/${id}/watchers/self`);
    },
    unwatch: async (id: string): Promise<void> => {
        await api.delete(`/tasks/${id}/watchers/self`);
    },
    // §17 custom-field VALUES: PUT the per-type envelope ({text}/{option_id}/…) —
    // returns the full Task; DELETE clears it (204). PATCH does NOT carry these.
    // Envelope keys are verbatim snake on the wire (client.ts treats
    // `custom_field_values` as an opaque blob both ways), so no extra mapping.
    setCustomField: async (
        id: string,
        fieldId: string,
        value: unknown,
    ): Promise<Task> =>
        mapTask(
            (
                await api.put<WireTask>(
                    `/tasks/${id}/custom-fields/${fieldId}`,
                    value as object,
                )
            ).data,
        ),
    clearCustomField: async (id: string, fieldId: string): Promise<void> => {
        await api.delete(`/tasks/${id}/custom-fields/${fieldId}`);
    },
};

// ─── Task activity (§13) ─ {data,pagination} cursor; `actor` hydrated to User ─
export const taskActivityApi = {
    byTask: async (taskId: string): Promise<TaskActivityEntry[]> =>
        unwrapData<TaskActivityEntry[]>(
            await api.get<{ data: TaskActivityEntry[] }>(
                `/tasks/${taskId}/activity`,
            ),
        ),
};

// ─── Task dependencies (§12) ─ {blocks,blocked_by} (other-end hydrated) → flat ─
export const dependenciesApi = {
    byTask: async (taskId: string): Promise<FlatDependency[]> =>
        flattenDependencies(
            (
                await api.get<WireDependenciesView>(
                    `/tasks/${taskId}/dependencies`,
                )
            ).data,
        ),
    // POST /task-dependencies — body {task_id, related_task_id}; 201 (we refetch).
    create: async (input: {
        taskId: string;
        relatedTaskId: string;
    }): Promise<void> => {
        await api.post("/task-dependencies", {
            taskId: input.taskId,
            relatedTaskId: input.relatedTaskId,
        });
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/task-dependencies/${id}`);
    },
};

// ─── Attachments (§16) ─ 3-step presigned upload; bare Attachment[] list ──────
interface WireSignResult {
    attachmentId: string;
    uploadUrl: string;
    fields: Record<string, string>;
    expiresIn: number;
}
export const attachmentsApi = {
    byTask: async (taskId: string): Promise<Attachment[]> =>
        (
            await api.get<WireAttachment[]>(`/tasks/${taskId}/attachments`)
        ).data.map(mapAttachment),
    /**
     * sign → PUT the bytes straight to R2 (raw `fetch`, NOT the `api` instance:
     * no Bearer, no JSON, no interceptors) → finalize. `storage_key` is
     * server-owned so finalize needs no body. Requires Cloudflare R2 configured
     * server-side; in the dev no-R2 stub the signed URL is fake and the PUT fails.
     */
    upload: async (taskId: string, file: File): Promise<Attachment> => {
        const mimeType = file.type || "application/octet-stream";
        const sign = (
            await api.post<WireSignResult>("/uploads/sign", {
                scopeType: "task",
                scopeId: taskId,
                filename: file.name,
                mimeType,
                sizeBytes: file.size,
            })
        ).data;
        const put = await fetch(sign.uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": mimeType },
        });
        if (!put.ok) {
            throw new Error(`Upload to storage failed (${put.status})`);
        }
        return mapAttachment(
            (
                await api.post<WireAttachment>(
                    `/attachments/${sign.attachmentId}/finalize`,
                    {},
                )
            ).data,
        );
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/attachments/${id}`);
    },
};

// ─── Comments (§14) ─ GET returns a bare TREE (top-level comments, each with
// nested `replies`); we FLATTEN to a single Comment[] so CommentsSection's
// existing top-level/replies bucketing works unchanged. Author identity is
// JWT-derived server-side (no authorId arg, R7). Soft-deleted comments arrive
// with body "[deleted]". The wire lacks the FE-only fields (assignedTo,
// reactions, resolved*), so we cast — the section never reads them.
interface WireComment {
    id: string;
    taskId: string;
    parentCommentId: string | null;
    authorId: string;
    body: string;
    editedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    replies?: WireComment[];
}
const flattenComments = (tree: WireComment[]): Comment[] =>
    tree.flatMap((c) => [
        c,
        ...(c.replies ?? []),
    ]) as unknown as Comment[];
export const commentsApi = {
    byTask: async (taskId: string): Promise<Comment[]> =>
        flattenComments(
            (await api.get<WireComment[]>(`/tasks/${taskId}/comments`)).data,
        ),
    create: async (
        taskId: string,
        input: { body: string; parentCommentId?: string | null },
    ): Promise<Comment> =>
        (await api.post<WireComment>(`/tasks/${taskId}/comments`, input))
            .data as unknown as Comment,
    update: async (id: string, body: string): Promise<Comment> =>
        (await api.patch<WireComment>(`/comments/${id}`, { body }))
            .data as unknown as Comment,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/comments/${id}`);
    },
};

// ─── Public forms (§18) ─ ANONYMOUS render + submit (no auth). GET returns the
// public projection (no internal ids / settings — only `success_message` +
// branding + visible fields). Custom-field type/config is NOT exposed to
// anonymous callers, so the page renders custom fields as plain inputs and
// submits them with the `{text}` envelope (rich types are a V1 limitation).
export interface PublicFormField {
    fieldKind: "task_attr" | "custom_field";
    fieldKey: string;
    label: string;
    helpText: string | null;
    placeholder: string | null;
    isRequired: boolean;
    defaultValue: unknown;
    position: number;
}
export interface PublicFormView {
    title: string;
    description: string | null;
    publicSlug: string;
    branding: Record<string, unknown> | null;
    successMessage: string | null;
    fields: PublicFormField[];
}
export const publicFormsApi = {
    getBySlug: async (slug: string): Promise<PublicFormView> =>
        (await api.get<PublicFormView>(`/public/forms/${slug}`)).data,
    submit: async (
        slug: string,
        data: Record<string, unknown>,
    ): Promise<{
        submissionId: string;
        taskId: string | null;
        message: string;
    }> =>
        (
            await api.post<{
                submissionId: string;
                taskId: string | null;
                message: string;
            }>(`/public/forms/${slug}/submit`, { data })
        ).data,
};

// ─── Checklists (§15) ─ BARE Checklist[] (items nested); item writes return the
// ChecklistItem. Maps 1:1 to the FE Checklist/ChecklistItem shapes (extra wire
// fields completed_at/completed_by ride along, unused). Method names mirror the
// mock surface so call-sites migrate 1:1.
export const checklistsApi = {
    byTask: async (taskId: string): Promise<Checklist[]> =>
        (await api.get<Checklist[]>(`/tasks/${taskId}/checklists`)).data,
    create: async (taskId: string, name: string): Promise<Checklist> =>
        (await api.post<Checklist>(`/tasks/${taskId}/checklists`, { name }))
            .data,
    rename: async (id: string, name: string): Promise<Checklist> =>
        (await api.patch<Checklist>(`/checklists/${id}`, { name })).data,
    deleteChecklist: async (id: string): Promise<void> => {
        await api.delete(`/checklists/${id}`);
    },
    addItem: async (
        checklistId: string,
        text: string,
    ): Promise<ChecklistItem> =>
        (
            await api.post<ChecklistItem>(`/checklists/${checklistId}/items`, {
                text,
            })
        ).data,
    bulkAddItems: async (
        checklistId: string,
        texts: string[],
    ): Promise<ChecklistItem[]> =>
        (
            await api.post<ChecklistItem[]>(
                `/checklists/${checklistId}/items/bulk`,
                { texts },
            )
        ).data,
    updateItem: async (
        id: string,
        patch: { text?: string; assigneeId?: string | null; position?: number },
    ): Promise<ChecklistItem> =>
        (await api.patch<ChecklistItem>(`/checklist-items/${id}`, patch)).data,
    toggleItem: async (id: string): Promise<ChecklistItem> =>
        (await api.post<ChecklistItem>(`/checklist-items/${id}/toggle`)).data,
    deleteItem: async (id: string): Promise<void> => {
        await api.delete(`/checklist-items/${id}`);
    },
};

// ─── Forms (§18) ─ list/byList/get/create/update/fields BARE; submissions {data} ─
export const formsApi = {
    list: async (): Promise<Form[]> => (await api.get<Form[]>("/forms")).data,
    byList: async (listId: string): Promise<Form[]> =>
        (await api.get<Form[]>(`/lists/${listId}/forms`)).data,
    getById: async (id: string): Promise<Form> =>
        (await api.get<Form>(`/forms/${id}`)).data,
    create: async (input: {
        listId: string;
        title: string;
        description?: string;
        isPublic?: boolean;
    }): Promise<Form> => (await api.post<Form>("/forms", input)).data,
    // NOTE: PATCH /forms/:id is metadata only — it does NOT accept `fields`
    // (those are the per-field endpoints below); callers must diff + sync fields.
    update: async (id: string, patch: Partial<Form>): Promise<Form> =>
        (await api.patch<Form>(`/forms/${id}`, patch)).data,
    delete: async (id: string): Promise<void> => {
        await api.delete(`/forms/${id}`);
    },
    addField: async (
        formId: string,
        field: Partial<FormFieldDef>,
    ): Promise<FormFieldDef> =>
        (await api.post<FormFieldDef>(`/forms/${formId}/fields`, field)).data,
    updateField: async (
        fieldId: string,
        patch: Partial<FormFieldDef>,
    ): Promise<FormFieldDef> =>
        (await api.patch<FormFieldDef>(`/form-fields/${fieldId}`, patch)).data,
    deleteField: async (fieldId: string): Promise<void> => {
        await api.delete(`/form-fields/${fieldId}`);
    },
    reorderFields: async (
        formId: string,
        items: { id: string; position: number }[],
    ): Promise<Form> =>
        (await api.patch<Form>(`/forms/${formId}/fields/reorder`, { items }))
            .data,
    submissions: async (formId: string): Promise<FormSubmission[]> =>
        unwrapData<FormSubmission[]>(
            await api.get<{ data: FormSubmission[] }>(
                `/forms/${formId}/submissions`,
            ),
        ),
};

// ─── Notifications (§19) ─ feed {data}; unread-count {unread_count}; JWT-scoped ─
// (no userId arg per R7 — the inbox is the caller's, derived from the token).
export const notificationsApi = {
    list: async (): Promise<Notification[]> =>
        unwrapData<WireNotification[]>(
            await api.get<{ data: WireNotification[] }>("/notifications"),
        ).map(mapNotification),
    unreadCount: async (): Promise<number> =>
        (
            await api.get<{ unreadCount: number }>(
                "/notifications/unread-count",
            )
        ).data.unreadCount,
    markRead: async (id: string): Promise<void> => {
        await api.post(`/notifications/${id}/read`);
    },
    markUnread: async (id: string): Promise<void> => {
        await api.post(`/notifications/${id}/unread`);
    },
    markAllRead: async (): Promise<void> => {
        await api.post("/notifications/mark-all-read");
    },
    snooze: async (id: string, snoozedUntil: string): Promise<void> => {
        await api.post(`/notifications/${id}/snooze`, { snoozedUntil });
    },
    delete: async (id: string): Promise<void> => {
        await api.delete(`/notifications/${id}`);
    },
    getPreferences: async (): Promise<
        Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>
    > =>
        (
            await api.get<
                Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>
            >("/notifications/preferences")
        ).data,
    updatePreferences: async (
        prefs: Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>,
    ): Promise<
        Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>
    > =>
        (
            await api.put<
                Record<string, { inAppEnabled: boolean; emailEnabled: boolean }>
            >("/notifications/preferences", prefs)
        ).data,
};

// ─── Home / KPIs (§25) ─ bare; /home/kpis is verbatim camelCase (R1-skipped) ──
export const homeApi = {
    kpis: async (): Promise<HomeKpiSet> =>
        (await api.get<HomeKpiSet>("/home/kpis")).data,
};

// ─── Workspace activity (§26) ─ recent = bare {data}; rows actor-hydrated ─────
export const activityApi = {
    recent: async (limit = 10): Promise<TaskActivityEntry[]> =>
        unwrapData<TaskActivityEntry[]>(
            await api.get<{ data: TaskActivityEntry[] }>("/activity/recent", {
                params: { limit },
            }),
        ),
};

// ─── Search (§24) ─ bare multi-bucket; backend OMITS `notes` (no backend) ─────
export interface SearchResults {
    tasks: Task[];
    lists: List[];
    spaces: Space[];
    notes: unknown[];
    comments: unknown[];
    users: User[];
    total: number;
}
export const searchApi = {
    search: async (input: {
        query: string;
        types?: string[];
        limit?: number;
    }): Promise<SearchResults> => {
        const res = (
            await api.get<{
                tasks?: WireTask[];
                lists?: List[];
                spaces?: Space[];
                users?: User[];
                comments?: unknown[];
                total?: number;
            }>("/search", {
                params: {
                    q: input.query,
                    types: input.types?.join(","),
                    limit: input.limit,
                },
            })
        ).data;
        return {
            tasks: (res.tasks ?? []).map(mapTask),
            lists: res.lists ?? [],
            spaces: res.spaces ?? [],
            notes: [], // no backend notes search
            comments: res.comments ?? [],
            users: res.users ?? [],
            total: res.total ?? 0,
        };
    },
};

// ─── Sprints (§20) ─ bare Sprint / Sprint[]; lifecycle writes return the sprint ─
export const sprintsApi = {
    list: async (status?: SprintStatus): Promise<Sprint[]> =>
        (await api.get<Sprint[]>("/sprints", { params: { status } })).data,
    // GET /sprints/active 404s when there is no active sprint → treat as null.
    active: async (): Promise<Sprint | null> => {
        try {
            return (await api.get<Sprint>("/sprints/active")).data;
        } catch (e) {
            if (
                (e as { response?: { status?: number } }).response?.status ===
                404
            ) {
                return null;
            }
            throw e;
        }
    },
    getById: async (id: string): Promise<Sprint> =>
        (await api.get<Sprint>(`/sprints/${id}`)).data,
    create: async (input: Partial<Sprint>): Promise<Sprint> =>
        (await api.post<Sprint>("/sprints", input)).data,
    update: async (id: string, patch: Partial<Sprint>): Promise<Sprint> =>
        (await api.patch<Sprint>(`/sprints/${id}`, patch)).data,
    start: async (id: string): Promise<Sprint> =>
        (await api.post<Sprint>(`/sprints/${id}/start`)).data,
    close: async (id: string): Promise<{ rolledOver: number }> =>
        (await api.post<{ rolledOver: number }>(`/sprints/${id}/close`)).data,
    addTasks: async (id: string, taskIds: string[]): Promise<void> => {
        await api.post(`/sprints/${id}/tasks`, { taskIds });
    },
    removeTask: async (id: string, taskId: string): Promise<void> => {
        await api.delete(`/sprints/${id}/tasks/${taskId}`);
    },
    // §20 — the sprint's tasks across ALL lists (cross-list). Bare WireTask[].
    tasks: async (id: string): Promise<Task[]> =>
        (await api.get<WireTask[]>(`/sprints/${id}/tasks`)).data.map(mapTask),
};

// ─── On-call (§21) ─ current = bare shift|null; schedule = {data}; engineer mapped ─
export const onCallApi = {
    current: async (): Promise<OnCallShiftView | null> => {
        const data = (await api.get<WireOnCallShift | null>("/on-call/current"))
            .data;
        return data ? mapOnCallShift(data) : null;
    },
    schedule: async (): Promise<OnCallShiftView[]> =>
        unwrapData<WireOnCallShift[]>(
            await api.get<{ data: WireOnCallShift[] }>("/on-call/schedule"),
        ).map(mapOnCallShift),
    set: async (
        weekStart: string,
        engineerId: string,
    ): Promise<OnCallShiftView> =>
        mapOnCallShift(
            (
                await api.put<WireOnCallShift>(`/on-call/${weekStart}`, {
                    engineerId,
                })
            ).data,
        ),
    delete: async (weekStart: string): Promise<void> => {
        await api.delete(`/on-call/${weekStart}`);
    },
};

// ─── Engineering specials (§22) ─ report-bug + the eng-home rollup ────────────
export interface EngHome {
    openBugs: { count: number; top: Task[] };
    mySprintTasks: Task[];
    prsAwaitingMe: Task[];
    openIncidents: { count: number; top: Task[] };
    staleTickets: Task[];
    currentOnCall: User | null;
    activeSprint: Sprint | null;
}
interface WireEngHome {
    openBugs: { count: number; top: WireTask[] };
    mySprintTasks: WireTask[];
    prsAwaitingMe: WireTask[];
    openIncidents: { count: number; top: WireTask[] };
    staleTickets: WireTask[];
    currentOnCall: User | null;
    activeSprint: Sprint | null;
}
export const engineeringApi = {
    // report-bug → backend composes a Bug task (auto-assigns on-call for S0/S1).
    reportBug: async (input: {
        steps: string;
        happened: string;
        expected?: string;
        severity?: string;
        reporterTeam: string;
        url?: string;
        screenshots?: string[];
    }): Promise<Task> =>
        mapTask((await api.post<WireTask>("/eng/report-bug", input)).data),
    // GET /eng/home — one dashboard rollup; the task buckets are WireTask→mapTask.
    home: async (): Promise<EngHome> => {
        const v = (await api.get<WireEngHome>("/eng/home")).data;
        return {
            openBugs: {
                count: v.openBugs.count,
                top: v.openBugs.top.map(mapTask),
            },
            mySprintTasks: v.mySprintTasks.map(mapTask),
            prsAwaitingMe: v.prsAwaitingMe.map(mapTask),
            openIncidents: {
                count: v.openIncidents.count,
                top: v.openIncidents.top.map(mapTask),
            },
            staleTickets: v.staleTickets.map(mapTask),
            currentOnCall: v.currentOnCall,
            activeSprint: v.activeSprint,
        };
    },
};
