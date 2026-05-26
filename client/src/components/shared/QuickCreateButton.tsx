import { Dropdown } from "antd";
import { Plus, CheckSquare, FileText, Calendar, ListChecks } from "lucide-react";
import { tokens } from "../../theme";

export const QuickCreateButton = () => {
    const items = [
        {
            key: "task",
            label: "New Task",
            icon: <CheckSquare size={14} strokeWidth={1.75} />,
        },
        {
            key: "list",
            label: "New List",
            icon: <ListChecks size={14} strokeWidth={1.75} />,
        },
        {
            key: "doc",
            label: "New Doc",
            icon: <FileText size={14} strokeWidth={1.75} />,
        },
        {
            key: "reminder",
            label: "New Reminder",
            icon: <Calendar size={14} strokeWidth={1.75} />,
        },
    ];

    return (
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
                    (e.currentTarget.style.background = tokens.colors.primary)
                }
                title="Quick create"
            >
                <Plus size={16} strokeWidth={2} />
            </button>
        </Dropdown>
    );
};
