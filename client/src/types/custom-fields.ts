/**
 * Custom Fields + Forms.
 *
 * Per FINAL_REQUIREMENTS.md §5.11 the supported custom field types are
 * exactly 6: text, phone, money, date, dropdown, files. No legacy types.
 */

export type CustomFieldType =
  | "text"
  | "phone"
  | "money"
  | "date"
  | "dropdown"
  | "files";

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
