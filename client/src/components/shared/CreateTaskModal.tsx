import { useState } from "react";
import { Modal, Input, Select, DatePicker, App as AntApp } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { listsApi, tasksApi } from "../../http/api";
import { useAssignablePeople } from "../../hooks/useAssignablePeople";
import { useSpaceMap, useTaskTypes } from "../../hooks/useReferenceData";
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

    const spaceMap = useSpaceMap();
    const { data: taskTypes = [] } = useTaskTypes();
    const [taskTypeId, setTaskTypeId] = useState<string | undefined>(undefined);

    // Pick a default once the types load. No effect: the condition is
    // self-limiting — after the first render that sets it, `taskTypeId` is
    // truthy and this never runs again — so an effect only bought an extra
    // paint with an empty selector.
    if (!taskTypeId && taskTypes.length > 0) setTaskTypeId(taskTypes[0].id);

    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => listsApi.listAll(),
        enabled: !defaultListId,
    });
    // Active-only and teammates-first — same source as every other
    // assignment surface (useAssignablePeople).
    const { people } = useAssignablePeople();

    // Follow the caller's list when it changes (opening the modal from a
    // different list). Compared against the last value seen rather than run
    // in an effect, so the first render already shows the right list.
    const [seenDefaultList, setSeenDefaultList] = useState(defaultListId);
    if (seenDefaultList !== defaultListId) {
        setSeenDefaultList(defaultListId);
        if (defaultListId) setListId(defaultListId);
    }

    const create = useMutation({
        mutationFn: () => {
            if (!listId) return Promise.reject(new Error("Pick a list"));
            return tasksApi.create({
                name: name.trim(),
                primaryListId: listId,
                taskTypeId,
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
                                const sp = spaceMap.get(l.spaceId);
                                return {
                                    value: l.id,
                                    label: `${sp?.name} / ${l.name}`,
                                };
                            })}
                        />
                    </div>
                )}
                <div>
                    <Label>Type</Label>
                    <Select
                        value={taskTypeId}
                        onChange={setTaskTypeId}
                        style={{ width: "100%" }}
                        placeholder="Select a task type"
                        showSearch
                        optionFilterProp="label"
                        options={taskTypes.map((t) => ({
                            value: t.id,
                            label: t.name,
                        }))}
                    />
                </div>
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
                        options={people.map((u) => ({
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
