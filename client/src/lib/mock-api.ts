import type {
    ActivityLogEntry,
    HomeKpiSet,
    List,
    LoginResult,
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
import { delay } from "./delay";
import { fakeId } from "./fake-id";
import {
    currentUser,
    setCurrentUser,
    users,
    usersByEmail,
} from "../mocks/users";
import { workspace } from "../mocks/workspace";
import { spaces } from "../mocks/spaces";
import { folders } from "../mocks/folders";
import { lists } from "../mocks/lists";
import { statuses, statusesByList } from "../mocks/statuses";
import { taskTypes } from "../mocks/task-types";
import { tags } from "../mocks/tags";
import { tasks } from "../mocks/tasks";
import {
    notifications,
    notificationsByUser,
    unreadCountForUser,
} from "../mocks/notifications";
import { activityLog, recentActivity } from "../mocks/activity";
import { comments, commentsByTask } from "../mocks/comments";
import { checklists, checklistsByTask } from "../mocks/checklists";
import {
    customFields,
    customFieldsByList,
    customFieldsByScope,
    customFieldsById,
} from "../mocks/custom-fields";
import {
    forms,
    formsByList,
    formsById,
    formsBySlug,
    formSubmissions,
    submissionsByForm,
} from "../mocks/forms";
import {
    automations,
    automationsById,
    automationsByList,
    automationRuns,
    runsByAutomation,
} from "../mocks/automations";
import { templates, templatesById, templatesByType } from "../mocks/templates";
import { dashboards, dashboardsById } from "../mocks/dashboards";
import {
    integrations,
    integrationsById,
    webhooks,
    webhooksById,
    apiKeys,
    apiKeysById,
    getNotificationPreferences,
    notificationPreferencesByUser,
    roleDefinitions,
    activeSessions,
} from "../mocks/settings";
import { notes, notesById, notesByUser } from "../mocks/notes";
import { attachments, attachmentsByTask } from "../mocks/attachments";
import {
    taskDependencies,
    dependenciesForTask,
} from "../mocks/task-dependencies";
import {
    timeLogs,
    timeLogsByTask,
    timeLogsByUser,
} from "../mocks/time-logs";
import type {
    Checklist,
    ChecklistItem,
    Comment,
} from "../types/extras";
import type {
    CustomField,
    Form,
    FormSubmission,
} from "../types/custom-fields";
import type {
    Automation,
    AutomationRun,
} from "../types/automation";
import type { Template } from "../types/template";
import type {
    Dashboard,
    DashboardWidget,
} from "../types/dashboard";
import type {
    Integration,
    Webhook,
    WebhookEvent,
    ApiKey,
    ApiScope,
    NotificationPreferences,
    RoleDefinition,
    ActiveSession,
} from "../types/settings";
import type { Note } from "../types/note";
import type {
    Attachment,
    DependencyType,
    TaskDependency,
} from "../types/extras";
import type { TimeLog } from "../types/time-tracking";

/** Helper: wrap a raw value into our custom-field value envelope. */
const wrapCustomFieldValue = (fieldId: string, value: unknown): unknown => {
    const field = customFieldsById.get(fieldId);
    if (!field) return { text: String(value) };
    switch (field.type) {
        case "text":
        case "long_text":
        case "email":
        case "url":
        case "phone":
            return { text: String(value) };
        case "number":
            return { number: Number(value) };
        case "money":
            return {
                amount: typeof value === "number" ? value * 100 : 0,
                currency: (field.config?.currency as string) ?? "BDT",
            };
        case "date":
            return { date: value };
        case "dropdown":
            return { option_id: value };
        case "labels":
            return { option_ids: Array.isArray(value) ? value : [value] };
        case "checkbox":
            return { checked: Boolean(value) };
        case "rating":
            return { value: Number(value) };
        case "progress":
            return { current: Number(value) };
        case "people":
            return { user_ids: Array.isArray(value) ? value : [value] };
        case "location":
            return typeof value === "object"
                ? value
                : { text: String(value) };
        default:
            return { text: String(value) };
    }
};

const log = (op: string, data?: unknown) => {
    if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.log(
            `%c[mock] ${op}`,
            "color:#4F46E5;font-weight:500;",
            data ?? "",
        );
    }
};

// 2FA session state
const pendingMfaTokens = new Map<string, string>();
const pendingResetTokens = new Map<string, string>();

// ─── Date helpers ───
const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};
const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
};
const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
};

// ─── KPI calculations (pure task management) ───
function calculateHomeKpis(): HomeKpiSet {
    const now = new Date();
    const today = startOfDay(now);
    const todayEnd = endOfDay(now);
    const myUserId = currentUser?.id ?? "u-001";

    const isOpen = (t: Task): boolean => {
        if (t.archivedAt) return false;
        const s = statuses.find((x) => x.id === t.statusId);
        return s?.statusGroup !== "done" && s?.statusGroup !== "closed";
    };

    // My open tasks
    const myOpenTasks = tasks.filter(
        (t) => t.assignees.includes(myUserId) && isOpen(t),
    ).length;
    const mySparkline = [
        Math.max(0, myOpenTasks - 3),
        Math.max(0, myOpenTasks - 2),
        Math.max(0, myOpenTasks - 1),
        myOpenTasks,
        Math.max(0, myOpenTasks - 1),
        myOpenTasks,
        myOpenTasks,
    ];

    // Due today (assigned to me)
    const dueToday = tasks.filter((t) => {
        if (!t.assignees.includes(myUserId) || !isOpen(t) || !t.dueDate)
            return false;
        const d = new Date(t.dueDate);
        return d >= today && d <= todayEnd;
    }).length;
    const dueTodaySparkline = [1, 2, 1, 3, 2, 1, dueToday];

    // Overdue (assigned to me)
    const overdue = tasks.filter((t) => {
        if (!t.assignees.includes(myUserId) || !isOpen(t) || !t.dueDate)
            return false;
        return new Date(t.dueDate) < today;
    }).length;
    const overdueSparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
        const day = endOfDay(daysAgo(i));
        const past = tasks.filter((t) => {
            if (!t.assignees.includes(myUserId)) return false;
            if (!t.dueDate || new Date(t.dueDate) > day) return false;
            if (t.completedAt && new Date(t.completedAt) <= day) return false;
            return true;
        }).length;
        overdueSparkline.push(past);
    }

    // Awaiting my review (engineering — placeholder, all-zero until reviewer field wired)
    const awaitingReview = 0;
    const awaitingReviewSparkline = [0, 0, 0, 0, 0, 0, 0];

    // Open team tasks — workspace-wide open count
    const openTeamTasks = tasks.filter(isOpen).length;
    const teamSparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
        const day = endOfDay(daysAgo(i));
        const c = tasks.filter((t) => {
            if (new Date(t.createdAt) > day) return false;
            if (t.completedAt && new Date(t.completedAt) <= day) return false;
            if (t.archivedAt) return false;
            return true;
        }).length;
        teamSparkline.push(c);
    }

    // SLA breaches — tasks past sla_due_at without completion
    const slaBreaches = tasks.filter((t) => {
        if (!t.slaDueAt) return false;
        if (t.completedAt) return false;
        if (t.archivedAt) return false;
        return new Date(t.slaDueAt) < now;
    }).length;
    const slaSparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
        const day = endOfDay(daysAgo(i));
        const breached = tasks.filter((t) => {
            if (!t.slaDueAt) return false;
            if (new Date(t.slaDueAt) > day) return false;
            if (t.completedAt && new Date(t.completedAt) <= day) return false;
            if (t.archivedAt) return false;
            return true;
        }).length;
        slaSparkline.push(breached);
    }

    return {
        myTasks: {
            label: "My Open Tasks",
            value: myOpenTasks,
            valueDisplay: String(myOpenTasks),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: mySparkline,
        },
        dueToday: {
            label: "Due Today",
            value: dueToday,
            valueDisplay: String(dueToday),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: dueTodaySparkline,
        },
        overdue: {
            label: "Overdue",
            value: overdue,
            valueDisplay: String(overdue),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: overdueSparkline,
        },
        awaitingReview: {
            label: "Awaiting My Review",
            value: awaitingReview,
            valueDisplay: String(awaitingReview),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: awaitingReviewSparkline,
        },
        openTeamTasks: {
            label: "Open Team Tasks",
            value: openTeamTasks,
            valueDisplay: String(openTeamTasks),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: teamSparkline,
        },
        slaBreaches: {
            label: "SLA Breaches",
            value: slaBreaches,
            valueDisplay: String(slaBreaches),
            trend: 0,
            trendDirection: "flat",
            isPositive: false,
            sparkline: slaSparkline,
        },
    };
}

