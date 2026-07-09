import { StrictMode } from "react";
import "antd/dist/reset.css";
import "./index.css";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ConfigProvider, App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { antdTheme } from "./theme";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30 * 1000,
        },
    },
});

/**
 * SPA root — replicates the old Vite `main.tsx` exactly, but as a component
 * (rendered by Astro via `client:only="react"`) instead of calling createRoot.
 */
export default function Root() {
    return (
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <ConfigProvider theme={antdTheme}>
                    <AntApp>
                        <ErrorBoundary>
                            <RouterProvider router={router} />
                        </ErrorBoundary>
                    </AntApp>
                </ConfigProvider>
            </QueryClientProvider>
        </StrictMode>
    );
}
