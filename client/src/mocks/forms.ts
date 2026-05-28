import type { Form, FormSubmission } from "../types/custom-fields";

const now = new Date().toISOString();

const baseBranding = {
    primaryColor: "#4F46E5",
    layout: "single_column" as const,
    hideAppBranding: false,
    theme: "light" as const,
};

const baseSettings = {
    requireLogin: false,
    enableRecaptcha: true,
    submissionOpen: true,
};

export const forms: Form[] = [
    {
        id: "form-complaint",
        listId: "l-complaints",
        title: "File a complaint",
        description:
            "We're sorry you ran into an issue. Tell us what happened and our support team will reach out within 24 hours.",
        isPublic: true,
        publicSlug: "facebook-complaint-intake",
        branding: {
            ...baseBranding,
            primaryColor: "#E11D48",
        },
        settings: {
            ...baseSettings,
            successMessage:
                "Thanks — your complaint has been received. We'll follow up by phone within 24 hours.",
        },
        submissionCount: 23,
        fields: [
            {
                id: "ff-1",
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "Short summary",
                helpText: "A one-line description of the issue.",
                placeholder: "e.g. Damaged item in Mirpur order",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 0,
            },
            {
                id: "ff-2",
                fieldKind: "custom_field",
                fieldKey: "cf_order_number",
                label: "Order number",
                placeholder: "ORD-XXXX",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 1,
            },
            {
                id: "ff-3",
                fieldKind: "custom_field",
                fieldKey: "cf_issue_type",
                label: "What went wrong?",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 2,
            },
            {
                id: "ff-4",
                fieldKind: "custom_field",
                fieldKey: "cf_channel",
                label: "How did you order?",
                isRequired: false,
                isHidden: false,
                defaultValue: null,
                position: 3,
            },
            {
                id: "ff-5",
                fieldKind: "custom_field",
                fieldKey: "cf_resolution",
                label: "Tell us more (optional)",
                helpText: "More detail = faster resolution.",
                isRequired: false,
                isHidden: false,
                defaultValue: null,
                position: 4,
                conditionalLogic: {
                    action: "show",
                    logic: "AND",
                    rules: [
                        {
                            triggerFieldId: "ff-3",
                            operator: "neq",
                            value: "Other",
                        },
                    ],
                },
            },
        ],
        createdBy: "u-001",
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "form-product-request",
        listId: "l-new-products",
        title: "New product sourcing request",
        description: "Suggest a product we should consider stocking.",
        isPublic: true,
        publicSlug: "new-product-sourcing",
        branding: {
            ...baseBranding,
            primaryColor: "#10B981",
        },
        settings: {
            ...baseSettings,
            successMessage:
                "Thanks for the suggestion! Our product team will review.",
        },
        submissionCount: 8,
        fields: [
            {
                id: "ff-pr-1",
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "Product name",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 0,
            },
            {
                id: "ff-pr-2",
                fieldKind: "custom_field",
                fieldKey: "cf_category",
                label: "Category",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 1,
            },
        ],
        createdBy: "u-001",
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "form-supplier-onboarding",
        listId: "l-po",
        title: "Supplier onboarding",
        description: "Submit your details to be added to our approved supplier list.",
        isPublic: true,
        publicSlug: "supplier-onboarding",
        branding: {
            ...baseBranding,
            primaryColor: "#8B5CF6",
        },
        settings: {
            ...baseSettings,
            successMessage:
                "Application received. We'll be in touch within 5 business days.",
        },
        submissionCount: 3,
        fields: [
            {
                id: "ff-so-1",
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "Company name",
                isRequired: true,
                isHidden: false,
                defaultValue: null,
                position: 0,
            },
        ],
        createdBy: "u-001",
        createdAt: now,
        updatedAt: now,
    },
];

export const formsById = new Map(forms.map((f) => [f.id, f]));
export const formsBySlug = new Map(forms.map((f) => [f.publicSlug, f]));

export const formsByList = (listId: string): Form[] =>
    forms.filter((f) => f.listId === listId);

// ─── Submissions ───
export const formSubmissions: FormSubmission[] = [
    {
        id: "fs-001",
        formId: "form-complaint",
        taskId: "t-1042",
        submitterEmail: "salma@example.com",
        data: {
            name: "Wrong item received",
            cf_order_number: "ORD-1042",
            cf_issue_type: "Wrong Item",
            cf_channel: "Facebook",
        },
        submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
        id: "fs-002",
        formId: "form-complaint",
        taskId: "t-1057",
        submitterEmail: "rashida@example.com",
        data: {
            name: "Late delivery — already 4 days",
            cf_order_number: "ORD-1057",
            cf_issue_type: "Late Delivery",
            cf_channel: "Phone",
        },
        submittedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
];

export const submissionsByForm = (formId: string): FormSubmission[] =>
    formSubmissions.filter((s) => s.formId === formId);
