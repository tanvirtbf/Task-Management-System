import { Request } from "express";
import type { Role } from "../constants";

// ─── User-side data shapes ──────────────────────────────────────────────────

export interface UserData {
    firstName: string;
    lastName: string;
    email: string;
    password: string; // plain text incoming; hashed before insert
    role: Role;
    workspaceId?: string;
}

export interface RegisterUserRequest extends Request {
    body: UserData;
}

export interface LoginRequest extends Request {
    body: { email: string; password: string };
}

export interface CreateUserRequest extends Request {
    body: UserData;
}

export interface LimitedUserData {
    firstName: string;
    lastName: string;
    role: Role;
}

export interface UpdateUserRequest extends Request {
    body: LimitedUserData;
}

// ─── Workspace-side data shapes ─────────────────────────────────────────────

export interface IWorkspace {
    name: string;
    logoUrl?: string | null;
    timezone?: string;
    defaultLocale?: string;
}

export interface CreateWorkspaceRequest extends Request {
    body: IWorkspace;
}

// ─── JWT / auth context ─────────────────────────────────────────────────────

export interface AuthRequest extends Request {
    auth: {
        sub: string; // user id (VARCHAR(64))
        role: Role;
        workspaceId: string;
        id?: string; // session id when refresh token is presented
    };
}

export type AuthCookie = {
    accessToken: string;
    refreshToken: string;
};

export interface IRefreshTokenPayload {
    id: string; // session id (VARCHAR(64))
}
