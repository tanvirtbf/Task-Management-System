import { useState } from "react";
import { Input, Button, Tag, App as AntApp, Tooltip } from "antd";
import { GitBranch, GitPullRequest, Copy, ExternalLink } from "lucide-react";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import type { Task } from "../../types";
import { tokens } from "../../theme";

/** Extract a default branch suggestion from a task ID + name. */
// Not exported: a non-component export in a component file defeats Fast
// Refresh (the whole module reloads instead of hot-swapping). Nothing outside
// this file uses it.
const suggestBranchName = (task: Task): string => {
    const id = task.customId ?? `T-${task.taskNumber}`;
    const slug = task.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .split("-")
        .slice(0, 5)
        .join("-");
    return `${id}-${slug}`;
};

const parsePrStatus = (url: string): Task["prStatus"] => {
    if (!url) return null;
    // Heuristic only — mock layer doesn't actually fetch.
    if (/draft/i.test(url)) return "draft";
    if (/closed/i.test(url)) return "closed";
    if (/merged/i.test(url)) return "merged";
    return "open";
};

interface Props {
    task: Task;
}

export const GitIntegrationPanel = ({ task }: Props) => {
    const update = useUpdateTask(task.primaryListId);
    const { message } = AntApp.useApp();
    const [branch, setBranch] = useState(
        task.branchName ?? suggestBranchName(task),
    );
    const [prUrl, setPrUrl] = useState(task.prUrl ?? "");

    const saveBranch = () => {
        update.mutate({ id: task.id, patch: { branchName: branch } });
    };
    const savePr = () => {
        update.mutate({
            id: task.id,
            patch: { prUrl, prStatus: parsePrStatus(prUrl) },
        });
    };

    const copy = (text: string) => {
        navigator.clipboard
            .writeText(text)
            .then(() => message.success("Copied"))
            .catch(() => message.error("Could not copy"));
    };

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[3],
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <GitBranch size={11} strokeWidth={1.75} />
                Git
            </div>

            <div>
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginBottom: 4,
                    }}
                >
                    Branch name
                </div>
                <Input
                    size="small"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    onBlur={saveBranch}
                    placeholder={suggestBranchName(task)}
                    style={{ fontFamily: tokens.typography.fontFamilyMono }}
                    suffix={
                        <Tooltip title="Copy git checkout command">
                            <button
                                onClick={() =>
                                    copy(`git checkout -b ${branch}`)
                                }
                                style={{
                                    background: "transparent",
                                    border: 0,
                                    padding: 0,
                                    cursor: "pointer",
                                    color: tokens.colors.textMuted,
                                    display: "inline-flex",
                                }}
                                aria-label="Copy"
                            >
                                <Copy size={12} strokeWidth={1.75} />
                            </button>
                        </Tooltip>
                    }
                />
            </div>

            <div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginBottom: 4,
                    }}
                >
                    Pull Request
                    {task.prStatus && (
                        <Tag
                            color={
                                task.prStatus === "merged"
                                    ? "purple"
                                    : task.prStatus === "closed"
                                      ? "red"
                                      : task.prStatus === "draft"
                                        ? "default"
                                        : "green"
                            }
                            style={{ margin: 0, fontSize: 10 }}
                        >
                            {task.prStatus.toUpperCase()}
                        </Tag>
                    )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <Input
                        size="small"
                        value={prUrl}
                        onChange={(e) => setPrUrl(e.target.value)}
                        onBlur={savePr}
                        placeholder="https://github.com/.../pull/123"
                        prefix={
                            <GitPullRequest
                                size={12}
                                strokeWidth={1.75}
                                color={tokens.colors.textMuted}
                            />
                        }
                    />
                    {task.prUrl && (
                        <Button
                            size="small"
                            icon={<ExternalLink size={12} strokeWidth={1.75} />}
                            onClick={() =>
                                window.open(task.prUrl ?? "", "_blank")
                            }
                        >
                            Open
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
