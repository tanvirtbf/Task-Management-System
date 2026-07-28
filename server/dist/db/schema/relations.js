"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceActivityRelations = exports.notificationsRelations = exports.formSubmissionsRelations = exports.formFieldsRelations = exports.formsRelations = exports.taskCustomFieldValuesRelations = exports.customFieldOptionsRelations = exports.customFieldsRelations = exports.attachmentsRelations = exports.checklistItemsRelations = exports.checklistsRelations = exports.commentsRelations = exports.taskActivityRelations = exports.taskDependenciesRelations = exports.taskTagsRelations = exports.taskWatchersRelations = exports.taskAssigneesRelations = exports.tasksRelations = exports.onCallShiftsRelations = exports.sprintsRelations = exports.tagsRelations = exports.statusesRelations = exports.taskTypesRelations = exports.listsRelations = exports.spacesRelations = exports.invitationsRelations = exports.passwordResetTokensRelations = exports.sessionsRelations = exports.usersRelations = exports.templatesRelations = exports.workspacesRelations = void 0;
// =============================================================================
// Drizzle Relations — declarative graph for the relational query API.
//
// These don't generate any DDL — they only inform Drizzle's `db.query.X.findMany(
// { with: { ... } })` API. The FK constraints themselves live on the table
// definitions in the other files in this directory.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const sprints_1 = require("./sprints");
const tasks_1 = require("./tasks");
const task_content_1 = require("./task-content");
const custom_fields_1 = require("./custom-fields");
const forms_1 = require("./forms");
const notifications_1 = require("./notifications");
const audit_1 = require("./audit");
const templates_1 = require("./templates");
// ─── workspaces ──────────────────────────────────────────────────────────────
exports.workspacesRelations = (0, drizzle_orm_1.relations)(auth_1.workspaces, ({ many }) => ({
    users: many(auth_1.users),
    spaces: many(hierarchy_1.spaces),
    taskTypes: many(hierarchy_1.taskTypes),
    tags: many(hierarchy_1.tags),
    sprints: many(sprints_1.sprints),
    tasks: many(tasks_1.tasks),
    customFields: many(custom_fields_1.customFields),
    invitations: many(auth_1.invitations),
    onCallShifts: many(sprints_1.onCallShifts),
    workspaceActivity: many(audit_1.workspaceActivity),
    templates: many(templates_1.templates),
}));
// ─── templates ───────────────────────────────────────────────────────────────
exports.templatesRelations = (0, drizzle_orm_1.relations)(templates_1.templates, ({ one }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [templates_1.templates.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    createdByUser: one(auth_1.users, {
        fields: [templates_1.templates.createdBy],
        references: [auth_1.users.id],
    }),
}));
// ─── users ───────────────────────────────────────────────────────────────────
exports.usersRelations = (0, drizzle_orm_1.relations)(auth_1.users, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [auth_1.users.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    sessions: many(auth_1.sessions),
    passwordResetTokens: many(auth_1.passwordResetTokens),
    createdSpaces: many(hierarchy_1.spaces, { relationName: "spaces_created_by" }),
    createdLists: many(hierarchy_1.lists, { relationName: "lists_created_by" }),
    createdTasks: many(tasks_1.tasks, { relationName: "tasks_created_by" }),
    reviewingTasks: many(tasks_1.tasks, { relationName: "tasks_reviewer" }),
    assignedTasks: many(tasks_1.taskAssignees),
    watchedTasks: many(tasks_1.taskWatchers),
    comments: many(task_content_1.comments),
    uploadedAttachments: many(task_content_1.attachments),
    notifications: many(notifications_1.notifications, { relationName: "notifications_user" }),
    sentInvitations: many(auth_1.invitations, { relationName: "invitations_invited_by" }),
    onCallShifts: many(sprints_1.onCallShifts, { relationName: "on_call_engineer" }),
}));
exports.sessionsRelations = (0, drizzle_orm_1.relations)(auth_1.sessions, ({ one }) => ({
    user: one(auth_1.users, { fields: [auth_1.sessions.userId], references: [auth_1.users.id] }),
}));
exports.passwordResetTokensRelations = (0, drizzle_orm_1.relations)(auth_1.passwordResetTokens, ({ one }) => ({
    user: one(auth_1.users, {
        fields: [auth_1.passwordResetTokens.userId],
        references: [auth_1.users.id],
    }),
}));
exports.invitationsRelations = (0, drizzle_orm_1.relations)(auth_1.invitations, ({ one }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [auth_1.invitations.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    invitedByUser: one(auth_1.users, {
        fields: [auth_1.invitations.invitedBy],
        references: [auth_1.users.id],
        relationName: "invitations_invited_by",
    }),
    acceptedByUser: one(auth_1.users, {
        fields: [auth_1.invitations.acceptedBy],
        references: [auth_1.users.id],
        relationName: "invitations_accepted_by",
    }),
}));
// ─── hierarchy ───────────────────────────────────────────────────────────────
exports.spacesRelations = (0, drizzle_orm_1.relations)(hierarchy_1.spaces, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [hierarchy_1.spaces.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    createdByUser: one(auth_1.users, {
        fields: [hierarchy_1.spaces.createdBy],
        references: [auth_1.users.id],
        relationName: "spaces_created_by",
    }),
    lists: many(hierarchy_1.lists),
}));
exports.listsRelations = (0, drizzle_orm_1.relations)(hierarchy_1.lists, ({ one, many }) => ({
    space: one(hierarchy_1.spaces, { fields: [hierarchy_1.lists.spaceId], references: [hierarchy_1.spaces.id] }),
    defaultTaskType: one(hierarchy_1.taskTypes, {
        fields: [hierarchy_1.lists.defaultTaskTypeId],
        references: [hierarchy_1.taskTypes.id],
    }),
    createdByUser: one(auth_1.users, {
        fields: [hierarchy_1.lists.createdBy],
        references: [auth_1.users.id],
        relationName: "lists_created_by",
    }),
    tasks: many(tasks_1.tasks),
    forms: many(forms_1.forms),
}));
exports.taskTypesRelations = (0, drizzle_orm_1.relations)(hierarchy_1.taskTypes, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [hierarchy_1.taskTypes.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    tasks: many(tasks_1.tasks),
}));
exports.statusesRelations = (0, drizzle_orm_1.relations)(hierarchy_1.statuses, ({ many }) => ({
    // scope_id is polymorphic — application layer resolves.
    tasks: many(tasks_1.tasks),
}));
exports.tagsRelations = (0, drizzle_orm_1.relations)(hierarchy_1.tags, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [hierarchy_1.tags.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    taskTags: many(tasks_1.taskTags),
}));
// ─── sprints / on-call ───────────────────────────────────────────────────────
exports.sprintsRelations = (0, drizzle_orm_1.relations)(sprints_1.sprints, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [sprints_1.sprints.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    tasks: many(tasks_1.tasks),
}));
exports.onCallShiftsRelations = (0, drizzle_orm_1.relations)(sprints_1.onCallShifts, ({ one }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [sprints_1.onCallShifts.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    engineer: one(auth_1.users, {
        fields: [sprints_1.onCallShifts.engineerId],
        references: [auth_1.users.id],
        relationName: "on_call_engineer",
    }),
    createdByUser: one(auth_1.users, {
        fields: [sprints_1.onCallShifts.createdBy],
        references: [auth_1.users.id],
    }),
}));
// ─── tasks + content + dependencies ─────────────────────────────────────────
exports.tasksRelations = (0, drizzle_orm_1.relations)(tasks_1.tasks, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [tasks_1.tasks.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    primaryList: one(hierarchy_1.lists, {
        fields: [tasks_1.tasks.primaryListId],
        references: [hierarchy_1.lists.id],
    }),
    status: one(hierarchy_1.statuses, {
        fields: [tasks_1.tasks.statusId],
        references: [hierarchy_1.statuses.id],
    }),
    taskType: one(hierarchy_1.taskTypes, {
        fields: [tasks_1.tasks.taskTypeId],
        references: [hierarchy_1.taskTypes.id],
    }),
    parent: one(tasks_1.tasks, {
        fields: [tasks_1.tasks.parentTaskId],
        references: [tasks_1.tasks.id],
        relationName: "task_parent",
    }),
    subtasks: many(tasks_1.tasks, { relationName: "task_parent" }),
    sprint: one(sprints_1.sprints, {
        fields: [tasks_1.tasks.sprintId],
        references: [sprints_1.sprints.id],
    }),
    reviewer: one(auth_1.users, {
        fields: [tasks_1.tasks.reviewerId],
        references: [auth_1.users.id],
        relationName: "tasks_reviewer",
    }),
    createdByUser: one(auth_1.users, {
        fields: [tasks_1.tasks.createdBy],
        references: [auth_1.users.id],
        relationName: "tasks_created_by",
    }),
    assignees: many(tasks_1.taskAssignees),
    watchers: many(tasks_1.taskWatchers),
    taskTags: many(tasks_1.taskTags),
    comments: many(task_content_1.comments),
    checklists: many(task_content_1.checklists),
    attachments: many(task_content_1.attachments),
    activity: many(tasks_1.taskActivity),
    customFieldValues: many(custom_fields_1.taskCustomFieldValues),
    blocking: many(tasks_1.taskDependencies, { relationName: "dep_task" }),
    blockedBy: many(tasks_1.taskDependencies, { relationName: "dep_related" }),
    formSubmissions: many(forms_1.formSubmissions),
}));
exports.taskAssigneesRelations = (0, drizzle_orm_1.relations)(tasks_1.taskAssignees, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [tasks_1.taskAssignees.taskId],
        references: [tasks_1.tasks.id],
    }),
    user: one(auth_1.users, {
        fields: [tasks_1.taskAssignees.userId],
        references: [auth_1.users.id],
    }),
    assignedByUser: one(auth_1.users, {
        fields: [tasks_1.taskAssignees.assignedBy],
        references: [auth_1.users.id],
    }),
}));
exports.taskWatchersRelations = (0, drizzle_orm_1.relations)(tasks_1.taskWatchers, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [tasks_1.taskWatchers.taskId],
        references: [tasks_1.tasks.id],
    }),
    user: one(auth_1.users, {
        fields: [tasks_1.taskWatchers.userId],
        references: [auth_1.users.id],
    }),
}));
exports.taskTagsRelations = (0, drizzle_orm_1.relations)(tasks_1.taskTags, ({ one }) => ({
    task: one(tasks_1.tasks, { fields: [tasks_1.taskTags.taskId], references: [tasks_1.tasks.id] }),
    tag: one(hierarchy_1.tags, { fields: [tasks_1.taskTags.tagId], references: [hierarchy_1.tags.id] }),
}));
exports.taskDependenciesRelations = (0, drizzle_orm_1.relations)(tasks_1.taskDependencies, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [tasks_1.taskDependencies.taskId],
        references: [tasks_1.tasks.id],
        relationName: "dep_task",
    }),
    relatedTask: one(tasks_1.tasks, {
        fields: [tasks_1.taskDependencies.relatedTaskId],
        references: [tasks_1.tasks.id],
        relationName: "dep_related",
    }),
    createdByUser: one(auth_1.users, {
        fields: [tasks_1.taskDependencies.createdBy],
        references: [auth_1.users.id],
    }),
}));
exports.taskActivityRelations = (0, drizzle_orm_1.relations)(tasks_1.taskActivity, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [tasks_1.taskActivity.taskId],
        references: [tasks_1.tasks.id],
    }),
    actor: one(auth_1.users, {
        fields: [tasks_1.taskActivity.actorId],
        references: [auth_1.users.id],
    }),
}));
exports.commentsRelations = (0, drizzle_orm_1.relations)(task_content_1.comments, ({ one, many }) => ({
    task: one(tasks_1.tasks, { fields: [task_content_1.comments.taskId], references: [tasks_1.tasks.id] }),
    parent: one(task_content_1.comments, {
        fields: [task_content_1.comments.parentCommentId],
        references: [task_content_1.comments.id],
        relationName: "comment_parent",
    }),
    replies: many(task_content_1.comments, { relationName: "comment_parent" }),
    author: one(auth_1.users, {
        fields: [task_content_1.comments.authorId],
        references: [auth_1.users.id],
    }),
}));
exports.checklistsRelations = (0, drizzle_orm_1.relations)(task_content_1.checklists, ({ one, many }) => ({
    task: one(tasks_1.tasks, {
        fields: [task_content_1.checklists.taskId],
        references: [tasks_1.tasks.id],
    }),
    items: many(task_content_1.checklistItems),
}));
exports.checklistItemsRelations = (0, drizzle_orm_1.relations)(task_content_1.checklistItems, ({ one, many }) => ({
    checklist: one(task_content_1.checklists, {
        fields: [task_content_1.checklistItems.checklistId],
        references: [task_content_1.checklists.id],
    }),
    parent: one(task_content_1.checklistItems, {
        fields: [task_content_1.checklistItems.parentItemId],
        references: [task_content_1.checklistItems.id],
        relationName: "checklist_item_parent",
    }),
    children: many(task_content_1.checklistItems, { relationName: "checklist_item_parent" }),
    assignee: one(auth_1.users, {
        fields: [task_content_1.checklistItems.assigneeId],
        references: [auth_1.users.id],
    }),
    completedByUser: one(auth_1.users, {
        fields: [task_content_1.checklistItems.completedBy],
        references: [auth_1.users.id],
    }),
}));
exports.attachmentsRelations = (0, drizzle_orm_1.relations)(task_content_1.attachments, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [task_content_1.attachments.taskId],
        references: [tasks_1.tasks.id],
    }),
    uploadedByUser: one(auth_1.users, {
        fields: [task_content_1.attachments.uploadedBy],
        references: [auth_1.users.id],
    }),
}));
// ─── custom fields ──────────────────────────────────────────────────────────
exports.customFieldsRelations = (0, drizzle_orm_1.relations)(custom_fields_1.customFields, ({ one, many }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [custom_fields_1.customFields.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    createdByUser: one(auth_1.users, {
        fields: [custom_fields_1.customFields.createdBy],
        references: [auth_1.users.id],
    }),
    options: many(custom_fields_1.customFieldOptions),
    values: many(custom_fields_1.taskCustomFieldValues),
}));
exports.customFieldOptionsRelations = (0, drizzle_orm_1.relations)(custom_fields_1.customFieldOptions, ({ one }) => ({
    customField: one(custom_fields_1.customFields, {
        fields: [custom_fields_1.customFieldOptions.customFieldId],
        references: [custom_fields_1.customFields.id],
    }),
}));
exports.taskCustomFieldValuesRelations = (0, drizzle_orm_1.relations)(custom_fields_1.taskCustomFieldValues, ({ one }) => ({
    task: one(tasks_1.tasks, {
        fields: [custom_fields_1.taskCustomFieldValues.taskId],
        references: [tasks_1.tasks.id],
    }),
    customField: one(custom_fields_1.customFields, {
        fields: [custom_fields_1.taskCustomFieldValues.customFieldId],
        references: [custom_fields_1.customFields.id],
    }),
    updatedByUser: one(auth_1.users, {
        fields: [custom_fields_1.taskCustomFieldValues.updatedBy],
        references: [auth_1.users.id],
    }),
}));
// ─── forms ──────────────────────────────────────────────────────────────────
exports.formsRelations = (0, drizzle_orm_1.relations)(forms_1.forms, ({ one, many }) => ({
    list: one(hierarchy_1.lists, { fields: [forms_1.forms.listId], references: [hierarchy_1.lists.id] }),
    createdByUser: one(auth_1.users, {
        fields: [forms_1.forms.createdBy],
        references: [auth_1.users.id],
    }),
    fields: many(forms_1.formFields),
    submissions: many(forms_1.formSubmissions),
}));
exports.formFieldsRelations = (0, drizzle_orm_1.relations)(forms_1.formFields, ({ one }) => ({
    form: one(forms_1.forms, { fields: [forms_1.formFields.formId], references: [forms_1.forms.id] }),
}));
exports.formSubmissionsRelations = (0, drizzle_orm_1.relations)(forms_1.formSubmissions, ({ one }) => ({
    form: one(forms_1.forms, {
        fields: [forms_1.formSubmissions.formId],
        references: [forms_1.forms.id],
    }),
    task: one(tasks_1.tasks, {
        fields: [forms_1.formSubmissions.taskId],
        references: [tasks_1.tasks.id],
    }),
}));
// ─── notifications + audit ──────────────────────────────────────────────────
exports.notificationsRelations = (0, drizzle_orm_1.relations)(notifications_1.notifications, ({ one }) => ({
    user: one(auth_1.users, {
        fields: [notifications_1.notifications.userId],
        references: [auth_1.users.id],
        relationName: "notifications_user",
    }),
    actor: one(auth_1.users, {
        fields: [notifications_1.notifications.actorId],
        references: [auth_1.users.id],
    }),
}));
exports.workspaceActivityRelations = (0, drizzle_orm_1.relations)(audit_1.workspaceActivity, ({ one }) => ({
    workspace: one(auth_1.workspaces, {
        fields: [audit_1.workspaceActivity.workspaceId],
        references: [auth_1.workspaces.id],
    }),
    actor: one(auth_1.users, {
        fields: [audit_1.workspaceActivity.actorId],
        references: [auth_1.users.id],
    }),
}));
