import { useEffect, useState } from "react";
import { Modal, Input, Select, DatePicker, App as AntApp } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { mockApi } from "../../lib/mock-api";
import { spacesById } from "../../mocks/spaces";
import { tokens } from "../../theme";
import { PRIORITY_LABELS } from "../../types";
import type { Priority, Task } from "../../types";

interface Props {
    /** Pre-select a list. Otherwise the user picks one. */
    defaultListId?: string;
    onClose: () => void;
    onCreated?: (task: Task) => void;
}

export const CreateTaskModal = ({
    defaultListId,
    onClose,
    onCreated,
}: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState("");
    const [listId, setListId] = useState<string | undefined>(defaultListId);
    const [priority, setPriority] = useState<Priority>(3);
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [dueDate, setDueDate] = useState<dayjs.Dayjs | null>(null);

    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => mockApi.lists.listAll(),
        enabled: !defaultListId,
    });
    const { data: users = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => mockApi.users.list(),
    });

    useEffect(() => {
        if (defaultListId) setListId(defaultListId);
    }, [defaultListId]);

    const create = useMutation({
        mutationFn: () => {
            if (!listId) return Promise.reject(new Error("Pick a list"));
            return mockApi.tasks.create({
                name: name.trim(),
                primaryListId: listId,
                priority,
                assignees: assigneeIds,
                dueDate: dueDate ? dueDate.toISOString() : null,
            });
        },
        onSuccess: (t) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", t.primaryListId],
            });
            qc.invalidateQueries({ queryKey: ["my-work"] });
            message.success(`Created "${t.name}"`);
            onCreated?.(t);
            onClose();
        },
        onError: (err) =>
            message.error(
                err instanceof Error ? err.message : "Failed to create task",
            ),
    });

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Create task"
            okButtonProps={{
                disabled: !name.trim() || !listId,
                loading: create.isPending,
            }}
            title="New task"
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
                    <Label>Task name</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="What needs to get done?"
                        autoFocus
                        onPressEnter={() => create.mutate()}
                    />
                </div>
                {!defaultListId && (
                    <div>
                        <Label>List</Label>
                        <Select
                            value={listId}
                            onChange={setListId}
                            style={{ width: "100%" }}
                            placeholder="Pick a list"
                            showSearch
                            optionFilterProp="label"
                            options={lists.map((l) => {
                                const sp = spacesById.get(l.spaceId);
                                return {
                                    value: l.id,
                                    label: `${sp?.name} / ${l.name}`,
                                };
                            })}
                        />
                    </div>
                )}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                    }}
                >
                    <div>
                        <Label>Priority</Label>
                        <Select
                            value={priority}
                            onChange={setPriority}
                            style={{ width: "100%" }}
                            options={([1, 2, 3, 4, 0] as Priority[]).map(
                                (p) => ({
                                    value: p,
                                    label: PRIORITY_LABELS[p],
                                }),
                            )}
                        />
                    </div>
                    <div>
                        <Label>Due date</Label>
                        <DatePicker
                            value={dueDate}
                            onChange={setDueDate}
                            style={{ width: "100%" }}
                            format="MMM D, YYYY"
                            placeholder="Pick a date"
                        />
                    </div>
                </div>
                <div>
                    <Label>Assignees</Label>
                    <Select
                        mode="multiple"
                        value={assigneeIds}
                        onChange={setAssigneeIds}
                        style={{ width: "100%" }}
                        placeholder="Assign to..."
                        showSearch
                        optionFilterProp="label"
                        options={users
                            .filter((u) => u.status === "active")
                            .map((u) => ({
                                value: u.id,
                                label: `${u.firstName} ${u.lastName}`,
                            }))}
                    />
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
