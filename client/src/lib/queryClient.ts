import { MutationCache, QueryClient } from "@tanstack/react-query";
import { message } from "antd";
import { getApiErrorMessage } from "../http/client";

/**
 * The app-wide react-query client. Lives outside main.tsx so non-component
 * code (the auth store's sign-out purge — gap-scan C1) can reach it.
 *
 * Gap-scan M9: the MutationCache onError is the SILENT-FAILURE NET — dozens
 * of mutations shipped with no onError, so server rejections (like the C3
 * workspace 422) vanished. Mutations that define their OWN onError keep full
 * ownership of the UX; everything else at least surfaces the API error as a
 * toast. (antd's static `message` renders with default theming — acceptable
 * for a fallback path.)
 */
export const queryClient = new QueryClient({
    mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
            if (mutation.options.onError) return;
            message.error(getApiErrorMessage(error));
        },
    }),
    defaultOptions: {
        // ⚠️ QUERIES ONLY. Do not add a `mutations` block with retry: a write
        // whose response was lost would be sent twice, and this app creates
        // tasks, comments and delete-requests.
        queries: {
            // P8: mobile data drops requests. One dropped read used to become a
            // permanent error with no way back except a reload.
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
            // On a phone, coming back to a backgrounded app IS the refresh
            // gesture — the SSE stream is also usually dead by then.
            refetchOnWindowFocus: true,
            staleTime: 30 * 1000,
        },
    },
});
