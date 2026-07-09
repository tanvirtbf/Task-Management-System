import type { User } from "../types";

/**
 * 12 dummy team members — realistic Bangladesh ecommerce company.
 *
 * Avatars use DiceBear (deterministic from seed) — no real photos, no external
 * fetch needed at build time (URLs resolve at runtime in browser).
 */

const avatarFor = (seed: string) =>
    `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(
        seed,
    )}&backgroundColor=eef2ff,fef3c7,ecfdf5,fff1f2,f0f9ff`;

export const users: User[] = [
    {
        id: "u-001",
        firstName: "Tanvir",
        lastName: "Rahman",
        email: "owner@company.local",
        role: "owner",
        avatarUrl: avatarFor("Tanvir Rahman"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-09-01T08:00:00Z",
        lastLoginAt: "2026-05-26T08:30:00Z",
    },
    {
        id: "u-002",
        firstName: "Saif",
        lastName: "Ahmed",
        email: "admin@company.local",
        role: "admin",
        avatarUrl: avatarFor("Saif Ahmed"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-09-05T10:00:00Z",
        lastLoginAt: "2026-05-26T09:15:00Z",
    },
    {
        id: "u-003",
        firstName: "Nadia",
        lastName: "Khan",
        email: "nadia@company.local",
        role: "admin",
        avatarUrl: avatarFor("Nadia Khan"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-10-01T10:00:00Z",
        lastLoginAt: "2026-05-26T07:45:00Z",
    },
    {
        id: "u-004",
        firstName: "Karim",
        lastName: "Hossain",
        email: "member@company.local",
        role: "member",
        avatarUrl: avatarFor("Karim Hossain"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-10-15T10:00:00Z",
        lastLoginAt: "2026-05-26T08:00:00Z",
    },
    {
        id: "u-005",
        firstName: "Rashida",
        lastName: "Begum",
        email: "rashida@company.local",
        role: "member",
        avatarUrl: avatarFor("Rashida Begum"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-11-01T10:00:00Z",
        lastLoginAt: "2026-05-25T18:00:00Z",
    },
    {
        id: "u-006",
        firstName: "Mahmud",
        lastName: "Chowdhury",
        email: "mahmud@company.local",
        role: "member",
        avatarUrl: avatarFor("Mahmud Chowdhury"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2024-11-10T10:00:00Z",
        lastLoginAt: "2026-05-26T07:00:00Z",
    },
    {
        id: "u-007",
        firstName: "Sumi",
        lastName: "Akter",
        email: "sumi@company.local",
        role: "member",
        avatarUrl: avatarFor("Sumi Akter"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-01-05T10:00:00Z",
        lastLoginAt: "2026-05-26T09:30:00Z",
    },
    {
        id: "u-008",
        firstName: "Habib",
        lastName: "Khan",
        email: "habib@company.local",
        role: "member",
        avatarUrl: avatarFor("Habib Khan"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-02-01T10:00:00Z",
        lastLoginAt: "2026-05-25T16:00:00Z",
    },
    {
        id: "u-009",
        firstName: "Asif",
        lastName: "Ali",
        email: "asif@company.local",
        role: "member",
        avatarUrl: avatarFor("Asif Ali"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-03-01T10:00:00Z",
        lastLoginAt: "2026-05-26T08:45:00Z",
    },
    {
        id: "u-010",
        firstName: "Mukti",
        lastName: "Sultana",
        email: "mukti@company.local",
        role: "member",
        avatarUrl: avatarFor("Mukti Sultana"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-03-15T10:00:00Z",
        lastLoginAt: "2026-05-26T09:00:00Z",
    },
    {
        id: "u-011",
        firstName: "Tania",
        lastName: "Rahman",
        email: "tania@company.local",
        role: "member",
        avatarUrl: avatarFor("Tania Rahman"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-04-01T10:00:00Z",
        lastLoginAt: "2026-05-26T08:15:00Z",
    },
    {
        id: "u-012",
        firstName: "Rifat",
        lastName: "Sheikh",
        email: "rifat-freelance@external.com",
        role: "guest",
        avatarUrl: avatarFor("Rifat Sheikh"),
        status: "active",
        timezone: "Asia/Dhaka",
        createdAt: "2025-05-01T10:00:00Z",
        lastLoginAt: "2026-05-24T14:00:00Z",
    },
];

// Quick lookup by email (used by mock auth)
export const usersByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

// Quick lookup by id
export const usersById = new Map(users.map((u) => [u.id, u]));

/**
 * Currently signed-in user for the mock app. Set by mock auth login.
 * (Tests/dev tooling can override this directly.)
 */
export let currentUser: User | null = null;
export const setCurrentUser = (u: User | null) => {
    currentUser = u;
};
