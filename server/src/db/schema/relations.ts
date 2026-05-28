// =============================================================================
// Drizzle Relations — declarative graph for the relational query API.
//
// These don't generate any DDL — they only inform Drizzle's `db.query.X.findMany(
// { with: { ... } })` API. The FK constraints themselves live on the table
// definitions in the other files in this directory.
// =============================================================================
import { relations } from "drizzle-orm";

import {
    workspaces,
    users,
    sessions,
    passwordResetTokens,
    invitations,
} from "./auth";
import { spaces, lists, statuses, taskTypes, tags } from "./hierarchy";
import { sprints, onCallShifts } from "./sprints";
import {
    tasks,
    taskAssignees,
    taskWatchers,
    taskTags,
    taskDependencies,
    taskActivity,
} from "./tasks";
import {
    comments,
    checklists,
    checklistItems,
    attachments,
} from "./task-content";
import {
    customFields,
    customFieldOptions,
    taskCustomFieldValues,
} from "./custom-fields";
import { forms, formFields, formSubmissions } from "./forms";
import { notifications } from "./notifications";
import { workspaceActivity } from "./audit";
import { templates } from "./templates";

// ─── workspaces ──────────────────────────────────────────────────────────────
export const workspacesRelations = relations(workspaces, ({ many }) => ({
    users: many(users),
    spaces: many(spaces),
    taskTypes: many(taskTypes),
    tags: many(tags),
    sprints: many(sprints),
    tasks: many(tasks),
    customFields: many(customFields),
    invitations: many(invitations),
    onCallShifts: many(onCallShifts),
    workspaceActivity: many(workspaceActivity),
    templates: many(templates),
}));

// ─── templates ───────────────────────────────────────────────────────────────
export const templatesRelations = relations(templates, ({ one }) => ({
    workspace: one(workspaces, {
        fields: [templates.workspaceId],
        references: [workspaces.id],
    }),
    createdByUser: one(users, {
        fields: [templates.createdBy],
        references: [users.id],
    }),
}));

// ─── users ───────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [users.workspaceId],
        references: [workspaces.id],
    }),
    sessions: many(sessions),
    passwordResetTokens: many(passwordResetTokens),
    createdSpaces: many(spaces, { relationName: "spaces_created_by" }),
    createdLists: many(lists, { relationName: "lists_created_by" }),
    createdTasks: many(tasks, { relationName: "tasks_created_by" }),
    reviewingTasks: many(tasks, { relationName: "tasks_reviewer" }),
    assignedTasks: many(taskAssignees),
    watchedTasks: many(taskWatchers),
    comments: many(comments),
    uploadedAttachments: many(attachments),
    notifications: many(notifications, { relationName: "notifications_user" }),
    sentInvitations: many(invitations, { relationName: "invitations_invited_by" }),
    onCallShifts: many(onCallShifts, { relationName: "on_call_engineer" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(
    passwordResetTokens,
    ({ one }) => ({
        user: one(users, {
            fields: [passwordResetTokens.userId],
            references: [users.id],
        }),
    }),
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
    workspace: one(workspaces, {
        fields: [invitations.workspaceId],
        references: [workspaces.id],
    }),
    invitedByUser: one(users, {
        fields: [invitations.invitedBy],
        references: [users.id],
        relationName: "invitations_invited_by",
    }),
    acceptedByUser: one(users, {
        fields: [invitations.acceptedBy],
        references: [users.id],
        relationName: "invitations_accepted_by",
    }),
}));

// ─── hierarchy ───────────────────────────────────────────────────────────────
export const spacesRelations = relations(spaces, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [spaces.workspaceId],
        references: [workspaces.id],
    }),
    createdByUser: one(users, {
        fields: [spaces.createdBy],
        references: [users.id],
        relationName: "spaces_created_by",
    }),
    lists: many(lists),
}));

export const listsRelations = relations(lists, ({ one, many }) => ({
    space: one(spaces, { fields: [lists.spaceId], references: [spaces.id] }),
    defaultTaskType: one(taskTypes, {
        fields: [lists.defaultTaskTypeId],
        references: [taskTypes.id],
    }),
    createdByUser: one(users, {
        fields: [lists.createdBy],
        references: [users.id],
        relationName: "lists_created_by",
    }),
    tasks: many(tasks),
    forms: many(forms),
}));

