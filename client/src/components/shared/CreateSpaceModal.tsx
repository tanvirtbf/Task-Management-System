import { useState } from "react";
import { Modal, Input, Switch, App as AntApp } from "antd";
import { Lock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mockApi } from "../../lib/mock-api";
import { DynamicIcon } from "./DynamicIcon";
import { tokens } from "../../theme";
import type { Space } from "../../types";

const COLORS = [
    "#4F46E5",
    "#10B981",
    "#F59E0B",
    "#E11D48",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#64748B",
];

const ICONS = [
    "Folder",
    "Briefcase",
    "Building2",
    "Sparkles",
    "ShoppingCart",
    "Package",
    "Headphones",
    "Megaphone",
    "Target",
    "Rocket",
    "Hammer",
    "Heart",
];

interface Props {
    onClose: () => void;
    onCreated?: (space: Space) => void;
}

export const CreateSpaceModal = ({ onClose, onCreated }: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("Folder");
    const [color, setColor] = useState(COLORS[0]);
    const [isPrivate, setIsPrivate] = useState(false);

    const create = useMutation({
        mutationFn: () =>
            mockApi.spaces.create({
                name: name.trim(),
                description: description.trim() || undefined,
                icon,
                color,
                isPrivate,
            }),
        onSuccess: (s) => {
            qc.invalidateQueries({ queryKey: ["spaces"] });
            message.success(`Space "${s.name}" created`);
            onCreated?.(s);
            onClose();
        },
    });

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Create space"
            okButtonProps={{
                disabled: !name.trim(),
                loading: create.isPending,
            }}
            title="New space"
            width={520}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <div>
                    <Label>Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Marketing"
                        autoFocus
                    />
                </div>
                <div>
                    <Label>Description (optional)</Label>
                    <Input.TextArea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 3 }}
                        placeholder="What is this space for?"
                    />
                </div>
                <div>
                    <Label>Icon</Label>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
                            gap: 4,
                        }}
                    >
                        {ICONS.map((ic) => (
                            <button
                                key={ic}
                                onClick={() => setIcon(ic)}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: tokens.radius.sm,
                                    background:
                                        icon === ic
                                            ? `${color}1A`
                                            : tokens.colors.bgMuted,
                                    color:
                                        icon === ic
                                            ? color
                                            : tokens.colors.textSecondary,
                                    border:
                                        icon === ic
                                            ? `1px solid ${color}`
                                            : "1px solid transparent",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                                aria-label={`Icon ${ic}`}
                            >
                                <DynamicIcon name={ic} size={16} strokeWidth={1.75} />
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label>Color</Label>
                    <div style={{ display: "flex", gap: 6 }}>
                        {COLORS.map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                aria-label={`Color ${c}`}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    background: c,
                                    border:
                                        color === c
                                            ? `2px solid ${tokens.colors.textPrimary}`
                                            : "2px solid transparent",
                                    cursor: "pointer",
                                }}
                            />
                        ))}
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                    }}
                >
                    <Lock
                        size={16}
                        strokeWidth={1.75}
                        color={
                            isPrivate
                                ? tokens.colors.primary
                                : tokens.colors.textMuted
                        }
                    />
                    <div style={{ flex: 1 }}>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 600,
                            }}
                        >
                            Make private
                        </div>
                        <div
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Only Owners and Admins (and explicitly invited
                            members) will see this space.
                        </div>
                    </div>
                    <Switch checked={isPrivate} onChange={setIsPrivate} />
                </div>
            </div>
        </Modal>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);
