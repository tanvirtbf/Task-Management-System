import { StrictMode, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./index.css";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ConfigProvider, App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildAntdTheme, setActiveTheme } from "./theme";
import { useUiStore } from "./stores/ui";
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

const Root = () => {
    const theme = useUiStore((s) => s.theme);

    // Sync active theme to tokens proxy + <html data-theme>
    useEffect(() => {
        setActiveTheme(theme);
    }, [theme]);

    const antd = useMemo(() => buildAntdTheme(theme), [theme]);

    return (
        <ConfigProvider theme={antd}>
            <AntApp>
                <ErrorBoundary>
                    <RouterProvider router={router} />
                </ErrorBoundary>
            </AntApp>
        </ConfigProvider>
    );
};

// Apply persisted theme immediately to avoid a light flash on dark boot.
const initial = (() => {
    try {
        const raw = localStorage.getItem("th-ui");
        if (raw) {
            const parsed = JSON.parse(raw);
            const t = parsed?.state?.theme;
            if (t === "dark" || t === "light") return t;
        }
    } catch {
        // ignore
    }
    return "light" as const;
})();
setActiveTheme(initial);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <Root />
        </QueryClientProvider>
    </StrictMode>,
);
