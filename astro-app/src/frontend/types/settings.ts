/**
 * Phase 10 — Settings types.
 */

export type IntegrationCategory =
    | "communication"
    | "files"
    | "dev"
    | "automation"
    | "email";

export interface Integration {
    id: string;
    name: string;
    description: string;
    category: IntegrationCategory;
    /** Lucide icon name */
    icon: string;
    color: string;
    isConnected: boolean;
    connectedAt?: string;
    connectedBy?: string;
    /** Free-form metadata for connected state (account email, workspace name) */
    meta?: Record<string, string>;
}

export interface Webhook {
    id: string;
    workspaceId: string;
    name: string;
    url: string;
    events: WebhookEvent[];
    secret: string;
    isActive: boolean;
    createdBy: string;
    createdAt: string;
    lastTriggeredAt: string | null;
    deliveryCount: number;
    failureCount: number;
}

export type WebhookEvent =
    | "task.created"
    | "task.updated"
    | "task.completed"
    | "task.deleted"
    | "comment.created"
    | "automation.run"
    | "form.submitted";

export interface ApiKey {
    id: string;
    workspaceId: string;
    name: string;
    /** Last 4 characters; full key returned only at create time */
    last4: string;
    scopes: ApiScope[];
    createdBy: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
}

export type ApiScope = "read" | "write" | "admin";

export interface NotificationPreferences {
    userId: string;
    channels: {
        inApp: boolean;
        email: boolean;
        push: boolean;
    };
    /** Per-event opt-in */
    events: {
        assigned: { inApp: boolean; email: boolean };
        mentioned: { inApp: boolean; email: boolean };
        commentReply: { inApp: boolean; email: boolean };
        statusChange: { inApp: boolean; email: boolean };
        dueSoon: { inApp: boolean; email: boolean };
        overdue: { inApp: boolean; email: boolean };
        dailyDigest: { inApp: boolean; email: boolean };
        weeklyDigest: { inApp: boolean; email: boolean };
    };
    quietHours: { enabled: boolean; start: string; end: string };
}

export interface RoleDefinition {
    role: "owner" | "admin" | "member" | "guest";
    label: string;
    description: string;
    permissions: string[];
}

export interface ActiveSession {
    id: string;
    userId: string;
    device: string;
    browser: string;
    ip: string;
    location: string;
    lastSeenAt: string;
    isCurrent: boolean;
}
