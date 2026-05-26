import axios from "axios";
import { useAuthStore } from "../stores/auth";

/**
 * Real backend HTTP client.
 *
 * NOT USED IN PHASE 1 — all data flows through src/lib/mock-api.ts during
 * the mock-first build (Phases 1–12). This file is here for the backend
 * integration phase that happens after the UI is approved.
 */

export const api = axios.create({
    baseURL: import.meta.env.VITE_BACKEND_API_URL,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
    },
});

const refreshToken = async () => {
    await axios.post(
        `${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`,
        {},
        { withCredentials: true },
    );
};

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401) {
            try {
                const headers = { ...originalRequest.headers };
                await refreshToken();
                return api.request({ ...originalRequest, headers });
            } catch (refreshErr) {
                console.warn("Error refreshing access token");
                useAuthStore.getState().logout();
                return Promise.reject(refreshErr);
            }
        }
        return Promise.reject(error);
    },
);
