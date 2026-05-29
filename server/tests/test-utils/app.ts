import request, { type Test } from "supertest";
import type { Express } from "express";

/**
 * Lazy-load the app module so test setup (env loading + DB init) runs first.
 *
 * NOTE on cookies: supertest's built-in agent has flaky cookie-jar behaviour
 * across `await` boundaries inside jest. The reliable pattern is to grab the
 * `Set-Cookie` headers from /login (or to mint cookies directly with
 * `TokenService` via the `makeLoggedInClient` factory) and forward them on
 * every subsequent request via `.set('Cookie', ...)`. The `LoggedInClient`
 * helper below does exactly that.
 */

let _app: Express | undefined;

export const getApp = async (): Promise<Express> => {
    if (_app) return _app;
    if (process.env.NODE_ENV !== "test") {
        throw new Error(
            `getApp() called with NODE_ENV=${process.env.NODE_ENV ?? "<unset>"}; expected "test"`,
        );
    }
    const mod = await import("../../src/app");
    _app = mod.default;
    return _app;
};

/** Stateless request — no cookies remembered. Useful for negative tests. */
export const oneOff = async () => {
    const app = await getApp();
    return request(app);
};

/**
 * Authenticated client wrapper. Built once with the access + refresh cookie
 * values; every method attaches those cookies to its request.
 *
 * Use `makeLoggedInClient` (in `factories.ts`) to build one without
 * depending on any specific login endpoint existing yet.
 */
export class LoggedInClient {
    constructor(
        private app: Express,
        private cookieHeader: string,
    ) {}

    private cookieValuesOnly(): string {
        // `Set-Cookie` values include attrs like `Path=`, `HttpOnly`, etc.
        // The browser only echoes `name=value` pairs back. We do the same.
        return this.cookieHeader
            .split(",")
            .map((entry) => entry.split(";")[0]?.trim())
            .filter(Boolean)
            .join("; ");
    }

    get(path: string): Test {
        return request(this.app).get(path).set("Cookie", this.cookieValuesOnly());
    }
    post(path: string): Test {
        return request(this.app).post(path).set("Cookie", this.cookieValuesOnly());
    }
    patch(path: string): Test {
        return request(this.app).patch(path).set("Cookie", this.cookieValuesOnly());
    }
    put(path: string): Test {
        return request(this.app).put(path).set("Cookie", this.cookieValuesOnly());
    }
    delete(path: string): Test {
        return request(this.app).delete(path).set("Cookie", this.cookieValuesOnly());
    }
}
