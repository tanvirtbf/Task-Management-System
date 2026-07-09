/**
 * Backend entry — bridges Astro/Workers Fetch requests into the copied
 * Express app running on the shim.
 *
 * The app module tree is imported LAZILY (first request) because several
 * route modules call getDb() at module scope — the DB must be initialised
 * (and the runtime env injected) first, mirroring the original server.ts
 * boot order.
 */
let appPromise: Promise<{
    fetch(request: Request): Promise<Response>;
}> | null = null;

/** Paths owned by the backend (everything else renders the Astro SPA). */
export const isBackendPath = (pathname: string): boolean =>
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/health" ||
    pathname.startsWith("/health/") ||
    pathname === "/metrics";

const buildApp = async () => {
    const { initDb } = await import("./db/client");
    await initDb();
    const mod = await import("./app");
    // Runtime object is the shim's Application (has .fetch); its TS type is
    // @types/express's Express, hence the cast.
    return mod.default as unknown as {
        fetch(request: Request): Promise<Response>;
    };
};

export const handleBackendRequest = async (
    request: Request,
): Promise<Response> => {
    if (!appPromise) {
        appPromise = buildApp().catch((err) => {
            appPromise = null; // allow retry on next request
            throw err;
        });
    }
    const app = await appPromise;
    return app.fetch(request);
};
