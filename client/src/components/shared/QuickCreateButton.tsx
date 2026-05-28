import { useState } from "react";
import { Dropdown } from "antd";
import { Plus, CheckSquare, ListChecks } from "lucide-react";
import { CreateTaskModal } from "./CreateTaskModal";
import { CreateListModal } from "./CreateListModal";
import { tokens } from "../../theme";

type ActiveModal = "task" | "list" | null;

export const QuickCreateButton = () => {
    const [modal, setModal] = useState<ActiveModal>(null);

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