function calculateMyWork(userId: string): MyWorkBucket {
    const now = new Date();
    const today = startOfDay(now);
    const todayEnd = endOfDay(now);
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const myTasks = tasks.filter((t) => t.assignees.includes(userId));
    const open = (t: Task) => {
        const status = statuses.find((s) => s.id === t.statusId);
        return (
            status?.statusGroup !== "done" && status?.statusGroup !== "closed"
        );
    };
    const done = (t: Task) => !open(t);

    return {
        today: myTasks
            .filter(
                (t) =>
                    open(t) &&
                    t.dueDate &&
                    new Date(t.dueDate) >= today &&
                    new Date(t.dueDate) <= todayEnd,
            )
            .slice(0, 12),
        overdue: myTasks
            .filter(
                (t) => open(t) && t.dueDate && new Date(t.dueDate) < today,
            )
            .slice(0, 12),
        next: myTasks
            .filter(
                (t) =>
                    open(t) &&
                    t.dueDate &&
                    new Date(t.dueDate) > todayEnd &&
                    new Date(t.dueDate) <= in7Days,
            )
            .slice(0, 12),
        unscheduled: myTasks
            .filter((t) => open(t) && !t.dueDate)
            .slice(0, 12),
        done: myTasks
            .filter(
                (t) =>
                    done(t) &&
                    t.completedAt &&
                    new Date(t.completedAt) >= sevenDaysAgo,
            )
            .slice(0, 12),
    };
}

