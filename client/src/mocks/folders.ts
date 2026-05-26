import type { Folder } from "../types";

export const folders: Folder[] = [
    {
        id: "f-order-mgmt",
        spaceId: "sp-ops",
        parentFolderId: null,
        name: "Order Management",
        position: 0,
        archivedAt: null,
    },
    {
        id: "f-q2-campaigns",
        spaceId: "sp-mkt",
        parentFolderId: null,
        name: "Q2 Campaigns",
        position: 0,
        archivedAt: null,
    },
];

export const foldersById = new Map(folders.map((f) => [f.id, f]));
