import { API_BASE } from "./constants";

export class ApiError extends Error {
    status: number;
    errors: Array<{ msg: string; path?: string }>;

    constructor(status: number, message: string, errors: Array<{ msg: string; path?: string }> = []) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, init);

    if (res.status === 204) return null as T;

    let payload: unknown = null;
    try {
        payload = await res.json();
    } catch {
        /* no body */
    }

    if (!res.ok) {
        const data = payload as { message?: string; errors?: Array<{ msg: string; path?: string }> } | null;
        throw new ApiError(
            res.status,
            data?.message || data?.errors?.[0]?.msg || res.statusText,
            data?.errors ?? [],
        );
    }

    return payload as T;
}

export const apiClient = {
    get: <T,>(path: string) => request<T>("GET", path),
    post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    del: <T,>(path: string) => request<T>("DELETE", path),
};
