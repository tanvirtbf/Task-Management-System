/**
 * Phase 7 — Custom Fields + Forms types.
 */

export type CustomFieldType =
    | "text"
    | "long_text"
    | "number"
    | "money"
    | "date"
    | "dropdown"
    | "labels"
    | "checkbox"
    | "phone"
    | "url"
    | "email"
    | "files"
    | "people"
    | "location"
    | "formula"
    | "progress"
    | "rating";

export interface CustomField {
    id: string;
    workspaceId: string;
    scopeType: "workspace" | "space" | "list";
    scopeId: string | null;
    name: string;
    type: CustomFieldType;
    config: Record<string, unknown>;
    isRequired: boolean;
    defaultValue: unknown | null;
    position: number;
    hiddenFromGuests: boolean;
    createdBy: string;
    /** Color-coded options for dropdown / labels (inline for mock simplicity) */
    options?: CustomFieldOption[];
}

export interface CustomFieldOption {
    id: string;
    label: string;
    color: string;
    position: number;
}

// ─────────────────────────────────────────────────────────
// Forms
// ─────────────────────────────────────────────────────────

export interface Form {
    id: string;
    listId: string; // target list
    title: string;
    description?: string;
    isPublic: boolean;
    publicSlug: string;
    branding: FormBranding;
    settings: FormSettings;
    submissionCount: number;
    fields: FormFieldDef[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface FormBranding {
    primaryColor: string;
    logoUrl?: string | null;
    layout: "single_column" | "two_column";
    backgroundImageUrl?: string | null;
    hideAppBranding: boolean;
    theme: "light" | "dark";
}

export interface FormSettings {
    requireLogin: boolean;
    enableRecaptcha: boolean;
    redirectUrl?: string | null;
    successMessage?: string;
    submissionOpen: boolean;
}

export interface FormFieldDef {
    id: string;
    fieldKind: "task_attr" | "custom_field";
    /** task attribute name (e.g., "name") OR custom_field id */
    fieldKey: string;
    label: string;
    helpText?: string;
    placeholder?: string;
    isRequired: boolean;
    isHidden: boolean;
    defaultValue: unknown | null;
    conditionalLogic?: ConditionalLogic;
    position: number;
}

export interface ConditionalLogic {
    action: "show" | "hide";
    logic: "AND" | "OR";
    rules: Array<{
        triggerFieldId: string;
        operator:
            | "eq"
            | "neq"
            | "contains"
            | "not_contains"
            | "is_empty"
            | "is_not_empty";
        value: unknown;
    }>;
}

export interface FormSubmission {
    id: string;
    formId: string;
    taskId: string | null;
    submitterEmail?: string;
    submitterIp?: string;
    data: Record<string, unknown>;
    submittedAt: string;
}
