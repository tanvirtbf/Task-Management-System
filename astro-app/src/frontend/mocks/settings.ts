import type {
  Integration,
  Webhook,
  ApiKey,
  NotificationPreferences,
  RoleDefinition,
  ActiveSession,
} from "../types/settings";

const now = "2025-09-15T08:00:00Z";

export const integrations: Integration[] = [
  {
    id: "int-slack",
    name: "Slack",
    description:
      "Post task updates to Slack channels and create tasks from messages.",
    category: "communication",
    icon: "MessageSquare",
    color: "#4A154B",
    isConnected: true,
    connectedAt: "2025-08-12T10:24:00Z",
    connectedBy: "u-001",
    meta: { workspace: "BeautyBooth", channel: "#operations" },
  },
  {
    id: "int-discord",
    name: "Discord",
    description: "Send notifications to Discord servers.",
    category: "communication",
    icon: "MessageCircle",
    color: "#5865F2",
    isConnected: false,
  },
  {
    id: "int-gmail",
    name: "Gmail",
    description: "Convert emails into tasks and reply directly from comments.",
    category: "email",
    icon: "Mail",
    color: "#EA4335",
    isConnected: true,
    connectedAt: "2025-09-01T14:30:00Z",
    connectedBy: "u-001",
    meta: { account: "ops@BeautyBooth.com" },
  },
  {
    id: "int-outlook",
    name: "Outlook",
    description: "Two-way calendar and email sync.",
    category: "email",
    icon: "Inbox",
    color: "#0078D4",
    isConnected: false,
  },
  {
    id: "int-gdrive",
    name: "Google Drive",
    description: "Attach files from Drive to tasks.",
    category: "files",
    icon: "FolderOpen",
    color: "#4285F4",
    isConnected: true,
    connectedAt: "2025-07-20T09:12:00Z",
    connectedBy: "u-001",
    meta: { account: "ops@BeautyBooth.com" },
  },
  {
    id: "int-dropbox",
    name: "Dropbox",
    description: "Embed Dropbox files in task descriptions.",
    category: "files",
    icon: "Box",
    color: "#0061FF",
    isConnected: false,
  },
  {
    id: "int-github",
    name: "GitHub",
    description: "Link issues, PRs, and commits to tasks.",
    category: "dev",
    icon: "Github",
    color: "#181717",
    isConnected: false,
  },
  {
    id: "int-gitlab",
    name: "GitLab",
    description: "Sync issues and merge requests.",
    category: "dev",
    icon: "GitBranch",
    color: "#FC6D26",
    isConnected: false,
  },
  {
    id: "int-zapier",
    name: "Zapier",
    description: "Connect to 5,000+ apps via Zapier.",
    category: "automation",
    icon: "Zap",
    color: "#FF4A00",
    isConnected: false,
  },
  {
    id: "int-make",
    name: "Make (Integromat)",
    description: "Visual automation workflows.",
    category: "automation",
    icon: "Workflow",
    color: "#6D00CC",
    isConnected: false,
  },
  {
    id: "int-twilio",
    name: "Twilio",
    description: "Send SMS alerts on task events.",
    category: "communication",
    icon: "MessageSquare",
    color: "#F22F46",
    isConnected: false,
  },
  {
    id: "int-figma",
    name: "Figma",
    description: "Embed Figma designs in task details.",
    category: "files",
    icon: "Image",
    color: "#F24E1E",
    isConnected: false,
  },
];

export const webhooks: Webhook[] = [
  {
    id: "wh-001",
    workspaceId: "ws-main",
    name: "Slack Ops Channel",
    url: "https://hooks.slack.com/services/T0000/B0000/XXXX",
    events: ["task.created", "task.completed", "comment.created"],
    secret: "whsec_a1b2c3d4e5f6g7h8i9j0k1l2m3n4",
    isActive: true,
    createdBy: "u-001",
    createdAt: "2025-08-12T10:30:00Z",
    lastTriggeredAt: "2025-09-14T16:42:00Z",
    deliveryCount: 1847,
    failureCount: 3,
  },
  {
    id: "wh-002",
    workspaceId: "ws-main",
    name: "Customer DB Sync",
    url: "https://api.BeautyBooth.internal/webhooks/tasks",
    events: ["task.created", "task.updated"],
    secret: "whsec_z9y8x7w6v5u4t3s2r1q0p9o8n7m6",
    isActive: true,
    createdBy: "u-001",
    createdAt: "2025-09-01T09:00:00Z",
    lastTriggeredAt: "2025-09-15T07:15:00Z",
    deliveryCount: 392,
    failureCount: 0,
  },
  {
    id: "wh-003",
    workspaceId: "ws-main",
    name: "Form Submissions",
    url: "https://api.BeautyBooth.internal/webhooks/forms",
    events: ["form.submitted"],
    secret: "whsec_p1o2i3u4y5t6r7e8w9q0a1s2d3f4",
    isActive: false,
    createdBy: "u-001",
    createdAt: "2025-07-12T11:00:00Z",
    lastTriggeredAt: "2025-08-30T14:20:00Z",
    deliveryCount: 124,
    failureCount: 12,
  },
];

