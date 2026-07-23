import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./index.css";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ConfigProvider, App as AntApp } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { antdTheme } from "./theme";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { queryClient } from "./lib/queryClient";

createRoot(document.getElementById("root")!).render(
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
    </StrictMode>,
);