// ─── Public API ───
export const mockApi = {
    auth: {
        async login(email: string, password: string): Promise<LoginResult> {
            await delay();
            log("POST /auth/login", { email });

            if (!email || !email.includes("@")) {
                throw new Error("Invalid email format");
            }
            if (!password || password.length < 8) {
                throw new Error("Password must be at least 8 characters");
            }

            const user = usersByEmail.get(email.toLowerCase());
            if (!user) {
                throw new Error("Email or password does not match.");
            }

            if (user.email === "admin@company.local") {
                const mfaToken = fakeId();
                pendingMfaTokens.set(mfaToken, user.id);
                return { requires2fa: true, mfaToken };
            }

            setCurrentUser(user);
            return { requires2fa: false, user };
        },

        async verify2fa(mfaToken: string, code: string): Promise<User> {
            await delay();
            log("POST /auth/2fa/verify", { mfaToken, code });

            if (!/^\d{6}$/.test(code)) {
                throw new Error("Invalid 6-digit code");
            }

            const userId = pendingMfaTokens.get(mfaToken);
            if (!userId) {
                throw new Error("MFA session expired. Please log in again.");
            }

            const user = users.find((u) => u.id === userId);
            if (!user) throw new Error("User not found");

            pendingMfaTokens.delete(mfaToken);
            setCurrentUser(user);
            return user;
        },

        async self(): Promise<User> {
            await delay(50, 150);
            log("GET /auth/self");
            if (!currentUser) {
                throw new Error("Not authenticated");
            }
            return currentUser;
        },

        async logout(): Promise<void> {
            await delay(50, 150);
            log("POST /auth/logout");
            setCurrentUser(null);
        },

        async forgotPassword(email: string): Promise<{ token?: string }> {
            await delay();
            log("POST /auth/forgot-password", { email });

            const user = usersByEmail.get(email.toLowerCase());
            if (user) {
                const token = fakeId();
                pendingResetTokens.set(token, user.email);
                log("Reset token (demo only):", token);
                return { token };
            }
            return {};
        },

        async resetPassword(token: string, newPassword: string): Promise<void> {
            await delay();
            log("POST /auth/reset-password", { token });

            if (!pendingResetTokens.has(token)) {
                throw new Error("Invalid or expired reset token");
            }
            if (!newPassword || newPassword.length < 8) {
                throw new Error("Password must be at least 8 characters");
            }
            pendingResetTokens.delete(token);
        },

        async getInvitation(token: string): Promise<{
            email: string;
            role: string;
            invitedByName: string;
            workspaceName: string;
        }> {
            await delay();
            log("GET /auth/invitations/:token", { token });
            return {
                email: "newhire@company.local",
                role: "member",
                invitedByName: "Tanvir Rahman",
                workspaceName: workspace.name,
            };
        },

        async acceptInvitation(
            token: string,
            data: { firstName: string; lastName: string; password: string },
        ): Promise<User> {
            await delay();
            log("POST /auth/accept-invitation", { token });

            if (!data.password || data.password.length < 8) {
                throw new Error("Password must be at least 8 characters");
            }

            const user: User = {
                id: fakeId(),
                firstName: data.firstName,
                lastName: data.lastName,
                email: "newhire@company.local",
                role: "member",
                avatarUrl: `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(`${data.firstName} ${data.lastName}`)}`,
                status: "active",
                timezone: "Asia/Dhaka",
                createdAt: new Date().toISOString(),
                lastLoginAt: new Date().toISOString(),
            };
            setCurrentUser(user);
            return user;
        },

        async setup2fa(): Promise<{ secret: string; qrUri: string }> {
            await delay();
            log("POST /auth/2fa/setup");
            const secret = "JBSWY3DPEHPK3PXP";
            const email = currentUser?.email ?? "user@example.com";
            return {
                secret,
                qrUri: `otpauth://totp/TaskHub:${email}?secret=${secret}&issuer=TaskHub`,
            };
        },

        async enable2fa(code: string): Promise<{ backupCodes: string[] }> {
            await delay();
            log("POST /auth/2fa/enable", { code });
            if (!/^\d{6}$/.test(code)) {
                throw new Error("Invalid 6-digit code");
            }
            const backupCodes = Array.from({ length: 10 }, () =>
                Math.random().toString(36).slice(2, 10).toUpperCase(),
            );
            return { backupCodes };
        },
    },

    workspace: {
        async get(): Promise<Workspace> {
            await delay(50, 150);
            log("GET /workspace");
            return workspace;
        },
        async update(
            patch: Partial<Omit<Workspace, "id">>,
        ): Promise<Workspace> {
            await delay();
            Object.assign(workspace, patch);
            if (patch.settings) {
                Object.assign(workspace.settings, patch.settings);
            }
            log("PATCH /workspace", patch);
            return workspace;
        },
    },

    users: {
        async list(): Promise<User[]> {
            await delay();
            log("GET /users");
            return users;
        },
        async getById(id: string): Promise<User | null> {
            await delay(50, 150);
            return users.find((u) => u.id === id) ?? null;
        },
        async invite(input: {
            firstName: string;
            lastName: string;
            email: string;
            role: User["role"];
        }): Promise<User> {
            await delay();
            const existing = usersByEmail.get(input.email.toLowerCase());
            if (existing)
                throw new Error("A user with this email already exists.");
            const user: User = {
                id: `u-${fakeId().slice(0, 8)}`,
                firstName: input.firstName,
                lastName: input.lastName,
                email: input.email,
                role: input.role,
                avatarUrl: null,
                status: "invited",
                timezone: workspace.settings.timezone,
                createdAt: new Date().toISOString(),
                lastLoginAt: null,
            };
            users.push(user);
            usersByEmail.set(user.email.toLowerCase(), user);
            log("POST /users/invite", user);
            return user;
        },
        async updateRole(id: string, role: User["role"]): Promise<User> {
            await delay();
            const u = users.find((x) => x.id === id);
            if (!u) throw new Error("User not found");
            u.role = role;
            log("PATCH /users/:id/role", { id, role });
            return u;
        },
        async deactivate(id: string): Promise<User> {
            await delay();
            const u = users.find((x) => x.id === id);
            if (!u) throw new Error("User not found");
            u.status = "deactivated";
            log("POST /users/:id/deactivate", { id });
            return u;
        },
        async reactivate(id: string): Promise<User> {
            await delay();
            const u = users.find((x) => x.id === id);
            if (!u) throw new Error("User not found");
            u.status = "active";
            log("POST /users/:id/reactivate", { id });
            return u;
        },
        async updateProfile(
            id: string,
            patch: Partial<
                Pick<
                    User,
                    "firstName" | "lastName" | "email" | "timezone" | "avatarUrl"
                >
            >,
        ): Promise<User> {
            await delay();
            const u = users.find((x) => x.id === id);
            if (!u) throw new Error("User not found");
            if (patch.email && patch.email !== u.email) {
                usersByEmail.delete(u.email.toLowerCase());
                usersByEmail.set(patch.email.toLowerCase(), u);
            }
            Object.assign(u, patch);
            log("PATCH /users/:id", { id, patch });
            return u;
        },
        async changePassword(_input: {
            currentPassword: string;
            newPassword: string;
        }): Promise<void> {
            await delay(200, 400);
            log("POST /users/me/change-password");
        },
    },

    spaces: {
        async list(): Promise<Space[]> {
            await delay();
            log("GET /spaces");
            return spaces.filter((s) => !s.archivedAt);
        },
        async getById(id: string): Promise<Space | null> {
            await delay(50, 150);
            return spaces.find((s) => s.id === id) ?? null;
        },
        async create(input: {
            name: string;
            icon: string;
            color: string;
            description?: string;
            isPrivate?: boolean;
        }): Promise<Space> {
            await delay();
            const space: Space = {
                id: `sp-${fakeId().slice(0, 8)}`,
                workspaceId: workspace.id,
                name: input.name,
                description: input.description,
                icon: input.icon,
                color: input.color,
                isPrivate: input.isPrivate ?? false,
                position: spaces.length + 1,
                archivedAt: null,
                createdBy: currentUser?.id ?? "u-001",
            };
            spaces.push(space);
            log("POST /spaces", space);
            return space;
        },
        async update(
            id: string,
            patch: Partial<Pick<Space, "name" | "description" | "icon" | "color" | "isPrivate">>,
        ): Promise<Space> {
            await delay();
            const s = spaces.find((x) => x.id === id);
            if (!s) throw new Error("Space not found");
            Object.assign(s, patch);
            log("PATCH /spaces/:id", { id, patch });
            return s;
        },
        async archive(id: string): Promise<Space> {
            await delay();
            const s = spaces.find((x) => x.id === id);
            if (!s) throw new Error("Space not found");
            s.archivedAt = new Date().toISOString();
            log("POST /spaces/:id/archive", { id });
            return s;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = spaces.findIndex((x) => x.id === id);
            if (idx >= 0) spaces.splice(idx, 1);
            log("DELETE /spaces/:id", { id });
        },
    },

    folders: {
        async list() {
            await delay(50, 150);
            return folders;
        },
        async listBySpace(spaceId: string) {
            await delay(50, 150);
            return folders.filter(
                (f) => f.spaceId === spaceId && !f.archivedAt,
            );
        },
    },

    lists: {
        async listAll(): Promise<List[]> {
            await delay();
            return lists.filter((l) => !l.archivedAt);
        },
        async listBySpace(spaceId: string): Promise<List[]> {
            await delay();
            log("GET /spaces/:id/lists", { spaceId });
            return lists.filter(
                (l) => l.spaceId === spaceId && !l.archivedAt,
            );
        },
        async getById(id: string): Promise<List | null> {
            await delay(50, 150);
            return lists.find((l) => l.id === id) ?? null;
        },
        async create(input: {
            spaceId: string;
            folderId?: string | null;
            name: string;
            icon?: string;
            color?: string;
        }): Promise<List> {
            await delay();
            const list: List = {
                id: `l-${fakeId().slice(0, 8)}`,
                spaceId: input.spaceId,
                folderId: input.folderId ?? null,
                name: input.name,
                icon: input.icon ?? "ListChecks",
                color: input.color ?? "#4F46E5",
                position:
                    lists.filter((l) => l.spaceId === input.spaceId).length + 1,
                isPrivate: false,
                archivedAt: null,
                createdBy: currentUser?.id ?? "u-001",
            };
            lists.push(list);
            log("POST /lists", list);
            return list;
        },
        async update(
            id: string,
            patch: Partial<Pick<List, "name" | "icon" | "color" | "folderId">>,
        ): Promise<List> {
            await delay();
            const l = lists.find((x) => x.id === id);
            if (!l) throw new Error("List not found");
            Object.assign(l, patch);
            log("PATCH /lists/:id", { id, patch });
            return l;
        },
        async archive(id: string): Promise<List> {
            await delay();
            const l = lists.find((x) => x.id === id);
            if (!l) throw new Error("List not found");
            l.archivedAt = new Date().toISOString();
            log("POST /lists/:id/archive", { id });
            return l;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = lists.findIndex((x) => x.id === id);
            if (idx >= 0) lists.splice(idx, 1);
            log("DELETE /lists/:id", { id });
        },
    },

    statuses: {
        async byList(listId: string): Promise<Status[]> {
            await delay(50, 150);
            return statusesByList(listId);
        },
    },

    taskTypes: {
        async list(): Promise<TaskType[]> {
            await delay(50, 150);
            return taskTypes;
        },
        async create(
            input: Omit<TaskType, "id" | "workspaceId" | "isSystem">,
        ): Promise<TaskType> {
            await delay();
            const tt: TaskType = {
                id: `tt-${fakeId().slice(0, 8)}`,
                workspaceId: workspace.id,
                isSystem: false,
                ...input,
            };
            taskTypes.push(tt);
            log("POST /task-types", tt);
            return tt;
        },
        async update(
            id: string,
            patch: Partial<Omit<TaskType, "id" | "workspaceId" | "isSystem">>,
        ): Promise<TaskType> {
            await delay();
            const tt = taskTypes.find((x) => x.id === id);
            if (!tt) throw new Error("Task type not found");
            Object.assign(tt, patch);
            log("PATCH /task-types/:id", { id, patch });
            return tt;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = taskTypes.findIndex((x) => x.id === id);
            if (idx < 0) return;
            if (taskTypes[idx].isSystem)
                throw new Error("Cannot delete a system task type.");
            taskTypes.splice(idx, 1);
            log("DELETE /task-types/:id", { id });
        },
    },

    tags: {
        async list(): Promise<Tag[]> {
            await delay(50, 150);
            return tags;
        },
        async bySpace(spaceId: string): Promise<Tag[]> {
            await delay(50, 150);
            return tags.filter((t) => t.spaceId === spaceId);
        },
        async create(input: Omit<Tag, "id">): Promise<Tag> {
            await delay();
            const tag: Tag = {
                id: `tag-${fakeId().slice(0, 8)}`,
                ...input,
            };
            tags.push(tag);
            log("POST /tags", tag);
            return tag;
        },
        async update(
            id: string,
            patch: Partial<Omit<Tag, "id">>,
        ): Promise<Tag> {
            await delay();
            const tag = tags.find((x) => x.id === id);
            if (!tag) throw new Error("Tag not found");
            Object.assign(tag, patch);
            log("PATCH /tags/:id", { id, patch });
            return tag;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = tags.findIndex((x) => x.id === id);
            if (idx >= 0) tags.splice(idx, 1);
            log("DELETE /tags/:id", { id });
        },
    },

    tasks: {
        async listByList(listId: string): Promise<Task[]> {
            await delay();
            log("GET /lists/:id/tasks", { listId });
            return tasks.filter(
                (t) => t.primaryListId === listId && !t.archivedAt,
            );
        },
        async getById(id: string): Promise<Task | null> {
            await delay(50, 150);
            // Support both internal id (t-1234) and customId (ORD-1234)
            return (
                tasks.find((t) => t.id === id || t.customId === id) ?? null
            );
        },
        async myWork(userId: string): Promise<MyWorkBucket> {
            await delay();
            log("GET /tasks/my-work", { userId });
            return calculateMyWork(userId);
        },
        async subtasks(parentId: string): Promise<Task[]> {
            await delay(50, 150);
            return tasks.filter(
                (t) => t.parentTaskId === parentId && !t.archivedAt,
            );
        },
        async update(id: string, patch: Partial<Task>): Promise<Task> {
            await delay(80, 200);
            log("PATCH /tasks/:id", { id, patch });
            const idx = tasks.findIndex(
                (t) => t.id === id || t.customId === id,
            );
            if (idx < 0) throw new Error("Task not found");
            const now = new Date().toISOString();
            const status = patch.statusId
                ? statuses.find((s) => s.id === patch.statusId)
                : null;
            const completedAt =
                status && (status.statusGroup === "done" || status.statusGroup === "closed")
                    ? tasks[idx].completedAt ?? now
                    : status
                      ? null
                      : tasks[idx].completedAt;
            tasks[idx] = {
                ...tasks[idx],
                ...patch,
                updatedAt: now,
                completedAt,
            };
            return tasks[idx];
        },
        async create(input: Partial<Task> & { name: string; primaryListId: string }): Promise<Task> {
            await delay(100, 250);
            log("POST /tasks", input);
            const list = lists.find((l) => l.id === input.primaryListId);
            if (!list) throw new Error("List not found");
            const listStatuses = statusesByList(list.id);
            const defaultStatus =
                listStatuses.find((s) => s.statusGroup === "not_started") ??
                listStatuses[0];
            const now = new Date().toISOString();
            const taskNumber = Math.floor(Math.random() * 100000) + 5000;
            const newTask: Task = {
                id: `t-${taskNumber}`,
                taskNumber,
                name: input.name,
                statusId: input.statusId ?? defaultStatus.id,
                priority: input.priority ?? 0,
                taskTypeId:
                    input.taskTypeId ?? list.defaultTaskTypeId ?? "tt-task",
                primaryListId: list.id,
                parentTaskId: input.parentTaskId ?? null,
                isMilestone: false,
                startDate: input.startDate ?? null,
                dueDate: input.dueDate ?? null,
                timeEstimateSeconds: null,
                timeTrackedSeconds: 0,
                assignees: input.assignees ?? [],
                watchers: [],
                tags: input.tags ?? [],
                customFields: input.customFields ?? {},
                subtasksCount: 0,
                subtasksCompleted: 0,
                commentsCount: 0,
                attachmentsCount: 0,
                createdAt: now,
                updatedAt: now,
                createdBy: currentUser?.id ?? "u-001",
                completedAt: null,
                archivedAt: null,
                nestingDepth: input.parentTaskId ? 1 : 0,
            };
            tasks.unshift(newTask);
            return newTask;
        },
        async bulkUpdate(ids: string[], patch: Partial<Task>): Promise<Task[]> {
            await delay(100, 250);
            log("POST /tasks/bulk", { ids, patch });
            const now = new Date().toISOString();
            const updated: Task[] = [];
            for (const id of ids) {
                const idx = tasks.findIndex((t) => t.id === id);
                if (idx >= 0) {
                    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: now };
                    updated.push(tasks[idx]);
                }
            }
            return updated;
        },
        async archive(id: string): Promise<void> {
            await delay(80, 200);
            log("POST /tasks/:id/archive", { id });
            const idx = tasks.findIndex((t) => t.id === id);
            if (idx >= 0)
                tasks[idx] = {
                    ...tasks[idx],
                    archivedAt: new Date().toISOString(),
                };
        },
        async delete(id: string): Promise<void> {
            await delay(80, 200);
            log("DELETE /tasks/:id", { id });
            const idx = tasks.findIndex((t) => t.id === id);
            if (idx >= 0) tasks.splice(idx, 1);
        },
    },

    comments: {
        async byTask(taskId: string): Promise<Comment[]> {
            await delay(50, 150);
            log("GET /tasks/:id/comments", { taskId });
            return commentsByTask(taskId);
        },
        async create(
            taskId: string,
            body: string,
            authorId: string,
            parentCommentId: string | null = null,
        ): Promise<Comment> {
            await delay(80, 200);
            log("POST /tasks/:id/comments", { taskId, body, parentCommentId });
            const newComment: Comment = {
                id: `c-${Date.now()}`,
                taskId,
                parentCommentId,
                authorId,
                body,
                assignedTo: null,
                resolvedAt: null,
                resolvedBy: null,
                editedAt: null,
                deletedAt: null,
                reactions: [],
                createdAt: new Date().toISOString(),
            };
            comments.push(newComment);
            const task = tasks.find((t) => t.id === taskId);
            if (task) task.commentsCount = (task.commentsCount ?? 0) + 1;
            return newComment;
        },
        async toggleReaction(
            commentId: string,
            emoji: string,
            userId: string,
        ): Promise<Comment> {
            await delay(40, 100);
            const c = comments.find((x) => x.id === commentId);
            if (!c) throw new Error("Comment not found");
            const reaction = c.reactions.find((r) => r.emoji === emoji);
            if (reaction) {
                if (reaction.userIds.includes(userId)) {
                    reaction.userIds = reaction.userIds.filter(
                        (u) => u !== userId,
                    );
                    if (reaction.userIds.length === 0)
                        c.reactions = c.reactions.filter((r) => r !== reaction);
                } else {
                    reaction.userIds.push(userId);
                }
            } else {
                c.reactions.push({ emoji, userIds: [userId] });
            }
            return c;
        },
        async update(
            commentId: string,
            patch: { body: string },
        ): Promise<Comment> {
            await delay(40, 120);
            const c = comments.find((x) => x.id === commentId);
            if (!c) throw new Error("Comment not found");
            c.body = patch.body;
            c.editedAt = new Date().toISOString();
            log("PATCH /comments/:id", { commentId });
            return c;
        },
        async assign(
            commentId: string,
            assignedTo: string | null,
        ): Promise<Comment> {
            await delay(40, 120);
            const c = comments.find((x) => x.id === commentId);
            if (!c) throw new Error("Comment not found");
            c.assignedTo = assignedTo;
            log("PATCH /comments/:id/assign", { commentId, assignedTo });
            return c;
        },
        async toggleResolve(
            commentId: string,
            userId: string,
        ): Promise<Comment> {
            await delay(40, 120);
            const c = comments.find((x) => x.id === commentId);
            if (!c) throw new Error("Comment not found");
            if (c.resolvedAt) {
                c.resolvedAt = null;
                c.resolvedBy = null;
            } else {
                c.resolvedAt = new Date().toISOString();
                c.resolvedBy = userId;
            }
            log("POST /comments/:id/resolve", {
                commentId,
                resolved: !!c.resolvedAt,
            });
            return c;
        },
        async delete(commentId: string): Promise<void> {
            await delay(50, 150);
            const c = comments.find((x) => x.id === commentId);
            if (c) c.deletedAt = new Date().toISOString();
        },
    },

    attachments: {
        async byTask(taskId: string): Promise<Attachment[]> {
            await delay(50, 150);
            return attachmentsByTask(taskId);
        },
        async upload(input: {
            taskId: string;
            name: string;
            type: string;
            size: number;
            url?: string;
            thumbnailUrl?: string;
        }): Promise<Attachment> {
            await delay(150, 400);
            const att: Attachment = {
                id: `att-${fakeId().slice(0, 8)}`,
                taskId: input.taskId,
                name: input.name,
                type: input.type,
                size: input.size,
                url: input.url ?? `/mock-files/${input.name}`,
                thumbnailUrl: input.thumbnailUrl,
                uploadedBy: currentUser?.id ?? "u-001",
                uploadedAt: new Date().toISOString(),
            };
            attachments.push(att);
            // Bump count on task
            const task = tasks.find((t) => t.id === input.taskId);
            if (task) task.attachmentsCount = (task.attachmentsCount ?? 0) + 1;
            log("POST /tasks/:id/attachments", att);
            return att;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = attachments.findIndex((a) => a.id === id);
            if (idx >= 0) {
                const removed = attachments[idx];
                attachments.splice(idx, 1);
                const task = tasks.find((t) => t.id === removed.taskId);
                if (task && task.attachmentsCount > 0)
                    task.attachmentsCount -= 1;
            }
            log("DELETE /attachments/:id", { id });
        },
    },

    timeTracking: {
        async byTask(taskId: string): Promise<TimeLog[]> {
            await delay(50, 150);
            return timeLogsByTask(taskId);
        },
        async byUser(userId: string): Promise<TimeLog[]> {
            await delay(50, 150);
            return timeLogsByUser(userId);
        },
        async log(input: {
            taskId: string;
            userId: string;
            durationSeconds: number;
            note?: string;
            startedAt?: string;
            endedAt?: string;
        }): Promise<TimeLog> {
            await delay();
            const startedAt = input.startedAt ?? new Date().toISOString();
            const endedAt =
                input.endedAt ??
                new Date(
                    new Date(startedAt).getTime() +
                        input.durationSeconds * 1000,
                ).toISOString();
            const log_: TimeLog = {
                id: `tl-${fakeId().slice(0, 8)}`,
                taskId: input.taskId,
                userId: input.userId,
                durationSeconds: input.durationSeconds,
                note: input.note,
                startedAt,
                endedAt,
                createdAt: new Date().toISOString(),
            };
            timeLogs.push(log_);
            const task = tasks.find((t) => t.id === input.taskId);
            if (task) task.timeTrackedSeconds += input.durationSeconds;
            log("POST /time-logs", log_);
            return log_;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = timeLogs.findIndex((l) => l.id === id);
            if (idx >= 0) {
                const removed = timeLogs[idx];
                timeLogs.splice(idx, 1);
                const task = tasks.find((t) => t.id === removed.taskId);
                if (task && task.timeTrackedSeconds > 0)
                    task.timeTrackedSeconds = Math.max(
                        0,
                        task.timeTrackedSeconds - removed.durationSeconds,
                    );
            }
            log("DELETE /time-logs/:id", { id });
        },
    },

    taskDependencies: {
        async byTask(
            taskId: string,
        ): Promise<Array<TaskDependency & { otherTaskId: string }>> {
            await delay(50, 150);
            return dependenciesForTask(taskId);
        },
        async byList(listId: string): Promise<TaskDependency[]> {
            await delay(50, 150);
            const taskIds = new Set(
                tasks
                    .filter((t) => t.primaryListId === listId)
                    .map((t) => t.id),
            );
            return taskDependencies.filter(
                (d) =>
                    taskIds.has(d.taskId) || taskIds.has(d.relatedTaskId),
            );
        },
        async create(input: {
            taskId: string;
            relatedTaskId: string;
            type: DependencyType;
        }): Promise<TaskDependency> {
            await delay();
            if (input.taskId === input.relatedTaskId) {
                throw new Error("A task cannot depend on itself");
            }
            const dep: TaskDependency = {
                id: `dep-${fakeId().slice(0, 8)}`,
                taskId: input.taskId,
                relatedTaskId: input.relatedTaskId,
                type: input.type,
                createdAt: new Date().toISOString(),
                createdBy: currentUser?.id ?? "u-001",
            };
            taskDependencies.push(dep);
            log("POST /task-dependencies", dep);
            return dep;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = taskDependencies.findIndex((d) => d.id === id);
            if (idx >= 0) taskDependencies.splice(idx, 1);
            log("DELETE /task-dependencies/:id", { id });
        },
    },

    checklists: {
        async byTask(taskId: string): Promise<Checklist[]> {
            await delay(50, 150);
            return checklistsByTask(taskId);
        },
        async create(taskId: string, name: string): Promise<Checklist> {
            await delay(80, 200);
            const c: Checklist = {
                id: `ch-${Date.now()}`,
                taskId,
                name,
                position: checklistsByTask(taskId).length,
                items: [],
            };
            checklists.push(c);
            return c;
        },
        async rename(checklistId: string, name: string): Promise<void> {
            await delay(40, 120);
            const c = checklists.find((x) => x.id === checklistId);
            if (c) c.name = name;
        },
        async deleteChecklist(checklistId: string): Promise<void> {
            await delay(40, 120);
            const idx = checklists.findIndex((x) => x.id === checklistId);
            if (idx >= 0) checklists.splice(idx, 1);
        },
        async addItem(
            checklistId: string,
            text: string,
        ): Promise<ChecklistItem> {
            await delay(40, 120);
            const c = checklists.find((x) => x.id === checklistId);
            if (!c) throw new Error("Checklist not found");
            const item: ChecklistItem = {
                id: `ci-${Date.now()}`,
                checklistId,
                parentItemId: null,
                text,
                isCompleted: false,
                assigneeId: null,
                position: c.items.length,
            };
            c.items.push(item);
            return item;
        },
        async toggleItem(itemId: string): Promise<ChecklistItem> {
            await delay(30, 100);
            for (const c of checklists) {
                const item = c.items.find((i) => i.id === itemId);
                if (item) {
                    item.isCompleted = !item.isCompleted;
                    return item;
                }
            }
            throw new Error("Item not found");
        },
        async updateItem(
            itemId: string,
            text: string,
        ): Promise<ChecklistItem> {
            await delay(30, 100);
            for (const c of checklists) {
                const item = c.items.find((i) => i.id === itemId);
                if (item) {
                    item.text = text;
                    return item;
                }
            }
            throw new Error("Item not found");
        },
        async deleteItem(itemId: string): Promise<void> {
            await delay(30, 100);
            for (const c of checklists) {
                const idx = c.items.findIndex((i) => i.id === itemId);
                if (idx >= 0) {
                    c.items.splice(idx, 1);
                    return;
                }
            }
        },
    },

    home: {
        async kpis(): Promise<HomeKpiSet> {
            await delay();
            log("GET /home/kpis");
            return calculateHomeKpis();
        },
    },

    campaignTemplates: {
        /** Spawn a parent task with a multi-step checklist from a named template. */
        async apply(input: {
            templateName: string;
            listId: string;
            createdBy: string;
        }): Promise<Task> {
            await delay(120, 280);
            log("POST /campaign-templates/apply", input);

            const list = lists.find((l) => l.id === input.listId);
            if (!list) throw new Error("List not found");
            const listStatuses = statusesByList(list.id);
            const defaultStatus =
                listStatuses.find((s) => s.statusGroup === "not_started") ??
                listStatuses[0];

            const taskNumber = Math.floor(Math.random() * 100000) + 5000;
            const now = new Date().toISOString();
            const parent: Task = {
                id: `t-${taskNumber}`,
                taskNumber,
                name: `${input.templateName} Campaign`,
                statusId: defaultStatus.id,
                priority: 2,
                taskTypeId: "tt-campaign",
                primaryListId: list.id,
                parentTaskId: null,
                isMilestone: false,
                startDate: null,
                dueDate: null,
                timeEstimateSeconds: null,
                timeTrackedSeconds: 0,
                assignees: [input.createdBy],
                watchers: [],
                tags: [],
                customFields: {},
                subtasksCount: 0,
                subtasksCompleted: 0,
                commentsCount: 0,
                attachmentsCount: 0,
                createdAt: now,
                updatedAt: now,
                createdBy: input.createdBy,
                completedAt: null,
                archivedAt: null,
                nestingDepth: 0,
            };
            tasks.unshift(parent);

            const items = [
                "Confirm budget with owner",
                "Pick hero products (5-8)",
                "Brief creative team — copy",
                "Photography / mockups",
                "Design social posts",
                "Schedule posts",
                "Set boost budget per post",
                "Coordinate with inventory team",
                "Brief CS team — expected spike",
                "Brief operations — packing schedule",
                "Launch — go live",
                "Post-campaign review",
            ];
            const checklist: Checklist = {
                id: `ch-${Date.now()}`,
                taskId: parent.id,
                name: `${input.templateName} 12-step playbook`,
                position: 0,
                items: items.map((text, i) => ({
                    id: `ci-${Date.now()}-${i}`,
                    checklistId: `ch-${Date.now()}`,
                    parentItemId: null,
                    text,
                    isCompleted: false,
                    assigneeId: null,
                    position: i,
                })),
            };
            checklists.push(checklist);
            parent.subtasksCount = items.length;
            return parent;
        },
    },

    notifications: {
        async list(userId: string): Promise<Notification[]> {
            await delay(50, 150);
            return notificationsByUser(userId);
        },
        async unreadCount(userId: string): Promise<number> {
            await delay(50, 100);
            return unreadCountForUser(userId);
        },
        async markAsRead(id: string): Promise<Notification> {
            await delay(50, 150);
            const n = notifications.find((x) => x.id === id);
            if (!n) throw new Error("Notification not found");
            n.isRead = true;
            log("PATCH /notifications/:id/read", { id });
            return n;
        },
        async markAsUnread(id: string): Promise<Notification> {
            await delay(50, 150);
            const n = notifications.find((x) => x.id === id);
            if (!n) throw new Error("Notification not found");
            n.isRead = false;
            log("PATCH /notifications/:id/unread", { id });
            return n;
        },
        async markAllAsRead(userId: string): Promise<void> {
            await delay();
            notifications.forEach((n) => {
                if (n.userId === userId) n.isRead = true;
            });
            log("POST /notifications/mark-all-read", { userId });
        },
        async snooze(
            id: string,
            until: string,
        ): Promise<Notification> {
            await delay();
            const n = notifications.find((x) => x.id === id);
            if (!n) throw new Error("Notification not found");
            n.snoozedUntil = until;
            log("POST /notifications/:id/snooze", { id, until });
            return n;
        },
        async archive(id: string): Promise<void> {
            await delay();
            const idx = notifications.findIndex((x) => x.id === id);
            if (idx >= 0) notifications.splice(idx, 1);
            log("DELETE /notifications/:id", { id });
        },
    },

    notes: {
        async list(userId: string): Promise<Note[]> {
            await delay(50, 150);
            return notesByUser(userId);
        },
        async getById(id: string): Promise<Note | null> {
            await delay(50, 100);
            return notesById.get(id) ?? null;
        },
        async create(input: {
            userId: string;
            title?: string;
            body?: string;
            color?: string;
        }): Promise<Note> {
            await delay();
            const id = `note-${fakeId().slice(0, 8)}`;
            const note: Note = {
                id,
                userId: input.userId,
                title: input.title ?? "Untitled note",
                body: input.body ?? "",
                isPinned: false,
                color: input.color,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            notes.push(note);
            notesById.set(id, note);
            log("POST /notes", note);
            return note;
        },
        async update(
            id: string,
            patch: Partial<Pick<Note, "title" | "body" | "color">>,
        ): Promise<Note> {
            await delay(50, 200);
            const n = notesById.get(id);
            if (!n) throw new Error("Note not found");
            Object.assign(n, patch);
            n.updatedAt = new Date().toISOString();
            log("PATCH /notes/:id", { id, patch });
            return n;
        },
        async togglePin(id: string): Promise<Note> {
            await delay(50, 150);
            const n = notesById.get(id);
            if (!n) throw new Error("Note not found");
            n.isPinned = !n.isPinned;
            n.updatedAt = new Date().toISOString();
            log("POST /notes/:id/pin", { id, isPinned: n.isPinned });
            return n;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = notes.findIndex((n) => n.id === id);
            if (idx >= 0) notes.splice(idx, 1);
            notesById.delete(id);
            log("DELETE /notes/:id", { id });
        },
    },

    search: {
        async global(input: {
            query: string;
            types?: Array<
                "task" | "list" | "space" | "note" | "comment" | "user"
            >;
            limit?: number;
        }): Promise<{
            tasks: Task[];
            lists: List[];
            spaces: Space[];
            notes: Note[];
            comments: Comment[];
            users: User[];
            total: number;
        }> {
            await delay(80, 200);
            const q = input.query.trim().toLowerCase();
            if (!q) {
                return {
                    tasks: [],
                    lists: [],
                    spaces: [],
                    notes: [],
                    comments: [],
                    users: [],
                    total: 0,
                };
            }
            const want = (t: string) =>
                !input.types || input.types.includes(t as never);
            const limit = input.limit ?? 8;

            const matchTask = want("task")
                ? tasks
                      .filter(
                          (t) =>
                              t.name.toLowerCase().includes(q) ||
                              (t.customId &&
                                  t.customId.toLowerCase().includes(q)),
                      )
                      .slice(0, limit)
                : [];
            const matchList = want("list")
                ? lists
                      .filter((l) => l.name.toLowerCase().includes(q))
                      .slice(0, limit)
                : [];
            const matchSpace = want("space")
                ? spaces
                      .filter((s) => s.name.toLowerCase().includes(q))
                      .slice(0, limit)
                : [];
            const matchNote = want("note")
                ? notes
                      .filter(
                          (n) =>
                              n.userId === (currentUser?.id ?? "u-001") &&
                              (n.title.toLowerCase().includes(q) ||
                                  n.body.toLowerCase().includes(q)),
                      )
                      .slice(0, limit)
                : [];
            const matchComment = want("comment")
                ? comments
                      .filter((c) =>
                          (c.body ?? "").toLowerCase().includes(q),
                      )
                      .slice(0, limit)
                : [];
            const matchUser = want("user")
                ? users
                      .filter(
                          (u) =>
                              `${u.firstName} ${u.lastName}`
                                  .toLowerCase()
                                  .includes(q) ||
                              u.email.toLowerCase().includes(q),
                      )
                      .slice(0, limit)
                : [];

            const total =
                matchTask.length +
                matchList.length +
                matchSpace.length +
                matchNote.length +
                matchComment.length +
                matchUser.length;

            log("GET /search", { query: q, total });
            return {
                tasks: matchTask,
                lists: matchList,
                spaces: matchSpace,
                notes: matchNote,
                comments: matchComment,
                users: matchUser,
                total,
            };
        },
    },

    customFields: {
        async list(): Promise<CustomField[]> {
            await delay(50, 150);
            log("GET /custom-fields");
            return customFields;
        },
        async byList(listId: string): Promise<CustomField[]> {
            await delay(50, 150);
            log("GET /custom-fields?listId=", listId);
            return customFieldsByList(listId);
        },
        async byScope(
            scopeType: "workspace" | "space" | "list",
            scopeId?: string,
        ): Promise<CustomField[]> {
            await delay(50, 150);
            return customFieldsByScope(scopeType, scopeId);
        },
        async getById(id: string): Promise<CustomField | null> {
            await delay(50, 100);
            return customFieldsById.get(id) ?? null;
        },
        async create(field: Omit<CustomField, "id">): Promise<CustomField> {
            await delay();
            log("POST /custom-fields", field);
            const newField: CustomField = {
                ...field,
                id: `cf_new_${Date.now()}`,
            };
            customFields.push(newField);
            customFieldsById.set(newField.id, newField);
            return newField;
        },
        async update(
            id: string,
            patch: Partial<CustomField>,
        ): Promise<CustomField> {
            await delay();
            log("PATCH /custom-fields/:id", { id, patch });
            const idx = customFields.findIndex((f) => f.id === id);
            if (idx < 0) throw new Error("Field not found");
            customFields[idx] = { ...customFields[idx], ...patch };
            customFieldsById.set(id, customFields[idx]);
            return customFields[idx];
        },
        async delete(id: string): Promise<void> {
            await delay();
            log("DELETE /custom-fields/:id", { id });
            const idx = customFields.findIndex((f) => f.id === id);
            if (idx >= 0) {
                customFields.splice(idx, 1);
                customFieldsById.delete(id);
            }
        },
    },

    forms: {
        async list(): Promise<Form[]> {
            await delay();
            log("GET /forms");
            return forms;
        },
        async byList(listId: string): Promise<Form[]> {
            await delay(50, 150);
            return formsByList(listId);
        },
        async getById(id: string): Promise<Form | null> {
            await delay(50, 150);
            return formsById.get(id) ?? null;
        },
        async getBySlug(slug: string): Promise<Form | null> {
            await delay();
            log("GET /public/forms/:slug", slug);
            return formsBySlug.get(slug) ?? null;
        },
        async create(input: {
            listId: string;
            title: string;
            description?: string;
        }): Promise<Form> {
            await delay();
            log("POST /forms", input);
            const now = new Date().toISOString();
            const slug =
                input.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 60) +
                "-" +
                String(Date.now()).slice(-4);
            const newForm: Form = {
                id: `form-${Date.now()}`,
                listId: input.listId,
                title: input.title,
                description: input.description,
                isPublic: true,
                publicSlug: slug,
                branding: {
                    primaryColor: "#4F46E5",
                    layout: "single_column",
                    hideAppBranding: false,
                    theme: "light",
                },
                settings: {
                    requireLogin: false,
                    enableRecaptcha: true,
                    submissionOpen: true,
                },
                submissionCount: 0,
                fields: [
                    {
                        id: `ff-${Date.now()}`,
                        fieldKind: "task_attr",
                        fieldKey: "name",
                        label: "Task name",
                        isRequired: true,
                        isHidden: false,
                        defaultValue: null,
                        position: 0,
                    },
                ],
                createdBy: currentUser?.id ?? "u-001",
                createdAt: now,
                updatedAt: now,
            };
            forms.push(newForm);
            formsById.set(newForm.id, newForm);
            formsBySlug.set(newForm.publicSlug, newForm);
            return newForm;
        },
        async update(id: string, patch: Partial<Form>): Promise<Form> {
            await delay();
            log("PATCH /forms/:id", { id, patch });
            const idx = forms.findIndex((f) => f.id === id);
            if (idx < 0) throw new Error("Form not found");
            forms[idx] = {
                ...forms[idx],
                ...patch,
                updatedAt: new Date().toISOString(),
            };
            formsById.set(id, forms[idx]);
            return forms[idx];
        },
        async delete(id: string): Promise<void> {
            await delay();
            log("DELETE /forms/:id", { id });
            const idx = forms.findIndex((f) => f.id === id);
            if (idx >= 0) {
                forms.splice(idx, 1);
                formsById.delete(id);
            }
        },
        async submissionsForForm(formId: string): Promise<FormSubmission[]> {
            await delay(50, 150);
            return submissionsByForm(formId);
        },
        async submit(
            slug: string,
            data: Record<string, unknown>,
        ): Promise<{ taskId: string; submissionId: string }> {
            await delay();
            log("POST /public/forms/:slug/submit", { slug, data });
            const form = formsBySlug.get(slug);
            if (!form) throw new Error("Form not found");

            // Map form data → task fields
            const customFieldVals: Record<string, unknown> = {};
            let taskName = "Untitled (from form)";
            for (const field of form.fields) {
                const value = data[field.fieldKey];
                if (value === undefined || value === null || value === "")
                    continue;
                if (field.fieldKind === "custom_field") {
                    customFieldVals[field.fieldKey] = wrapCustomFieldValue(
                        field.fieldKey,
                        value,
                    );
                } else if (field.fieldKey === "name") {
                    taskName = String(value);
                }
            }

            const taskNumber = Math.floor(Math.random() * 100000) + 5000;
            const newTask: Task = {
                id: `t-${taskNumber}`,
                taskNumber,
                customId: `FRM-${taskNumber}`,
                name: taskName,
                statusId:
                    statusesByList(form.listId)[0]?.id ?? "unknown",
                priority: 3,
                taskTypeId: "tt-task",
                primaryListId: form.listId,
                parentTaskId: null,
                isMilestone: false,
                startDate: null,
                dueDate: null,
                timeEstimateSeconds: null,
                timeTrackedSeconds: 0,
                assignees: [],
                watchers: [],
                tags: [],
                customFields: customFieldVals,
                subtasksCount: 0,
                subtasksCompleted: 0,
                commentsCount: 0,
                attachmentsCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "u-001",
                completedAt: null,
                archivedAt: null,
                nestingDepth: 0,
            };
            tasks.unshift(newTask);

            const submission: FormSubmission = {
                id: `fs-${Date.now()}`,
                formId: form.id,
                taskId: newTask.id,
                data,
                submittedAt: new Date().toISOString(),
            };
            formSubmissions.unshift(submission);
            form.submissionCount += 1;

            return { taskId: newTask.id, submissionId: submission.id };
        },
    },

    automations: {
        async list(): Promise<Automation[]> {
            await delay();
            log("GET /automations");
            return automations;
        },
        async byList(listId: string): Promise<Automation[]> {
            await delay(50, 150);
            return automationsByList(listId);
        },
        async getById(id: string): Promise<Automation | null> {
            await delay(50, 150);
            return automationsById.get(id) ?? null;
        },
        async create(
            input: Partial<Automation> & { name: string },
        ): Promise<Automation> {
            await delay();
            const now = new Date().toISOString();
            const newAuto: Automation = {
                id: `auto-${Date.now()}`,
                workspaceId: "ws-main",
                scopeType: input.scopeType ?? "list",
                scopeId: input.scopeId ?? "l-fb-orders",
                name: input.name,
                description: input.description,
                isActive: false,
                trigger: input.trigger ?? {
                    type: "task_created",
                    config: {},
                },
                conditions: input.conditions ?? { logic: "AND", rules: [] },
                actions: input.actions ?? [],
                lastRunAt: null,
                runCount: 0,
                createdBy: currentUser?.id ?? "u-001",
                createdAt: now,
                updatedAt: now,
            };
            automations.unshift(newAuto);
            automationsById.set(newAuto.id, newAuto);
            return newAuto;
        },
        async update(
            id: string,
            patch: Partial<Automation>,
        ): Promise<Automation> {
            await delay();
            log("PATCH /automations/:id", { id });
            const idx = automations.findIndex((a) => a.id === id);
            if (idx < 0) throw new Error("Automation not found");
            automations[idx] = {
                ...automations[idx],
                ...patch,
                updatedAt: new Date().toISOString(),
            };
            automationsById.set(id, automations[idx]);
            return automations[idx];
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = automations.findIndex((a) => a.id === id);
            if (idx >= 0) {
                automations.splice(idx, 1);
                automationsById.delete(id);
            }
        },
        async runs(automationId: string): Promise<AutomationRun[]> {
            await delay(50, 150);
            return runsByAutomation(automationId);
        },
        async allRuns(): Promise<AutomationRun[]> {
            await delay(50, 150);
            return [...automationRuns].sort(
                (a, b) =>
                    new Date(b.startedAt).getTime() -
                    new Date(a.startedAt).getTime(),
            );
        },
        async test(id: string): Promise<AutomationRun> {
            await delay(200, 500);
            log("POST /automations/:id/test", { id });
            const auto = automationsById.get(id);
            if (!auto) throw new Error("Automation not found");
            const now = new Date().toISOString();
            const durationMs = 150 + Math.floor(Math.random() * 300);
            const run: AutomationRun = {
                id: `run-test-${Date.now()}`,
                automationId: id,
                triggerEvent: {
                    type: auto.trigger.type,
                    simulated: true,
                },
                status: "success",
                actionsLog: auto.actions.map((a) => ({
                    actionType: a.type,
                    status: "success",
                    message: `Simulated: ${a.type.replace(/_/g, " ")} executed`,
                    durationMs: Math.floor(
                        durationMs / Math.max(1, auto.actions.length),
                    ),
                })),
                durationMs,
                startedAt: now,
                finishedAt: now,
            };
            automationRuns.unshift(run);
            return run;
        },
    },

    templates: {
        async list(): Promise<Template[]> {
            await delay();
            return templates;
        },
        async byType(type: Template["type"]): Promise<Template[]> {
            await delay(50, 150);
            return templatesByType(type);
        },
        async getById(id: string): Promise<Template | null> {
            await delay(50, 100);
            return templatesById.get(id) ?? null;
        },
        async apply(
            templateId: string,
            input: {
                name?: string;
                taskName?: string;
                listId?: string;
                spaceId?: string;
                /** ISO date — earliest template date will line up with this. */
                anchorDate?: string;
            },
        ): Promise<{
            entityId: string;
            entityType: string;
            message: string;
        }> {
            await delay();
            log("POST /templates/:id/apply", { templateId, input });
            const tpl = templatesById.get(templateId);
            if (!tpl) throw new Error("Template not found");
            tpl.usageCount += 1;
            const displayName =
                input.taskName ?? input.name ?? tpl.name;
            if (tpl.type === "task" && input.listId) {
                const taskNumber =
                    Math.floor(Math.random() * 100000) + 5000;
                const newTask: Task = {
                    id: `t-${taskNumber}`,
                    taskNumber,
                    name: displayName,
                    statusId:
                        statusesByList(input.listId)[0]?.id ?? "unknown",
                    priority: 3,
                    taskTypeId:
                        (tpl.structure?.taskTypeId as string) ?? "tt-task",
                    primaryListId: input.listId,
                    parentTaskId: null,
                    isMilestone: false,
                    startDate: null,
                    dueDate: null,
                    timeEstimateSeconds: null,
                    timeTrackedSeconds: 0,
                    assignees: [],
                    watchers: [],
                    tags: [],
                    customFields: {},
                    subtasksCount: 0,
                    subtasksCompleted: 0,
                    commentsCount: 0,
                    attachmentsCount: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: currentUser?.id ?? "u-001",
                    completedAt: null,
                    archivedAt: null,
                    nestingDepth: 0,
                };
                tasks.unshift(newTask);
                return {
                    entityId: newTask.id,
                    entityType: "task",
                    message: `Task “${displayName}” created from template`,
                };
            }
            return {
                entityId: tpl.id,
                entityType: tpl.type,
                message: `Template “${tpl.name}” applied`,
            };
        },
    },

    activity: {
        async recent(limit = 10): Promise<ActivityLogEntry[]> {
            await delay(50, 150);
            return recentActivity(limit);
        },
        async byTask(taskId: string): Promise<ActivityLogEntry[]> {
            await delay(50, 150);
            return activityLog
                .filter(
                    (a) => a.entityType === "task" && a.entityId === taskId,
                )
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },
        async filtered(filters: {
            listId?: string;
            actorId?: string;
            action?: string;
            sinceDate?: string;
            limit?: number;
            offset?: number;
        }): Promise<{
            data: ActivityLogEntry[];
            total: number;
            hasMore: boolean;
        }> {
            await delay();
            const since = filters.sinceDate
                ? new Date(filters.sinceDate)
                : undefined;
            const all = (await import("../mocks/activity")).filterActivity({
                listId: filters.listId,
                actorId: filters.actorId,
                action: filters.action,
                sinceDate: since,
            });
            const offset = filters.offset ?? 0;
            const limit = filters.limit ?? 50;
            const data = all.slice(offset, offset + limit);
            return { data, total: all.length, hasMore: offset + limit < all.length };
        },
    },

    dashboards: {
        async list(): Promise<Dashboard[]> {
            await delay();
            return [...dashboards].sort((a, b) => {
                if (a.isFavorite !== b.isFavorite) {
                    return a.isFavorite ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
        },
        async getById(id: string): Promise<Dashboard | null> {
            await delay(50, 150);
            return dashboardsById.get(id) ?? null;
        },
        async create(
            input: Pick<
                Dashboard,
                "name" | "icon" | "color" | "scope" | "sharing"
            > &
                Partial<Pick<Dashboard, "description" | "widgets">>,
        ): Promise<Dashboard> {
            await delay();
            const id = `dash-${fakeId()}`;
            const dashboard: Dashboard = {
                id,
                workspaceId: workspace.id,
                name: input.name,
                icon: input.icon,
                color: input.color,
                description: input.description,
                scope: input.scope,
                sharing: input.sharing,
                widgets: input.widgets ?? [],
                createdBy: currentUser?.id ?? "u-001",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isFavorite: false,
            };
            dashboards.push(dashboard);
            dashboardsById.set(id, dashboard);
            log("POST /dashboards", dashboard);
            return dashboard;
        },
        async update(
            id: string,
            patch: Partial<Omit<Dashboard, "id" | "workspaceId" | "createdAt" | "createdBy">>,
        ): Promise<Dashboard> {
            await delay();
            const existing = dashboardsById.get(id);
            if (!existing) throw new Error("Dashboard not found");
            Object.assign(existing, patch, {
                updatedAt: new Date().toISOString(),
            });
            log("PATCH /dashboards/:id", { id, patch });
            return existing;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = dashboards.findIndex((d) => d.id === id);
            if (idx >= 0) dashboards.splice(idx, 1);
            dashboardsById.delete(id);
            log("DELETE /dashboards/:id", id);
        },
        async duplicate(id: string): Promise<Dashboard> {
            await delay();
            const existing = dashboardsById.get(id);
            if (!existing) throw new Error("Dashboard not found");
            const newId = `dash-${fakeId()}`;
            const copy: Dashboard = {
                ...existing,
                id: newId,
                name: `${existing.name} (copy)`,
                widgets: existing.widgets.map((w, i) => ({
                    ...w,
                    id: `w-${newId}-${i}`,
                })),
                isFavorite: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            dashboards.push(copy);
            dashboardsById.set(newId, copy);
            log("POST /dashboards/:id/duplicate", copy);
            return copy;
        },
        async addWidget(
            dashboardId: string,
            widget: Omit<DashboardWidget, "id">,
        ): Promise<Dashboard> {
            await delay();
            const dash = dashboardsById.get(dashboardId);
            if (!dash) throw new Error("Dashboard not found");
            const id = `w-${fakeId()}`;
            dash.widgets.push({ ...widget, id });
            dash.updatedAt = new Date().toISOString();
            log("POST /dashboards/:id/widgets", { dashboardId, widget });
            return dash;
        },
        async updateWidget(
            dashboardId: string,
            widgetId: string,
            patch: Partial<DashboardWidget>,
        ): Promise<Dashboard> {
            await delay();
            const dash = dashboardsById.get(dashboardId);
            if (!dash) throw new Error("Dashboard not found");
            const idx = dash.widgets.findIndex((w) => w.id === widgetId);
            if (idx < 0) throw new Error("Widget not found");
            dash.widgets[idx] = { ...dash.widgets[idx], ...patch };
            dash.updatedAt = new Date().toISOString();
            log("PATCH /dashboards/:id/widgets/:wid", {
                dashboardId,
                widgetId,
                patch,
            });
            return dash;
        },
        async removeWidget(
            dashboardId: string,
            widgetId: string,
        ): Promise<Dashboard> {
            await delay();
            const dash = dashboardsById.get(dashboardId);
            if (!dash) throw new Error("Dashboard not found");
            dash.widgets = dash.widgets.filter((w) => w.id !== widgetId);
            dash.updatedAt = new Date().toISOString();
            log("DELETE /dashboards/:id/widgets/:wid", {
                dashboardId,
                widgetId,
            });
            return dash;
        },
        async reorderWidgets(
            dashboardId: string,
            widgetIds: string[],
        ): Promise<Dashboard> {
            await delay(50, 150);
            const dash = dashboardsById.get(dashboardId);
            if (!dash) throw new Error("Dashboard not found");
            const map = new Map(dash.widgets.map((w) => [w.id, w]));
            dash.widgets = widgetIds
                .map((id) => map.get(id))
                .filter((w): w is DashboardWidget => !!w);
            dash.updatedAt = new Date().toISOString();
            return dash;
        },
    },

    integrations: {
        async list(): Promise<Integration[]> {
            await delay(50, 150);
            return integrations;
        },
        async connect(
            id: string,
            meta?: Record<string, string>,
        ): Promise<Integration> {
            await delay(300, 600);
            const i = integrationsById.get(id);
            if (!i) throw new Error("Integration not found");
            i.isConnected = true;
            i.connectedAt = new Date().toISOString();
            i.connectedBy = currentUser?.id ?? "u-001";
            if (meta) i.meta = { ...(i.meta ?? {}), ...meta };
            log("POST /integrations/:id/connect", { id, meta });
            return i;
        },
        async disconnect(id: string): Promise<Integration> {
            await delay();
            const i = integrationsById.get(id);
            if (!i) throw new Error("Integration not found");
            i.isConnected = false;
            i.connectedAt = undefined;
            i.connectedBy = undefined;
            i.meta = undefined;
            log("POST /integrations/:id/disconnect", { id });
            return i;
        },
    },

    webhooks: {
        async list(): Promise<Webhook[]> {
            await delay();
            return webhooks;
        },
        async create(
            input: Pick<Webhook, "name" | "url" | "events" | "isActive">,
        ): Promise<Webhook> {
            await delay();
            const hook: Webhook = {
                id: `wh-${fakeId().slice(0, 8)}`,
                workspaceId: workspace.id,
                ...input,
                secret: `whsec_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`,
                createdBy: currentUser?.id ?? "u-001",
                createdAt: new Date().toISOString(),
                lastTriggeredAt: null,
                deliveryCount: 0,
                failureCount: 0,
            };
            webhooks.push(hook);
            webhooksById.set(hook.id, hook);
            log("POST /webhooks", hook);
            return hook;
        },
        async update(
            id: string,
            patch: Partial<Pick<Webhook, "name" | "url" | "events" | "isActive">>,
        ): Promise<Webhook> {
            await delay();
            const w = webhooksById.get(id);
            if (!w) throw new Error("Webhook not found");
            Object.assign(w, patch);
            log("PATCH /webhooks/:id", { id, patch });
            return w;
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = webhooks.findIndex((w) => w.id === id);
            if (idx >= 0) webhooks.splice(idx, 1);
            webhooksById.delete(id);
            log("DELETE /webhooks/:id", { id });
        },
        async regenerateSecret(id: string): Promise<Webhook> {
            await delay();
            const w = webhooksById.get(id);
            if (!w) throw new Error("Webhook not found");
            w.secret = `whsec_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
            log("POST /webhooks/:id/regenerate-secret", { id });
            return w;
        },
        async test(id: string): Promise<{
            status: "success" | "failure";
            durationMs: number;
        }> {
            await delay(400, 800);
            const w = webhooksById.get(id);
            if (!w) throw new Error("Webhook not found");
            const status = Math.random() > 0.15 ? "success" : "failure";
            w.lastTriggeredAt = new Date().toISOString();
            w.deliveryCount += 1;
            if (status === "failure") w.failureCount += 1;
            log("POST /webhooks/:id/test", { id, status });
            return { status, durationMs: 200 + Math.floor(Math.random() * 600) };
        },
    },

    apiKeys: {
        async list(): Promise<ApiKey[]> {
            await delay();
            return apiKeys;
        },
        async create(input: {
            name: string;
            scopes: ApiScope[];
            expiresInDays?: number;
        }): Promise<{ key: ApiKey; fullSecret: string }> {
            await delay();
            const fullSecret = `sk_live_${Math.random()
                .toString(36)
                .slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
            const key: ApiKey = {
                id: `ak-${fakeId().slice(0, 8)}`,
                workspaceId: workspace.id,
                name: input.name,
                last4: fullSecret.slice(-4),
                scopes: input.scopes,
                createdBy: currentUser?.id ?? "u-001",
                createdAt: new Date().toISOString(),
                lastUsedAt: null,
                expiresAt:
                    input.expiresInDays != null
                        ? new Date(
                              Date.now() +
                                  input.expiresInDays * 24 * 60 * 60 * 1000,
                          ).toISOString()
                        : null,
            };
            apiKeys.push(key);
            apiKeysById.set(key.id, key);
            log("POST /api-keys", { name: input.name });
            return { key, fullSecret };
        },
        async delete(id: string): Promise<void> {
            await delay();
            const idx = apiKeys.findIndex((k) => k.id === id);
            if (idx >= 0) apiKeys.splice(idx, 1);
            apiKeysById.delete(id);
            log("DELETE /api-keys/:id", { id });
        },
    },

    notificationPreferences: {
        async get(userId: string): Promise<NotificationPreferences> {
            await delay(50, 150);
            return getNotificationPreferences(userId);
        },
        async update(
            userId: string,
            patch: Partial<NotificationPreferences>,
        ): Promise<NotificationPreferences> {
            await delay();
            const prefs = getNotificationPreferences(userId);
            const merged: NotificationPreferences = {
                ...prefs,
                ...patch,
                channels: { ...prefs.channels, ...(patch.channels ?? {}) },
                events: { ...prefs.events, ...(patch.events ?? {}) },
                quietHours: {
                    ...prefs.quietHours,
                    ...(patch.quietHours ?? {}),
                },
            };
            notificationPreferencesByUser.set(userId, merged);
            log("PATCH /notification-prefs", { userId, patch });
            return merged;
        },
    },

    roles: {
        async list(): Promise<RoleDefinition[]> {
            await delay(50, 150);
            return roleDefinitions;
        },
    },

    sessions: {
        async list(userId: string): Promise<ActiveSession[]> {
            await delay(50, 150);
            return activeSessions.filter((s) => s.userId === userId);
        },
        async revoke(sessionId: string): Promise<void> {
            await delay();
            const idx = activeSessions.findIndex((s) => s.id === sessionId);
            if (idx >= 0 && !activeSessions[idx].isCurrent) {
                activeSessions.splice(idx, 1);
            }
            log("DELETE /sessions/:id", { sessionId });
        },
        async revokeAllOthers(userId: string): Promise<void> {
            await delay();
            for (let i = activeSessions.length - 1; i >= 0; i--) {
                const s = activeSessions[i];
                if (s.userId === userId && !s.isCurrent) {
                    activeSessions.splice(i, 1);
                }
            }
            log("POST /sessions/revoke-others", { userId });
        },
    },
};

export type MockApi = typeof mockApi;
