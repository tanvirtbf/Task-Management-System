import axios from "axios";
import { useAuthStore } from "../store";

// axios instance create
export const api = axios.create({
    baseURL: import.meta.env.VITE_BACKEND_API_URL,
    withCredentials: true, // cookies pass with every request
    headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
    },
});

const refreshToken = async () => {
    await axios.post(
        `${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`,
        {},
        {
            withCredentials: true,
        },
    );
}; // separate axios call to avoid interceptor recursion

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
                console.warn("Error while refreshing access token");
                useAuthStore.getState().logout();
                return Promise.reject(refreshErr);
            }
        }
        return Promise.reject(error);
    },
);
