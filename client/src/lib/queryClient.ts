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
        queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30 * 1000,
        },
    },
});
