import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
    customFieldOptions,
    customFields,
    formFields,
    formSubmissions,
    forms,
    lists,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/**
 * §18 Forms test seed helpers. Insert real rows via Drizzle (no mocks), scoped
 * to the forms test suite — kept OUT of the shared `factories.ts` to avoid
 * contention with the parallel session that owns it. Reuse the shared factories
 * (makeUser/makeList/makeStatus/makeTaskType) for the prerequisite hierarchy.
 */

let _seq = 0;
const nextSeq = () => ++_seq;

export interface MakeFormInput {
    listId: string;
    createdBy: string;
    title?: string;
    description?: string | null;
    isPublic?: boolean;
    publicSlug?: string;
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
}

export const makeForm = async (input: MakeFormInput) => {
    const db = getDb();
    const id = fakeId("frm");
    const seq = nextSeq();
    const publicSlug = input.publicSlug ?? `test-slug-${seq}-${id.slice(4, 12)}`;
    await db.insert(forms).values({
        id,
        listId: input.listId,
        title: input.title ?? `Form ${seq}`,
        description: input.description ?? null,
        isPublic: input.isPublic ?? true,
        publicSlug,
        settings: input.settings ?? {},
        branding: input.branding ?? {},
        createdBy: input.createdBy,
    });
    return { id, publicSlug, listId: input.listId, createdBy: input.createdBy };
};

export interface MakeFormFieldInput {
    formId: string;
    fieldKind: "task_attr" | "custom_field";
    fieldKey: string;
    label?: string;
    isRequired?: boolean;
    isHidden?: boolean;
    position?: number;
    defaultValue?: unknown;
    helpText?: string | null;
    placeholder?: string | null;
}

export const makeFormField = async (input: MakeFormFieldInput) => {
    const db = getDb();
    const id = fakeId("ffld");
    const seq = nextSeq();
    await db.insert(formFields).values({
        id,
        formId: input.formId,
        fieldKind: input.fieldKind,
        fieldKey: input.fieldKey,
        label: input.label ?? `Field ${seq}`,
        isRequired: input.isRequired ?? false,
        isHidden: input.isHidden ?? false,
        position: input.position ?? seq,
        defaultValue: input.defaultValue ?? null,
        helpText: input.helpText ?? null,
        placeholder: input.placeholder ?? null,
    });
    return { id, formId: input.formId, fieldKey: input.fieldKey };
};

export interface MakeFormSubmissionInput {
    formId: string;
    taskId?: string | null;
    submitterEmail?: string | null;
    submitterIp?: string | null;
    data?: Record<string, unknown>;
}

export const makeFormSubmission = async (input: MakeFormSubmissionInput) => {
    const db = getDb();
    const id = fakeId("fsub");
    await db.insert(formSubmissions).values({
        id,
        formId: input.formId,
        taskId: input.taskId ?? null,
        submitterEmail: input.submitterEmail ?? null,
        submitterIp: input.submitterIp ?? null,
        data: input.data ?? {},
    });
    return { id, formId: input.formId };
};

export interface MakeCustomFieldInput {
    workspaceId: string;
    createdBy: string;
    type:
        | "text"
        | "phone"
        | "money"
        | "date"
        | "dropdown"
        | "files";
    name?: string;
    scopeType?: "workspace" | "space" | "list";
    scopeId?: string | null;
}

export const makeCustomField = async (input: MakeCustomFieldInput) => {
    const db = getDb();
    const id = fakeId("cf");
    const seq = nextSeq();
    await db.insert(customFields).values({
        id,
        workspaceId: input.workspaceId,
        scopeType: input.scopeType ?? "workspace",
        scopeId: input.scopeId ?? null,
        name: input.name ?? `CF ${seq}`,
        type: input.type,
        createdBy: input.createdBy,
    });
    return { id, workspaceId: input.workspaceId, type: input.type };
};

export const makeCustomFieldOption = async (input: {
    customFieldId: string;
    label?: string;
    position?: number;
}) => {
    const db = getDb();
    const id = fakeId("cfo");
    const seq = nextSeq();
    await db.insert(customFieldOptions).values({
        id,
        customFieldId: input.customFieldId,
        label: input.label ?? `Option ${seq}`,
        position: input.position ?? seq,
    });
    return { id, customFieldId: input.customFieldId };
};

/** Point a list at a default task type so TaskWriteService.create can resolve one. */
export const setListDefaultTaskType = async (
    listId: string,
    taskTypeId: string,
) => {
    const db = getDb();
    await db
        .update(lists)
        .set({ defaultTaskTypeId: taskTypeId })
        .where(eq(lists.id, listId));
};
