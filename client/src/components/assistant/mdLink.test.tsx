import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FC, ReactNode } from "react";
import { classifyLink, makeAssistantMarkdownComponents } from "./mdLink";

type AnchorLike = FC<{ href?: string; children?: ReactNode }>;
const linkOf = (navigate = vi.fn(), onNav = vi.fn()): AnchorLike =>
    makeAssistantMarkdownComponents(navigate, onNav).a as unknown as AnchorLike;

describe("classifyLink", () => {
    it.each([
        ["/dept", "in-app"],
        ["/settings/profile", "in-app"],
        ["/reports", "in-app"],
        ["//evil.com", "unsafe"],
        ["https://example.com", "external"],
        ["http://x.test", "external"],
        ["javascript:alert(1)", "unsafe"],
        ["mailto:a@b.com", "unsafe"],
        ["", "unsafe"],
        [undefined, "unsafe"],
    ] as const)("classifies %s → %s", (href, kind) => {
        expect(classifyLink(href)).toBe(kind);
    });
});

describe("assistant markdown link component", () => {
    it("in-app link navigates via router (no reload) + fires onInAppNavigate", () => {
        const navigate = vi.fn();
        const onNav = vi.fn();
        const A = linkOf(navigate, onNav);
        render(<A href="/dept">Department</A>);
        fireEvent.click(screen.getByText("Department"));
        expect(navigate).toHaveBeenCalledWith("/dept");
        expect(onNav).toHaveBeenCalledOnce();
    });

    it("external link opens a new tab and does NOT touch the router", () => {
        const navigate = vi.fn();
        const A = linkOf(navigate);
        render(<A href="https://example.com">site</A>);
        const a = screen.getByText("site");
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noreferrer");
        fireEvent.click(a);
        expect(navigate).not.toHaveBeenCalled();
    });

    it("unsafe href renders plain text with no anchor and never navigates", () => {
        const navigate = vi.fn();
        const A = linkOf(navigate);
        const { container } = render(<A href="javascript:alert(1)">x</A>);
        expect(container.querySelector("a")).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });
});
