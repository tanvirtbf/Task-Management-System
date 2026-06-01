import axios, {
    AxiosError,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from "axios";
import { useAuthStore } from "../stores/auth";

/**
 * Per-request opt-out of the camelCase→snake_case body transform (R1). Set it on
 * payloads whose nested keys are verbatim camelCase on the wire — e.g. a
 * Template's `structure` blob, which the API reads as `taskTypeId`,
 * `checklistItems`, etc. (NOT snake). Without this, the recursive decamelize
 * would silently rename those keys and the structure would be dropped.
 */
declare module "axios" {
    interface AxiosRequestConfig {
        skipDecamelize?: boolean;
    }
}

/**
 * Real backend HTTP client + the shared integration adapter (P0 foundation).
 *
 * Responsibilities (see FRONTEND_INTEGRATION_PLAN.md §1):
 *   R1 — recursive snake_case→camelCase on every response, camelCase→snake_case
 *        on every request body + query params (so the FE keeps its camelCase
 *        types unchanged). `/home/kpis` is whitelisted OUT (already camelCase).
 *   R2 — `unwrapData()` helper for the `{data,pagination}` list envelope.
 *   R5 — in-memory `access_token` attached as `Authorization: Bearer`, and a
 *        401→refresh→retry interceptor that hits the full `/api/v1/auth/refresh`
 *        path (so the path-scoped `bb_refresh` cookie is sent), STORES the new
 *        token, de-dupes concurrent refreshes, and carries an `_retry` guard so
 *        a failed refresh cannot loop.
 *   R6 — `getApiError()`/`getApiErrorMessage()` read the `{error:{code,message,
 *        request_id}}` envelope for friendly UI messages.
 */

const BASE_URL: string = import.meta.env.VITE_BACKEND_API_URL;

// ─── case transforms ──────────────────────────────────────────────────────────
const toCamel = (s: string): string =>
    s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const toSnake = (s: string): string =>
    s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    Object.prototype.toString.call(v) === "[object Object]";

/**
 * Keys whose VALUE is an opaque, verbatim JSON blob — its inner keys are domain
 * data (snake_case on the wire) that must NOT be case-converted: the
 * custom-field-definition `config`, and a task's `custom_field_values` map
 * (keyed by field id; values are typed envelopes like `{ option_id }` /
 * `{ include_time }`). The key ITSELF is still converted; only recursion INTO the
 * value is skipped — both directions. Mirrors the request-side `skipDecamelize`
 * escape hatch used for `Template.structure`.
 */
const OPAQUE_VALUE_KEYS = new Set([
    "config",
    "custom_field_values",
    "customFieldValues",
]);

const transformKeys = (
    input: unknown,
    keyFn: (k: string) => string,
): unknown => {
    if (Array.isArray(input)) return input.map((v) => transformKeys(v, keyFn));
    if (isPlainObject(input)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input)) {
            out[keyFn(k)] = OPAQUE_VALUE_KEYS.has(k)
                ? v
                : transformKeys(v, keyFn);
        }
        return out;
    }
    return input;
};

export const camelizeKeys = (input: unknown): unknown =>
    transformKeys(input, toCamel);
export const decamelizeKeys = (input: unknown): unknown =>
    transformKeys(input, toSnake);

/**
 * Endpoints whose response body is ALREADY camelCase on the wire (a deliberate
 * backend exception) — skip the snake→camel pass for these.
 * NOTE: `Template.structure` is a verbatim-camelCase blob both ways. Responses
 * are safe (camelizing already-camel keys is a no-op); the REQUEST side opts out
 * of decamelize via the `skipDecamelize` config flag (see `templatesApi`).
 */
const SKIP_CAMELIZE_URLS = ["/home/kpis"];

// ─── axios instance ───────────────────────────────────────────────────────────
export const api = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
    },
});

// Request: attach Bearer + decamelize outgoing body & params.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (
        !config.skipDecamelize &&
        config.data !== undefined &&
        config.data !== null
    ) {
        if (isPlainObject(config.data) || Array.isArray(config.data)) {
            config.data = decamelizeKeys(config.data);
        }
    }
    if (isPlainObject(config.params)) {
        config.params = decamelizeKeys(config.params);
    }
    return config;
});

// A single in-flight refresh shared by all 401s (no thundering herd).
// Exported so non-axios callers (e.g. the assistant's fetch-based SSE stream in
// `http/assistant.ts`) can reuse the same refresh-once flow.
let refreshInFlight: Promise<void> | null = null;
export const refreshAccessToken = (): Promise<void> => {
    if (!refreshInFlight) {
        // Raw axios (NOT `api`) so this call skips the interceptor stack: no
        // Bearer (the cookie authenticates it), no camelize (read snake here),
        // and no recursive 401 handling.
        refreshInFlight = axios
            .post<{ access_token?: string }>(
                `${BASE_URL}/auth/refresh`,
                {},
                { withCredentials: true },
            )
            .then((res) => {
                const newToken = res.data?.access_token;
                if (newToken) useAuthStore.getState().setAccessToken(newToken);
            })
            .finally(() => {
                refreshInFlight = null;
            });
    }
    return refreshInFlight;
};

// Response: camelize success bodies + 401→refresh→retry (once).
api.interceptors.response.use(
    (response: AxiosResponse) => {
        const url = response.config.url ?? "";
        if (!SKIP_CAMELIZE_URLS.some((u) => url.includes(u))) {
            response.data = camelizeKeys(response.data);
        }
        return response;
    },
    async (error: AxiosError) => {
        const original = error.config as
            | (InternalAxiosRequestConfig & { _retry?: boolean })
            | undefined;

        if (error.response?.status === 401 && original && !original._retry) {
            original._retry = true;
            try {
                await refreshAccessToken();
                // Retry once — the request interceptor re-attaches the NEW token.
                return await api.request(original);
            } catch (refreshErr) {
                useAuthStore.getState().logout();
                return Promise.reject(refreshErr);
            }
        }
        return Promise.reject(error);
    },
);

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Unwrap a `{data, pagination}` collection envelope to its `data` array. */
export const unwrapData = <T>(res: AxiosResponse<{ data: T }>): T =>
    res.data.data;

export interface ApiErrorShape {
    code: string;
    message: string;
    requestId?: string;
}

/** Read the backend `{error:{code,message,request_id}}` envelope, if present. */
export const getApiError = (err: unknown): ApiErrorShape | null => {
    if (err instanceof AxiosError) {
        const env = (
            err.response?.data as
                | {
                      error?: {
                          code?: string;
                          message?: string;
                          request_id?: string;
                      };
                  }
                | undefined
        )?.error;
        if (env) {
            return {
                code: env.code ?? "unknown",
                message: env.message ?? "Request failed",
                requestId: env.request_id,
            };
        }
    }
    return null;
};

/** Friendly message for the UI — falls back to the raw Error message. */
export const getApiErrorMessage = (err: unknown): string =>
    getApiError(err)?.message ??
    (err instanceof Error ? err.message : "Something went wrong. Try again.");
