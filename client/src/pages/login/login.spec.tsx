import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import LoginPage from "./login";

const renderWithProviders = (ui: ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>,
    );
};

describe("Login Page", () => {
    it("should render login page", () => {
        renderWithProviders(<LoginPage />);

        expect(screen.getByText("Sign in")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Login" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("checkbox", { name: "Remember Me" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Forgot Password")).toBeInTheDocument();
    });
});
