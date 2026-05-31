import { useState } from "react";
import { Modal, Input, Select, App as AntApp } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { spacesApi, listsApi } from "../../http/api";
import { tokens } from "../../theme";
import type { List } from "../../types";

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

interface Props {
    /** If set, locks the list to this space. Otherwise user picks. */
    defaultSpaceId?: string;
    onClose: () => void;
    onCreated?: (list: List) => void;
}

export const CreateListModal = ({
    defaultSpaceId,
    onClose,
    onCreated,
}: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState("");
    const [spaceId, setSpaceId] = useState<string | undefined>(defaultSpaceId);
    const [color, setColor] = useState(COLORS[0]);

    const { data: spaces = [] } = useQuery({
        queryKey: ["spaces"],
        queryFn: () => spacesApi.list(),
        enabled: !defaultSpaceId,
    });

    const create = useMutation({
        mutationFn: () =>
            spaceId
                ? listsApi.create({
                      spaceId,
                      name: name.trim(),
                      color,
                  })
                : Promise.reject(new Error("Pick a space")),
        onSuccess: (l) => {
            qc.invalidateQueries({ queryKey: ["lists"] });
            message.success(`List "${l.name}" created`);
            onCreated?.(l);
            onClose();
        },
        onError: (err) =>
            message.error(
                err instanceof Error ? err.message : "Failed to create list",
            ),
    });

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Create list"
            okButtonProps={{
                disabled: !name.trim() || !spaceId,
                loading: create.isPending,
            }}
            title="New list"
            width={460}
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
                        placeholder="e.g. Sprint backlog"
                        autoFocus
                    />
                </div>
                {!defaultSpaceId && (
                    <div>
                        <Label>Space</Label>
                        <Select
                            value={spaceId}
                            onChange={setSpaceId}
                            style={{ width: "100%" }}
                            placeholder="Pick a space"
                            options={spaces.map((s) => ({
                                value: s.id,
                                label: s.name,
                            }))}
                        />
                    </div>
                )}
                <div>
                    <Label>Color</Label>
                    <div style={{ display: "flex", gap: 6 }}>
                        {COLORS.map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                aria-label={`Color ${c}`}
                                style={{
                                    width: 26,
                                    height: 26,
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
