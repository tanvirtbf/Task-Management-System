import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { List, Space, Status, Tag, TaskType, User, Workspace } from "../types";
import {
    listsApi,
    spacesApi,
    statusesApi,
    tagsApi,
    taskTypesApi,
    usersApi,
    workspaceApi,
} from "../http/api";

/**
 * Cache-backed reference-data hooks (FRONTEND_INTEGRATION_PLAN.md R8).
 *
 * Components that previously imported static mock lookup Maps synchronously
 * (`usersById`, `statusesById`/`statusesByList`, `listsById`, `spacesById`)
 * must use these instead — re-pointing mockApi alone would leave them rendering
 * stale mock data keyed by ids that don't exist in the real DB.
 */

export const useUsers = () =>
    useQuery<User[]>({ queryKey: ["users"], queryFn: () => usersApi.list() });

export const useUserMap = (): Map<string, User> => {
    const { data: users = [] } = useUsers();
    return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
};

export const useStatuses = (listId: string | undefined) =>
    useQuery<Status[]>({
        queryKey: ["statuses", listId],
        queryFn: () => statusesApi.byList(listId as string),
        enabled: !!listId,
    });

export const useStatusMap = (listId: string | undefined): Map<string, Status> => {
    const { data: statuses = [] } = useStatuses(listId);
    return useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
};

export const useSpaces = () =>
    useQuery<Space[]>({ queryKey: ["spaces"], queryFn: () => spacesApi.list() });

export const useLists = () =>
    useQuery<List[]>({ queryKey: ["lists"], queryFn: () => listsApi.listAll() });

export const useListMap = (): Map<string, List> => {
    const { data: lists = [] } = useLists();
    return useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
};

export const useSpaceMap = (): Map<string, Space> => {
    const { data: spaces = [] } = useSpaces();
    return useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
};

export const useWorkspace = () =>
    useQuery<Workspace>({
        queryKey: ["workspace"],
        queryFn: () => workspaceApi.get(),
    });

export const useTaskTypes = () =>
    useQuery<TaskType[]>({
        queryKey: ["task-types"],
        queryFn: () => taskTypesApi.list(),
    });

export const useTaskTypeMap = (): Map<string, TaskType> => {
    const { data = [] } = useTaskTypes();
    return useMemo(() => new Map(data.map((t) => [t.id, t])), [data]);
};

export const useTags = () =>
    useQuery<Tag[]>({ queryKey: ["tags"], queryFn: () => tagsApi.list() });

export const useTagMap = (): Map<string, Tag> => {
    const { data = [] } = useTags();
    return useMemo(() => new Map(data.map((t) => [t.id, t])), [data]);
};