export const taskTypesRelations = relations(taskTypes, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [taskTypes.workspaceId],
        references: [workspaces.id],
    }),
    tasks: many(tasks),
}));

export const statusesRelations = relations(statuses, ({ many }) => ({
    // scope_id is polymorphic — application layer resolves.
    tasks: many(tasks),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [tags.workspaceId],
        references: [workspaces.id],
    }),
    taskTags: many(taskTags),
}));

// ─── sprints / on-call ───────────────────────────────────────────────────────
export const sprintsRelations = relations(sprints, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [sprints.workspaceId],
        references: [workspaces.id],
    }),
    tasks: many(tasks),
}));

export const onCallShiftsRelations = relations(onCallShifts, ({ one }) => ({
    workspace: one(workspaces, {
        fields: [onCallShifts.workspaceId],
        references: [workspaces.id],
    }),
    engineer: one(users, {
        fields: [onCallShifts.engineerId],
        references: [users.id],
        relationName: "on_call_engineer",
    }),
    createdByUser: one(users, {
        fields: [onCallShifts.createdBy],
        references: [users.id],
    }),
}));

// ─── tasks + content + dependencies ─────────────────────────────────────────
export const tasksRelations = relations(tasks, ({ one, many }) => ({
    workspace: one(workspaces, {
        fields: [tasks.workspaceId],
        references: [workspaces.id],
    }),
    primaryList: one(lists, {
        fields: [tasks.primaryListId],
        references: [lists.id],
    }),
    status: one(statuses, {
        fields: [tasks.statusId],
        references: [statuses.id],
    }),
    taskType: one(taskTypes, {
        fields: [tasks.taskTypeId],
        references: [taskTypes.id],
    }),
    parent: one(tasks, {
        fields: [tasks.parentTaskId],
        references: [tasks.id],
        relationName: "task_parent",
    }),
    subtasks: many(tasks, { relationName: "task_parent" }),
    sprint: one(sprints, {
        fields: [tasks.sprintId],
        references: [sprints.id],
    }),
    reviewer: one(users, {
        fields: [tasks.reviewerId],
        references: [users.id],
        relationName: "tasks_reviewer",
    }),
    createdByUser: one(users, {
        fields: [tasks.createdBy],
        references: [users.id],
        relationName: "tasks_created_by",
    }),
    assignees: many(taskAssignees),
    watchers: many(taskWatchers),
    taskTags: many(taskTags),
    comments: many(comments),
    checklists: many(checklists),
    attachments: many(attachments),
    activity: many(taskActivity),
    customFieldValues: many(taskCustomFieldValues),
    blocking: many(taskDependencies, { relationName: "dep_task" }),
    blockedBy: many(taskDependencies, { relationName: "dep_related" }),
    formSubmissions: many(formSubmissions),
}));

export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
    task: one(tasks, {
        fields: [taskAssignees.taskId],
        references: [tasks.id],
    }),
    user: one(users, {
        fields: [taskAssignees.userId],
        references: [users.id],
    }),
    assignedByUser: one(users, {
        fields: [taskAssignees.assignedBy],
        references: [users.id],
    }),
}));

export const taskWatchersRelations = relations(taskWatchers, ({ one }) => ({
    task: one(tasks, {
        fields: [taskWatchers.taskId],
        references: [tasks.id],
    }),
    user: one(users, {
        fields: [taskWatchers.userId],
        references: [users.id],
    }),
}));

export const taskTagsRelations = relations(taskTags, ({ one }) => ({
    task: one(tasks, { fields: [taskTags.taskId], references: [tasks.id] }),
    tag: one(tags, { fields: [taskTags.tagId], references: [tags.id] }),
}));

