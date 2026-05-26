import type { Credentials } from "../types";
import { api } from "./client";

/**
 * Real API endpoint functions.
 * NOT USED IN PHASE 1 — see http/client.ts header note.
 */

// Auth
export const login = (credentials: Credentials) =>
    api.post("/auth/login", credentials);

export const self = () => api.get("/auth/self");

export const logout = () => api.post("/auth/logout");

// Users
export const getUsers = () => api.get("/users");
