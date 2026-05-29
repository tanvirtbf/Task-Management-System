import request, { type SuperTest, type Test } from "supertest";
import type { Express } from "express";

/**
 * Lazy-load the app module so test setup (env loading + DB init) runs first.
 * Returns supertest helpers — one stateless (`oneOff`) and one for full
 * cookie-bearing flows (`loggedInAgent`).
 *
 * NOTE on cookies: supertest's built-in agent has flaky cookie-jar behaviour
 * across `await` boundaries inside jest. The reliable pattern is to grab the
 * `Set-Cookie` headers from /login and forward them on every subsequent
 * request via `.set('Cookie', ...)`. The `LoggedInClient` helper below does
 * exactly that.
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
export const oneOff = async (): Promise<SuperTest<Test>> => {
    const app = await getApp();
    return request(app) as unknown as SuperTest<Test>;
};

/**
 * Authenticated client wrapper. Login once, then `client.get(...)` /
 * `client.post(...)` automatically attach the access + refresh cookies.
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

/**
 * Log a fixture user in and return a `LoggedInClient` that carries the
 * resulting access + refresh cookies on every subsequent request.
 */
export const loggedInAgent = async (
    email: string,
    password: string,
): Promise<LoggedInClient> => {
    const app = await getApp();
    const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });
    if (res.status !== 200) {
        throw new Error(
            `loggedInAgent: login failed for ${email} (status ${res.status}, body ${JSON.stringify(res.body)})`,
        );
    }
    const setCookie = res.get("set-cookie");
    if (!setCookie) {
        throw new Error("loggedInAgent: login succeeded but no Set-Cookie header");
    }
    const header = Array.isArray(setCookie) ? setCookie.join(",") : setCookie;
    return new LoggedInClient(app, header);
};
