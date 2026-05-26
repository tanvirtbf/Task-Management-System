import { useState } from "react";
import { Dropdown, App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CheckSquare, FileText, Calendar, ListChecks } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { CreateTaskModal } from "./CreateTaskModal";
import { CreateListModal } from "./CreateListModal";
import { tokens } from "../../theme";

type ActiveModal = "task" | "list" | null;

export const QuickCreateButton = () => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const user = useAuthStore((s) => s.user);
    const [modal, setModal] = useState<ActiveModal>(null);

    const createNote = useMutation({
        mutationFn: () =>
            user
                ? mockApi.notes.create({
                      userId: user.id,
                      title: "Untitled note",
                  })
                : Promise.reject(new Error("Not signed in")),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notes", user?.id] });
            navigate("/notepad");
            message.success("New note ready");
        },
    });

    const items = [
        {
            key: "task",
            label: "New Task",
            icon: <CheckSquare size={14} strokeWidth={1.75} />,
            onClick: () => setModal("task"),
        },
        {
            key: "list",
            label: "New List",
            icon: <ListChecks size={14} strokeWidth={1.75} />,
            onClick: () => setModal("list"),
        },
        {
            key: "doc",
            label: "New Note",
            icon: <FileText size={14} strokeWidth={1.75} />,
            onClick: () => createNote.mutate(),
        },
        {
            key: "reminder",
            label: "New Reminder",
            icon: <Calendar size={14} strokeWidth={1.75} />,
            onClick: () => navigate("/reminders?new=1"),
        },
    ];

    return (
        <>
            <Dropdown
                menu={{ items }}
                trigger={["click"]}
                placement="bottomRight"
            >
                <button
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: tokens.radius.md,
                        background: tokens.colors.primary,
                        color: "#FFFFFF",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all var(--transition-base)",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.primaryHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.primary)
                    }
                    title="Quick create"
                    aria-label="Quick create"
                >
                    <Plus size={16} strokeWidth={2} />
                </button>
            </Dropdown>

            {modal === "task" && (
                <CreateTaskModal onClose={() => setModal(null)} />
            )}
            {modal === "list" && (
                <CreateListModal onClose={() => setModal(null)} />
            )}
        </>
    );
};
