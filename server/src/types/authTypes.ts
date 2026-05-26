import { Request } from "express";

export interface AuthPayload {
    sub: string;
    role: "admin" | "member";
    email: string;
}

export interface AuthRequest extends Request {
    auth?: AuthPayload;
}

export interface RegisterBody {
    email: string;
    password: string;
    first_name: string;
    last_name?: string;
}

export interface LoginBody {
    email: string;
    password: string;
}