export const taskDependenciesRelations = relations(
    taskDependencies,
    ({ one }) => ({
        task: one(tasks, {
            fields: [taskDependencies.taskId],
            references: [tasks.id],
            relationName: "dep_task",
        }),
        relatedTask: one(tasks, {
            fields: [taskDependencies.relatedTaskId],
            references: [tasks.id],
            relationName: "dep_related",
        }),
        createdByUser: one(users, {
            fields: [taskDependencies.createdBy],
            references: [users.id],
        }),
    }),
);

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
    task: one(tasks, {
        fields: [taskActivity.taskId],
        references: [tasks.id],
    }),
    actor: one(users, {
        fields: [taskActivity.actorId],
        references: [users.id],
    }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
    task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
    parent: one(comments, {
        fields: [comments.parentCommentId],
        references: [comments.id],
        relationName: "comment_parent",
    }),
    replies: many(comments, { relationName: "comment_parent" }),
    author: one(users, {
        fields: [comments.authorId],
        references: [users.id],
    }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
    task: one(tasks, {
        fields: [checklists.taskId],
        references: [tasks.id],
    }),
    items: many(checklistItems),
}));

export const checklistItemsRelations = relations(
    checklistItems,
    ({ one, many }) => ({
        checklist: one(checklists, {
            fields: [checklistItems.checklistId],
            references: [checklists.id],
        }),
        parent: one(checklistItems, {
            fields: [checklistItems.parentItemId],
            references: [checklistItems.id],
            relationName: "checklist_item_parent",
        }),
        children: many(checklistItems, { relationName: "checklist_item_parent" }),
        assignee: one(users, {
            fields: [checklistItems.assigneeId],
            references: [users.id],
        }),
        completedByUser: one(users, {
            fields: [checklistItems.completedBy],
            references: [users.id],
        }),
    }),
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
    task: one(tasks, {
        fields: [attachments.taskId],
        references: [tasks.id],
    }),
    uploadedByUser: one(users, {
        fields: [attachments.uploadedBy],
        references: [users.id],
    }),
}));

// ─── custom fields ──────────────────────────────────────────────────────────
export const customFieldsRelations = relations(
    customFields,
    ({ one, many }) => ({
        workspace: one(workspaces, {
            fields: [customFields.workspaceId],
            references: [workspaces.id],
        }),
        createdByUser: one(users, {
            fields: [customFields.createdBy],
            references: [users.id],
        }),
        options: many(customFieldOptions),
        values: many(taskCustomFieldValues),
    }),
);

export const customFieldOptionsRelations = relations(
    customFieldOptions,
    ({ one }) => ({
        customField: one(customFields, {
            fields: [customFieldOptions.customFieldId],
            references: [customFields.id],
        }),
    }),
);

export const taskCustomFieldValuesRelations = relations(
    taskCustomFieldValues,
    ({ one }) => ({
        task: one(tasks, {
            fields: [taskCustomFieldValues.taskId],
            references: [tasks.id],
        }),
        customField: one(customFields, {
            fields: [taskCustomFieldValues.customFieldId],
            references: [customFields.id],
        }),
        updatedByUser: one(users, {
            fields: [taskCustomFieldValues.updatedBy],
            references: [users.id],
        }),
    }),
);

// ─── forms ──────────────────────────────────────────────────────────────────
export const formsRelations = relations(forms, ({ one, many }) => ({
    list: one(lists, { fields: [forms.listId], references: [lists.id] }),
    createdByUser: one(users, {
        fields: [forms.createdBy],
        references: [users.id],
    }),
    fields: many(formFields),
    submissions: many(formSubmissions),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
    form: one(forms, { fields: [formFields.formId], references: [forms.id] }),
}));

export const formSubmissionsRelations = relations(
    formSubmissions,
    ({ one }) => ({
        form: one(forms, {
            fields: [formSubmissions.formId],
            references: [forms.id],
        }),
        task: one(tasks, {
            fields: [formSubmissions.taskId],
            references: [tasks.id],
        }),
    }),
);

// ─── notifications + audit ──────────────────────────────────────────────────
export const notificationsRelations = relations(notifications, ({ one }) => ({
    user: one(users, {
        fields: [notifications.userId],
        references: [users.id],
        relationName: "notifications_user",
    }),
    actor: one(users, {
        fields: [notifications.actorId],
        references: [users.id],
    }),
}));

export const workspaceActivityRelations = relations(
    workspaceActivity,
    ({ one }) => ({
        workspace: one(workspaces, {
            fields: [workspaceActivity.workspaceId],
            references: [workspaces.id],
        }),
        actor: one(users, {
            fields: [workspaceActivity.actorId],
            references: [users.id],
        }),
    }),
);
