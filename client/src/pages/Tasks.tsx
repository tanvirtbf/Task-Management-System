import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTasks } from "@/hooks/queries/use-tasks";
import {
    useCreateTask,
    useDeleteTask,
    useUpdateTask,
} from "@/hooks/mutations/use-task-mutations";
import { taskSchema, type TaskInput } from "@/lib/validation/task";
import {
    PRIORITY_LABELS,
    STATUS_LABELS,
    TASK_PRIORITIES,
    TASK_STATUSES,
    type TaskStatus,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@/types";

export function TasksPage() {
    const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
    const { data, isLoading } = useTasks(
        statusFilter ? { status: statusFilter } : {},
    );

    const createTask = useCreateTask();
    const deleteTask = useDeleteTask();

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<TaskInput>({
        resolver: zodResolver(taskSchema),
        defaultValues: { priority: "medium", status: "todo" },
    });

    const onSubmit = async (input: TaskInput) => {
        await createTask.mutateAsync({
            ...input,
            due_date: input.due_date || undefined,
            description: input.description || undefined,
        });
        reset({ priority: "medium", status: "todo", title: "", description: "" });
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-semibold">Tasks</h1>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">All statuses</option>
                        {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="rounded-lg border border-border bg-background">
                    {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
                    {!isLoading && data && data.data.length === 0 && (
                        <p className="p-4 text-sm text-muted-foreground">No tasks yet.</p>
                    )}
                    <ul className="divide-y divide-border">
                        {data?.data.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                onDelete={() => deleteTask.mutate(task.id)}
                            />
                        ))}
                    </ul>
                </div>
            </section>

            <aside className="rounded-lg border border-border bg-background p-4">
                <h2 className="font-medium">Create task</h2>
                <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
                    <div>
                        <label className="text-sm font-medium" htmlFor="title">
                            Title
                        </label>
                        <Input id="title" {...register("title")} />
                        {errors.title && (
                            <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
                        )}
                    </div>
                    <div>
                        <label className="text-sm font-medium" htmlFor="description">
                            Description
                        </label>
                        <textarea
                            id="description"
                            rows={3}
                            className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            {...register("description")}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium" htmlFor="status">
                                Status
                            </label>
                            <select
                                id="status"
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                {...register("status")}
                            >
                                {TASK_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                        {STATUS_LABELS[s]}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm font-medium" htmlFor="priority">
                                Priority
                            </label>
                            <select
                                id="priority"
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                {...register("priority")}
                            >
                                {TASK_PRIORITIES.map((p) => (
                                    <option key={p} value={p}>
                                        {PRIORITY_LABELS[p]}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm font-medium" htmlFor="due_date">
                            Due date
                        </label>
                        <Input id="due_date" type="datetime-local" {...register("due_date")} />
                    </div>

                    <Button type="submit" className="w-full" disabled={createTask.isPending}>
                        {createTask.isPending ? "Creating…" : "Create task"}
                    </Button>
                </form>
            </aside>
        </div>
    );
}

function TaskRow({ task, onDelete }: { task: Task; onDelete: () => void }) {
    const updateTask = useUpdateTask(task.id);

    return (
        <li className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
                <div className="font-medium">{task.title}</div>
                {task.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {task.description}
                    </div>
                )}
            </div>
            <select
                value={task.status}
                onChange={(e) =>
                    updateTask.mutate({ status: e.target.value as TaskStatus })
                }
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
                {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                    </option>
                ))}
            </select>
            <span className="text-xs text-muted-foreground">{PRIORITY_LABELS[task.priority]}</span>
            <Button variant="ghost" size="sm" onClick={onDelete}>
                Delete
            </Button>
        </li>
    );
}
