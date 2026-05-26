import { useMemo, useState } from "react";
import {
    Button,
    Dropdown,
    Modal,
    Input,
    Popconfirm,
    App as AntApp,
} from "antd";
import { Bookmark, BookmarkPlus, ChevronDown, Trash2 } from "lucide-react";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";
import type { ViewConfig } from "../../types/view";

interface Props {
    listId: string;
    /** Current state to save when the user hits "Save view". */
    currentState: ViewConfig["state"];
    /** Applied when the user picks a saved view. */
    onApply: (state: ViewConfig["state"]) => void;
    /** Active view id (when applied), for highlighting. */
    activeViewId: string | null;
    onActiveViewChange: (id: string | null) => void;
}

export const SavedViewsBar = ({
    listId,
    currentState,
    onApply,
    activeViewId,
    onActiveViewChange,
}: Props) => {
    const { message } = AntApp.useApp();
    const savedViews = useUiStore((s) => s.savedViews);
    const saveView = useUiStore((s) => s.saveView);
    const deleteView = useUiStore((s) => s.deleteView);
    const [saveOpen, setSaveOpen] = useState(false);
    const [name, setName] = useState("");

    const views = useMemo(
        () => savedViews.filter((v) => v.listId === listId),
        [savedViews, listId],
    );

    const activeView = views.find((v) => v.id === activeViewId);

    const commitSave = () => {
        if (!name.trim()) return;
        const id = `vw-${Date.now()}`;
        saveView({
            id,
            listId,
            name: name.trim(),
            isShared: false,
            createdAt: new Date().toISOString(),
            state: currentState,
        });
        onActiveViewChange(id);
        message.success(`View "${name}" saved`);
        setSaveOpen(false);
        setName("");
    };

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: `${tokens.spacing[2]}px ${tokens.spacing[6]}px`,
                background: tokens.colors.bgPage,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                flexWrap: "wrap",
            }}
        >
            <span
                style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: tokens.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                }}
            >
                Views
            </span>
            <ViewChip
                label="Default"
                active={!activeViewId}
                onClick={() => onActiveViewChange(null)}
            />
            {views.map((v) => (
                <ViewChip
                    key={v.id}
                    label={v.name}
                    active={v.id === activeViewId}
                    onClick={() => {
                        onApply(v.state);
                        onActiveViewChange(v.id);
                    }}
                    onDelete={() => {
                        deleteView(v.id);
                        if (v.id === activeViewId) onActiveViewChange(null);
                        message.success("View deleted");
                    }}
                />
            ))}
            <div style={{ flex: 1 }} />
            <Dropdown
                menu={{
                    items: [
                        {
                            key: "save-new",
                            icon: (
                                <BookmarkPlus
                                    size={13}
                                    strokeWidth={1.75}
                                />
                            ),
                            label: "Save current view as…",
                            onClick: () => {
                                setName("");
                                setSaveOpen(true);
                            },
                        },
                        ...(activeView
                            ? [
                                  {
                                      key: "overwrite",
                                      icon: (
                                          <Bookmark
                                              size={13}
                                              strokeWidth={1.75}
                                          />
                                      ),
                                      label: `Update "${activeView.name}"`,
                                      onClick: () => {
                                          saveView({
                                              ...activeView,
                                              state: currentState,
                                          });
                                          message.success(
                                              `View "${activeView.name}" updated`,
                                          );
                                      },
                                  },
                              ]
                            : []),
                    ],
                }}
                trigger={["click"]}
            >
                <Button
                    size="small"
                    type="text"
                    icon={<Bookmark size={13} strokeWidth={1.75} />}
                >
                    Save view
                    <ChevronDown
                        size={11}
                        strokeWidth={2}
                        style={{ marginLeft: 4 }}
                    />
                </Button>
            </Dropdown>

            <Modal
                open={saveOpen}
                onCancel={() => setSaveOpen(false)}
                onOk={commitSave}
                title="Save current view"
                okText="Save"
                okButtonProps={{ disabled: !name.trim() }}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        paddingTop: 8,
                    }}
                >
                    <label
                        style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                        }}
                    >
                        View name
                    </label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My urgent items"
                        onPressEnter={commitSave}
                        autoFocus
                    />
                    <p
                        style={{
                            margin: 0,
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        Saves your current filter, sort, group, and Me Mode
                        settings.
                    </p>
                </div>
            </Modal>
        </div>
    );
};

const ViewChip = ({
    label,
    active,
    onClick,
    onDelete,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    onDelete?: () => void;
}) => (
    <div
        style={{
            display: "inline-flex",
            alignItems: "center",
            background: active ? tokens.colors.primary : tokens.colors.bgSurface,
            color: active ? "#fff" : tokens.colors.textPrimary,
            border: `1px solid ${active ? tokens.colors.primary : tokens.colors.border}`,
            borderRadius: tokens.radius.full,
            fontSize: 12,
            fontWeight: active ? 600 : 500,
        }}
    >
        <button
            onClick={onClick}
            style={{
                background: "transparent",
                border: 0,
                padding: "4px 10px",
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
            }}
        >
            {label}
        </button>
        {onDelete && (
            <Popconfirm
                title={`Delete "${label}" view?`}
                onConfirm={onDelete}
                okType="danger"
            >
                <button
                    aria-label="Delete view"
                    style={{
                        background: "transparent",
                        border: 0,
                        padding: "2px 6px 2px 0",
                        cursor: "pointer",
                        color: "inherit",
                        opacity: 0.6,
                        display: "inline-flex",
                        alignItems: "center",
                    }}
                >
                    <Trash2 size={11} strokeWidth={1.75} />
                </button>
            </Popconfirm>
        )}
    </div>
);
