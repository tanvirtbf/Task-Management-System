import { useTasks } from "@/hooks/queries/use-tasks";
import { useAuth } from "@/providers/auth-provider";

export function DashboardPage() {
    const { user } = useAuth();
    const { data, isLoading } = useTasks({ perPage: 5 });

    const total = data?.pagination.total ?? 0;
    const todo = data?.data.filter((t) => t.status === "todo").length ?? 0;
    const inProgress = data?.data.filter((t) => t.status === "in_progress").length ?? 0;
    const done = data?.data.filter((t) => t.status === "done").length ?? 0;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Welcome, {user?.first_name}</h1>
                <p className="text-sm text-muted-foreground">Here's a quick overview of your work.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="Total" value={isLoading ? "…" : total} />
                <StatCard label="To Do" value={isLoading ? "…" : todo} />
                <StatCard label="In Progress" value={isLoading ? "…" : inProgress} />
                <StatCard label="Done" value={isLoading ? "…" : done} />
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
                <h2 className="font-medium">Recent tasks</h2>
                {isLoading && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
                {!isLoading && data && data.data.length === 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">No tasks yet.</p>
                )}
                <ul className="mt-3 divide-y divide-border">
                    {data?.data.map((t) => (
                        <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                            <span>{t.title}</span>
                            <span className="text-xs text-muted-foreground">{t.status}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-lg border border-border bg-background p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
    );
}
