/**
 * Custom Fields + Forms.
 *
 * Per WHAT_BeautyBooth_ACTUALLY_NEEDS.md §3 #12 / §4.4 the user-facing
 * surface (settings UI, type picker, renderer) is restricted to 6 types:
 *     text, phone, money, date, dropdown, files
 *
 * The wider union below keeps the door open for legacy mock data without
 * crashing the type system. Legacy types render as "Unsupported field
 * type" in the UI, signaling that they should be migrated.
 */

export type CustomFieldType =
  | "text"
  | "phone"
  | "money"
  | "date"
  | "dropdown"
  | "files"
  // Legacy — kept only so old mock fixtures still parse.
  | "long_text"
  | "email"
  | "url"
  | "number"
  | "checkbox"
  | "labels"
  | "people"
  | "location"
  | "formula"
  | "progress"
  | "rating";

export const SUPPORTED_FIELD_TYPES: CustomFieldType[] = [
  "text",
  "phone",
  "money",
  "date",
  "dropdown",
  "files",
];

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
  options?: CustomFieldOption[];
}

export interface CustomFieldOption {
  id: string;
  label: string;
  color: string;
  position: number;
}

// ─────────────────────────────────────────────────────────
// Forms — simplified (no conditional logic builder, no recaptcha)
// ─────────────────────────────────────────────────────────

export interface Form {
  id: string;
  listId: string;
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
  fieldKey: string;
  label: string;
  helpText?: string;
  placeholder?: string;
  isRequired: boolean;
  isHidden: boolean;
  defaultValue: unknown | null;
  position: number;
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
