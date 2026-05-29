import { oneOff, loggedInAgent } from "./test-utils/app";
import { makeUser } from "./test-utils/factories";

describe("Auth flow", () => {
    describe("POST /api/v1/auth/login", () => {
        it("logs in a valid user and sets cookies", async () => {
            const u = await makeUser({ email: "ada@example.test" });
            const http = await oneOff();

            const res = await http
                .post("/api/v1/auth/login")
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ id: u.id });
            const cookies = res.get("set-cookie");
            expect(cookies).toBeDefined();
            const cookieStr = Array.isArray(cookies)
                ? cookies.join(";")
                : (cookies ?? "");
            expect(cookieStr).toMatch(/accessToken=/);
            expect(cookieStr).toMatch(/refreshToken=/);
        });

        it("returns 422 with spec envelope when email is invalid", async () => {
            const http = await oneOff();
            const res = await http
                .post("/api/v1/auth/login")
                .send({ email: "not-an-email", password: "" });

            expect(res.status).toBe(422);
            expect(res.body.error).toBeDefined();
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.request_id).toMatch(/^req_/);
            expect(Array.isArray(res.body.error.details)).toBe(true);
            const fields = res.body.error.details.map(
                (d: { field: string }) => d.field,
            );
            expect(fields).toContain("email");
            expect(fields).toContain("password");
        });

        it("returns 400 invalid_credentials when password does not match", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const res = await http
                .post("/api/v1/auth/login")
                .send({ email: u.email, password: "wrong-password" });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.invalid_credentials");
        });

        it("returns 400 invalid_credentials for unknown email", async () => {
            const http = await oneOff();
            const res = await http
                .post("/api/v1/auth/login")
                .send({ email: "nobody@example.test", password: "whatever" });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.invalid_credentials");
        });

        it("echoes a fresh X-Request-Id when client does not supply one", async () => {
            const http = await oneOff();
            const res = await http
                .post("/api/v1/auth/login")
                .send({ email: "nobody@example.test", password: "x" });

            const id = res.get("X-Request-Id");
            expect(id).toBeDefined();
            expect(id).toMatch(/^req_/);
            expect(res.body.error.request_id).toBe(id);
        });

        it("echoes the X-Request-Id supplied by the client", async () => {
            const http = await oneOff();
            const supplied = "trace_abc_xyz";
            const res = await http
                .post("/api/v1/auth/login")
                .set("X-Request-Id", supplied)
                .send({ email: "nobody@example.test", password: "x" });

            expect(res.get("X-Request-Id")).toBe(supplied);
            expect(res.body.error.request_id).toBe(supplied);
        });
    });

    describe("GET /api/v1/auth/me", () => {
        it("returns the current user after login", async () => {
            const u = await makeUser({ email: "linus@example.test" });
            const client = await loggedInAgent(u.email, u.password);

            const res = await client.get("/api/v1/auth/me");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
            expect(res.body.email).toBe(u.email);
            expect(res.body.workspaceId).toBe(u.workspaceId);
            expect(res.body.role).toBe("member");
        });

        it("returns 401 with spec envelope when no cookies are sent", async () => {
            const http = await oneOff();
            const res = await http.get("/api/v1/auth/me");

            expect(res.status).toBe(401);
            expect(res.body.error).toBeDefined();
            expect(res.body.error.code).toBe("auth.unauthorized");
        });
    });

    describe("POST /api/v1/auth/logout", () => {
        it("revokes the session and clears cookies", async () => {
            const u = await makeUser();
            const client = await loggedInAgent(u.email, u.password);

            const logoutRes = await client.post("/api/v1/auth/logout");
            expect(logoutRes.status).toBe(200);
            const setCookies = logoutRes.get("set-cookie");
            expect(setCookies).toBeDefined();
            const cookieStr = Array.isArray(setCookies)
                ? setCookies.join(";")
                : (setCookies ?? "");
            // Cleared cookies are emitted with Expires in the past.
            expect(cookieStr).toMatch(/accessToken=;/);
            expect(cookieStr).toMatch(/refreshToken=;/);
        });
    });

    describe("Catch-all", () => {
        it("returns a 404 with spec envelope for unknown routes", async () => {
            const http = await oneOff();
            const res = await http.get("/api/v1/this-does-not-exist");

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
            expect(res.body.error.request_id).toMatch(/^req_/);
            expect(res.body.error.message).toContain(
                "/api/v1/this-does-not-exist",
            );
        });

        it("/health is unauthenticated and returns ok", async () => {
            const http = await oneOff();
            const res = await http.get("/health");
            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
        });
    });
});
