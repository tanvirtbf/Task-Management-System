import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import createHttpError from "http-errors";
import { db, tasks } from "../db";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TaskPriority, TaskStatus } from "../constant";

interface ListOptions {
    userId: number;
    role: "admin" | "member";
    page?: number;
    perPage?: number;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: number;
}

interface CreateInput {
    title: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_date?: string | null;
    assignee_id?: number | null;
    creator_id: number;
}

interface UpdateInput {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_date?: string | null;
    assignee_id?: number | null;
}

export class TaskService {
    async list(opts: ListOptions) {
        const page = Math.max(1, opts.page ?? 1);
        const perPage = Math.min(MAX_PAGE_SIZE, opts.perPage ?? DEFAULT_PAGE_SIZE);
        const offset = (page - 1) * perPage;

        const conditions = [isNull(tasks.deleted_at)];

        if (opts.role !== "admin") {
            conditions.push(
                or(eq(tasks.creator_id, opts.userId), eq(tasks.assignee_id, opts.userId))!,
            );
        }

        if (opts.status) conditions.push(eq(tasks.status, opts.status));
        if (opts.priority) conditions.push(eq(tasks.priority, opts.priority));
        if (opts.assigneeId) conditions.push(eq(tasks.assignee_id, opts.assigneeId));

        const where = and(...conditions);

        const data = await db
            .select()
            .from(tasks)
            .where(where)
            .orderBy(desc(tasks.created_at))
            .limit(perPage)
            .offset(offset);

        const [{ count }] = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(tasks)
            .where(where);

        return {
            data,
            pagination: {
                page,
                perPage,
                total: Number(count),
                totalPages: Math.ceil(Number(count) / perPage),
            },
        };
    }

    async findOne(id: number, userId: number, role: "admin" | "member") {
        const [row] = await db
            .select()
            .from(tasks)
            .where(and(eq(tasks.id, id), isNull(tasks.deleted_at)))
            .limit(1);

        if (!row) throw createHttpError(404, "Task not found");

        if (role !== "admin" && row.creator_id !== userId && row.assignee_id !== userId) {
            throw createHttpError(403, "Forbidden");
        }

        return row;
    }

    async create(input: CreateInput) {
        const result = await db.insert(tasks).values({
            title: input.title,
            description: input.description ?? null,
            status: input.status ?? "todo",
            priority: input.priority ?? "medium",
            due_date: input.due_date ? new Date(input.due_date) : null,
            creator_id: input.creator_id,
            assignee_id: input.assignee_id ?? null,
        });

        const insertId =
            (result as unknown as { insertId: number }[])[0]?.insertId ??
            (result as unknown as { insertId: number }).insertId;

        const [row] = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, insertId as number))
            .limit(1);

        return row;
    }

    async update(id: number, userId: number, role: "admin" | "member", input: UpdateInput) {
        const existing = await this.findOne(id, userId, role);

        const patch: Record<string, unknown> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.status !== undefined) {
            patch.status = input.status;
            patch.completed_at = input.status === "done" ? new Date() : null;
        }
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.due_date !== undefined) {
            patch.due_date = input.due_date ? new Date(input.due_date) : null;
        }
        if (input.assignee_id !== undefined) patch.assignee_id = input.assignee_id;

        await db.update(tasks).set(patch).where(eq(tasks.id, existing.id));

        const [row] = await db.select().from(tasks).where(eq(tasks.id, existing.id)).limit(1);
        return row;
    }

    async remove(id: number, userId: number, role: "admin" | "member") {
        const existing = await this.findOne(id, userId, role);

        if (role !== "admin" && existing.creator_id !== userId) {
            throw createHttpError(403, "Only the creator or an admin can delete this task");
        }

        await db.update(tasks).set({ deleted_at: new Date() }).where(eq(tasks.id, existing.id));
    }
}