export const apiKeys: ApiKey[] = [
  {
    id: "ak-001",
    workspaceId: "ws-main",
    name: "Production API",
    last4: "8f3a",
    scopes: ["read", "write"],
    createdBy: "u-001",
    createdAt: "2025-08-01T09:00:00Z",
    lastUsedAt: "2025-09-15T08:00:00Z",
    expiresAt: null,
  },
  {
    id: "ak-002",
    workspaceId: "ws-main",
    name: "Analytics Read-Only",
    last4: "c2e1",
    scopes: ["read"],
    createdBy: "u-001",
    createdAt: "2025-09-10T15:00:00Z",
    lastUsedAt: "2025-09-14T11:30:00Z",
    expiresAt: "2026-09-10T15:00:00Z",
  },
];

export const notificationPreferencesByUser: Map<
  string,
  NotificationPreferences
> = new Map();

const defaultPrefs = (userId: string): NotificationPreferences => ({
  userId,
  channels: { inApp: true, email: true, push: false },
  events: {
    assigned: { inApp: true, email: true },
    mentioned: { inApp: true, email: true },
    commentReply: { inApp: true, email: false },
    statusChange: { inApp: true, email: false },
    dueSoon: { inApp: true, email: true },
    overdue: { inApp: true, email: true },
    dailyDigest: { inApp: false, email: true },
    weeklyDigest: { inApp: false, email: false },
  },
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
});

export const getNotificationPreferences = (
  userId: string,
): NotificationPreferences => {
  if (!notificationPreferencesByUser.has(userId)) {
    notificationPreferencesByUser.set(userId, defaultPrefs(userId));
  }
  return notificationPreferencesByUser.get(userId)!;
};

export const roleDefinitions: RoleDefinition[] = [
  {
    role: "owner",
    label: "Owner",
    description:
      "Full control over the workspace, including billing and ownership transfer. Only one Owner per workspace.",
    permissions: [
      "Manage workspace settings",
      "Manage billing & subscriptions",
      "Transfer ownership",
      "Delete the workspace",
      "All Admin permissions",
    ],
  },
  {
    role: "admin",
    label: "Admin",
    description:
      "Manage members, spaces, integrations, and workspace configuration.",
    permissions: [
      "Invite & remove members",
      "Create & archive spaces, folders, lists",
      "Manage roles & permissions",
      "Configure integrations & webhooks",
      "Manage workspace-wide custom fields, statuses, tags",
      "Create & edit automations",
      "All Member permissions",
    ],
  },
  {
    role: "member",
    label: "Member",
    description:
      "Default role for most users. Can work on tasks they're assigned to or have access to.",
    permissions: [
      "Create & edit tasks in accessible lists",
      "Comment, attach files, log time",
      "Create personal dashboards & views",
      "Apply templates",
      "View workspace activity",
    ],
  },
  {
    role: "guest",
    label: "Guest",
    description:
      "Limited access — only invited specifically to lists or tasks.",
    permissions: [
      "View shared tasks & lists",
      "Comment on shared items",
      "Cannot create new tasks",
      "Cannot see other workspace content",
    ],
  },
];

export const activeSessions: ActiveSession[] = [
  {
    id: "sess-current",
    userId: "u-001",
    device: "Windows PC",
    browser: "Chrome 130",
    ip: "103.78.x.x",
    location: "Dhaka, Bangladesh",
    lastSeenAt: now,
    isCurrent: true,
  },
  {
    id: "sess-mobile",
    userId: "u-001",
    device: "iPhone 15",
    browser: "Safari Mobile",
    ip: "103.78.x.x",
    location: "Dhaka, Bangladesh",
    lastSeenAt: "2025-09-14T22:15:00Z",
    isCurrent: false,
  },
  {
    id: "sess-tablet",
    userId: "u-001",
    device: "iPad Air",
    browser: "Safari 17",
    ip: "103.78.x.x",
    location: "Dhaka, Bangladesh",
    lastSeenAt: "2025-09-10T18:42:00Z",
    isCurrent: false,
  },
];

export const integrationsById = new Map(integrations.map((i) => [i.id, i]));
export const webhooksById = new Map(webhooks.map((w) => [w.id, w]));
export const apiKeysById = new Map(apiKeys.map((k) => [k.id, k]));
