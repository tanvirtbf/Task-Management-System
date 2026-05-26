import type { Credentials } from "../type";
import { api } from "./client";

// Auth Service
export const login = (credentials: Credentials) =>
    api.post("/auth/login", credentials);

export const self = () => api.get("/auth/self");

export const logout = () => api.post("/auth/logout");

// Users
export const getUsers = () => api.get("/users");
