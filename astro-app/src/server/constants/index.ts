export const Roles = {
    OWNER: "owner",
    ADMIN: "admin",
    MEMBER: "member",
    GUEST: "guest",
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];
