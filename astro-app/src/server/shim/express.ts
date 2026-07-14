/* =============================================================================
 * Minimal Express-4-compatible layer over the Fetch API.
 *
 * The whole backend (routes / controllers / middlewares copied from the
 * original Express + Node server) imports "express"; a Vite alias resolves
 * that specifier to THIS file so the code runs unchanged on Cloudflare
 * Workers (and in `astro dev` on Node). Types still come from @types/express.
 *
 * Implemented surface (exactly what the copied codebase + its pure-JS
 * middleware deps use — express-jwt, express-validator, cookie-parser, cors):
 *   - express() app: set/get settings, use, METHOD routes, handle
 *   - express.Router(): use, get/post/patch/put/delete/all, nested mounts
 *   - express.json(), express.static() (no-op — Astro serves assets)
 *   - req: method/url/originalUrl/path/baseUrl/params/query(qs)/headers/body/
 *     cookies/signedCookies/secret/ip/protocol/secure/hostname/socket stub/
 *     get()/header()/is()/on('close')  (+ req.app / req.res / req.route)
 *   - res: status/sendStatus/set/get/setHeader/getHeader/removeHeader/append/
 *     json/send/end/write/writeHead/flushHeaders (streaming + SSE)/cookie/
 *     clearCookie/redirect/type/vary/locals/headersSent/on('finish'|'close')
 *   - middleware chain: next(), next(err) → 4-arity error handlers,
 *     next('route'), next('router'), async-handler rejection capture
 * ========================================================================== */
import * as qs from "qs";
import { createHmac } from "crypto";
import { Buffer } from "buffer";

/* ─── tiny event emitter ──────────────────────────────────────────────────── */
class MiniEmitter {
    private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    on(event: string, fn: (...args: unknown[]) => void): this {
        (this.listeners[event] ??= []).push(fn);
        return this;
    }
    once(event: string, fn: (...args: unknown[]) => void): this {
        const wrap = (...args: unknown[]) => {
            this.off(event, wrap);
            fn(...args);
        };
        return this.on(event, wrap);
    }
    off(event: string, fn: (...args: unknown[]) => void): this {
        const arr = this.listeners[event];
        if (arr) this.listeners[event] = arr.filter((f) => f !== fn);
        return this;
    }
    removeListener(event: string, fn: (...args: unknown[]) => void): this {
        return this.off(event, fn);
    }
    removeAllListeners(event?: string): this {
        if (event) delete this.listeners[event];
        else this.listeners = {};
        return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
        const arr = this.listeners[event];
        if (!arr?.length) return false;
        for (const fn of [...arr]) {
            try {
                fn(...args);
            } catch {
                /* listener errors must not break the chain */
            }
        }
        return true;
    }
}

/* ─── types ───────────────────────────────────────────────────────────────── */
export type NextFunction = (err?: unknown) => void;
// Loose on purpose: the copied code types itself via @types/express.
export type Request = ShimRequest & Record<string, any>;
export type Response = ShimResponse & Record<string, any>;
export type RequestHandler = (req: any, res: any, next: NextFunction) => unknown;
export type ErrorRequestHandler = (
    err: unknown,
    req: any,
    res: any,
    next: NextFunction,
) => unknown;
type AnyHandler = RequestHandler | ErrorRequestHandler;

/* ─── path matching ("/a/:id/b", trailing "*") ────────────────────────────── */
interface PathMatch {
    params: Record<string, string>;
    /** Portion of the path consumed (for prefix matches). */
    consumed: string;
}

const splitPath = (p: string): string[] =>
    p.split("/").filter((s) => s.length > 0);

const decode = (s: string): string => {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
};

/** Full match of an entire path against a route pattern. */
const matchFull = (pattern: string, path: string): PathMatch | null => {
    const pat = splitPath(pattern);
    const seg = splitPath(path);
    const params: Record<string, string> = {};
    let i = 0;
    for (; i < pat.length; i++) {
        const p = pat[i];
        if (p === "*") {
            // Trailing wildcard: match one-or-more remaining segments.
            if (i >= seg.length) return null;
            params["0"] = seg.slice(i).map(decode).join("/");
            return { params, consumed: path };
        }
        if (i >= seg.length) return null;
        if (p.startsWith(":")) {
            params[p.slice(1)] = decode(seg[i]);
        } else if (p.toLowerCase() !== seg[i].toLowerCase()) {
            return null;
        }
    }
    if (i !== seg.length) return null;
    return { params, consumed: path };
};

/** Prefix match (for use()/mounted routers). "/" matches everything. */
const matchPrefix = (prefix: string, path: string): PathMatch | null => {
    const pat = splitPath(prefix);
    if (pat.length === 0) return { params: {}, consumed: "" };
    const seg = splitPath(path);
    if (seg.length < pat.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < pat.length; i++) {
        const p = pat[i];
        if (p.startsWith(":")) params[p.slice(1)] = decode(seg[i]);
        else if (p.toLowerCase() !== seg[i].toLowerCase()) return null;
    }
    return { params, consumed: "/" + seg.slice(0, pat.length).join("/") };
};

/* ─── layers + router ─────────────────────────────────────────────────────── */
interface Layer {
    kind: "middleware" | "route" | "router";
    path: string | null; // null → match all (plain use(fn))
    method?: string; // for routes; "all" matches any
    fns: AnyHandler[];
    router?: ShimRouter;
}

const METHODS = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "all",
] as const;

export class ShimRouter {
    layers: Layer[] = [];

    use(...args: unknown[]): this {
        let path: string | null = null;
        let rest = args;
        if (typeof args[0] === "string") {
            path = args[0];
            rest = args.slice(1);
        }
        for (const item of rest.flat(Infinity) as unknown[]) {
            if (item instanceof ShimRouter) {
                this.layers.push({ kind: "router", path, fns: [], router: item });
            } else if (typeof item === "function") {
                this.layers.push({
                    kind: "middleware",
                    path,
                    fns: [item as AnyHandler],
                });
            }
        }
        return this;
    }

    private addRoute(method: string, path: string, handlers: unknown[]): this {
        const fns = (handlers.flat(Infinity) as unknown[]).filter(
            (h): h is AnyHandler => typeof h === "function",
        );
        this.layers.push({ kind: "route", path, method, fns });
        return this;
    }

    get(path: string, ...handlers: unknown[]): this {
        return this.addRoute("get", path, handlers);
    }
    post(path: string, ...handlers: unknown[]): this {
        return this.addRoute("post", path, handlers);
    }
    put(path: string, ...handlers: unknown[]): this {
        return this.addRoute("put", path, handlers);
    }
    patch(path: string, ...handlers: unknown[]): this {
        return this.addRoute("patch", path, handlers);
    }
    delete(path: string, ...handlers: unknown[]): this {
        return this.addRoute("delete", path, handlers);
    }
    options(path: string, ...handlers: unknown[]): this {
        return this.addRoute("options", path, handlers);
    }
    head(path: string, ...handlers: unknown[]): this {
        return this.addRoute("head", path, handlers);
    }
    all(path: string, ...handlers: unknown[]): this {
        return this.addRoute("all", path, handlers);
    }

    /**
     * Dispatch req through this router's layers; `out(err?)` on fallthrough.
     * `initialErr` seeds the error state (express semantics: a mounted router
     * entered WITH a pending error only runs its error-handling middleware —
     * losing the error here would turn 401/422s into 404s downstream).
     */
    handle(req: any, res: any, out: NextFunction, initialErr?: unknown): void {
        let idx = 0;
        const parentParams = req.params ?? {};

        const next: NextFunction = (err?: unknown) => {
            if (err === "router") return out(); // exit this router, no error
            if (idx >= this.layers.length) return out(err);
            const layer = this.layers[idx++];
            const path = req.path as string;

            // On error, route layers are skipped entirely (express semantics).
            if (err !== undefined && err !== "route" && layer.kind === "route") {
                return next(err);
            }
            const errState = err === "route" ? undefined : err;

            if (layer.kind === "route") {
                const method = req.method.toLowerCase();
                const m = layer.method!;
                if (m !== "all" && m !== method && !(m === "get" && method === "head")) {
                    return next(errState);
                }
                const match = matchFull(layer.path!, path);
                if (!match) return next(errState);
                req.params = { ...parentParams, ...match.params };
                req.route = { path: layer.path };
                return runFns(layer.fns, errState, req, res, (e?: unknown) => {
                    if (e === "route") return next();
                    next(e);
                });
            }

            if (layer.kind === "router") {
                const match =
                    layer.path === null || layer.path === "/"
                        ? { params: {}, consumed: "" }
                        : matchPrefix(layer.path, path);
                if (!match) return next(errState);
                const prevUrl = req.url;
                const prevBase = req.baseUrl;
                const prevParams = req.params;
                if (match.consumed) {
                    const remainder = path.slice(match.consumed.length) || "/";
                    const q = String(prevUrl).split("?")[1];
                    req.url = remainder + (q ? "?" + q : "");
                    req.baseUrl = (prevBase || "") + match.consumed;
                }
                req.params = { ...parentParams, ...match.params };
                return layer.router!.handle(
                    req,
                    res,
                    (e?: unknown) => {
                        req.url = prevUrl;
                        req.baseUrl = prevBase;
                        req.params = prevParams;
                        next(e);
                    },
                    errState,
                );
            }

            // middleware
            const match =
                layer.path === null || layer.path === "/"
                    ? { params: {}, consumed: "" }
                    : matchPrefix(layer.path, path);
            if (!match) return next(errState);
            req.params = { ...parentParams, ...match.params };
            return runFns(layer.fns, errState, req, res, next);
        };

        next(initialErr);
    }
}

/** Run a layer's handler list, honouring error-handler arity + next('route'). */
const runFns = (
    fns: AnyHandler[],
    initialErr: unknown,
    req: any,
    res: any,
    done: NextFunction,
): void => {
    let j = 0;
    let errState: unknown = initialErr;

    const innerNext: NextFunction = (e?: unknown) => {
        if (e === "route" || e === "router") return done(e);
        errState = e;
        step();
    };

    const step = (): void => {
        if (j >= fns.length) return done(errState);
        const fn = fns[j++];
        const isErrHandler = fn.length === 4;
        if (errState !== undefined && !isErrHandler) return step();
        if (errState === undefined && isErrHandler) return step();
        try {
            const ret =
                errState !== undefined
                    ? (fn as ErrorRequestHandler)(errState, req, res, innerNext)
                    : (fn as RequestHandler)(req, res, innerNext);
            // Async handlers that reject without calling next(err) still land
            // in the error chain (express-5-style safety; harmless otherwise).
            if (
                ret &&
                typeof (ret as Promise<unknown>).catch === "function"
            ) {
                (ret as Promise<unknown>).catch((asyncErr) => {
                    if (!res.headersSent && !res.writableEnded) {
                        innerNext(asyncErr);
                    }
                });
            }
        } catch (syncErr) {
            innerNext(syncErr);
        }
    };

    step();
};

/* ─── request ─────────────────────────────────────────────────────────────── */
export class ShimRequest extends MiniEmitter {
    method: string;
    url: string;
    originalUrl: string;
    baseUrl = "";
    params: Record<string, string> = {};
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined> = {};
    body: unknown = undefined;
    // NOT pre-initialized: cookie-parser skips parsing when req.cookies is
    // already truthy — it must find these undefined and populate them itself.
    cookies?: Record<string, string>;
    signedCookies?: Record<string, string>;
    secret?: string;
    ip: string;
    protocol: string;
    secure: boolean;
    hostname: string;
    route?: { path: string };
    app: any;
    res: any;
    requestId?: string;
    auth?: unknown;
    /** Node socket stand-in (SSE calls req.socket?.setTimeout?.(0)). */
    socket = {
        setTimeout: (_ms?: number) => {},
        remoteAddress: "",
        destroyed: false,
    };
    /** Raw request body bytes (pre-read by the adapter for non-GET/HEAD). */
    _rawBodyBytes: Uint8Array | undefined;
    /** Lazily-decoded body text (see rawText()). */
    _rawBody: string | undefined;
    /** body-parser compat flag: true once a body middleware actually parsed. */
    _body = false;

    /** Decode the pre-read body bytes as UTF-8 text (cached). */
    rawText(): string | undefined {
        if (this._rawBody === undefined && this._rawBodyBytes !== undefined) {
            this._rawBody = new TextDecoder().decode(this._rawBodyBytes);
        }
        return this._rawBody;
    }
    /** Underlying Fetch Request, for anything exotic. */
    raw: globalThis.Request;

    constructor(request: globalThis.Request) {
        super();
        this.raw = request;
        const u = new URL(request.url);
        this.method = request.method.toUpperCase();
        this.url = u.pathname + u.search;
        this.originalUrl = this.url;
        this.query = qs.parse(u.search.replace(/^\?/, "")) as Record<
            string,
            unknown
        >;
        for (const [k, v] of request.headers) {
            const key = k.toLowerCase();
            const existing = this.headers[key];
            if (existing === undefined) this.headers[key] = v;
            else if (Array.isArray(existing)) existing.push(v);
            else this.headers[key] = [existing, v];
        }
        this.ip =
            (this.headers["cf-connecting-ip"] as string) ??
            ((this.headers["x-forwarded-for"] as string) ?? "")
                .split(",")[0]
                .trim();
        this.socket.remoteAddress = this.ip;
        this.protocol = u.protocol.replace(":", "") || "http";
        this.secure = this.protocol === "https";
        this.hostname = u.hostname;

        // Client disconnect → Express-style 'close'/'aborted' events.
        try {
            request.signal?.addEventListener("abort", () => {
                this.socket.destroyed = true;
                this.emit("aborted");
                this.emit("close");
            });
        } catch {
            /* signal unsupported — fine */
        }
    }

    get path(): string {
        return this.url.split("?")[0];
    }

    get(name: string): string | undefined {
        const v = this.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : v;
    }
    header(name: string): string | undefined {
        return this.get(name);
    }
    /** Simplified `req.is` — substring check on Content-Type. */
    is(type: string): string | false {
        const ct = (this.get("content-type") ?? "").toLowerCase();
        if (!ct) return false;
        const t = type.toLowerCase();
        if (ct.includes(t)) return type;
        if (t === "json" && ct.includes("json")) return type;
        return false;
    }
    accepts(..._types: string[]): string | false {
        // The backend always answers JSON; accept everything.
        const first = _types.flat()[0];
        return typeof first === "string" ? first : "*/*";
    }
}

/* ─── response ────────────────────────────────────────────────────────────── */
const STATUS_TEXT: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    410: "Gone",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    503: "Service Unavailable",
};

const NO_BODY_STATUS = new Set([204, 205, 304]);

const cookieSign = (value: string, secret: string): string =>
    value +
    "." +
    createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/, "");

interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    signed?: boolean;
    sameSite?: boolean | "lax" | "strict" | "none";
}

const serializeCookie = (
    name: string,
    value: string,
    opts: CookieOptions = {},
): string => {
    let str = `${name}=${encodeURIComponent(value)}`;
    if (opts.maxAge !== undefined) {
        str += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
    }
    if (opts.domain) str += `; Domain=${opts.domain}`;
    str += `; Path=${opts.path ?? "/"}`;
    if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
    if (opts.httpOnly) str += "; HttpOnly";
    if (opts.secure) str += "; Secure";
    if (opts.sameSite) {
        const v =
            opts.sameSite === true
                ? "Strict"
                : opts.sameSite[0].toUpperCase() + opts.sameSite.slice(1);
        str += `; SameSite=${v}`;
    }
    return str;
};

const encoder = new TextEncoder();

export class ShimResponse extends MiniEmitter {
    statusCode = 200;
    locals: Record<string, unknown> = {};
    headersSent = false;
    writableEnded = false;
    finished = false;
    app: any;
    req: ShimRequest;

    private headers = new Headers();
    private chunks: Uint8Array[] = [];
    private streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;
    private streaming = false;
    private resolveResponse: (r: globalThis.Response) => void;
    /** Resolves with the final Fetch Response. */
    readonly fetchResponse: Promise<globalThis.Response>;

    constructor(req: ShimRequest) {
        super();
        this.req = req;
        req.res = this;
        let resolve!: (r: globalThis.Response) => void;
        this.fetchResponse = new Promise<globalThis.Response>((r) => {
            resolve = r;
        });
        this.resolveResponse = resolve;
    }

    /* headers */
    setHeader(name: string, value: string | number | string[]): this {
        if (Array.isArray(value)) {
            this.headers.delete(name);
            for (const v of value) this.headers.append(name, String(v));
        } else {
            this.headers.set(name, String(value));
        }
        return this;
    }
    getHeader(name: string): string | undefined {
        return this.headers.get(name) ?? undefined;
    }
    removeHeader(name: string): this {
        this.headers.delete(name);
        return this;
    }
    hasHeader(name: string): boolean {
        return this.headers.has(name);
    }
    set(field: string | Record<string, string>, value?: string | string[]): this {
        if (typeof field === "object") {
            for (const [k, v] of Object.entries(field)) this.setHeader(k, v);
            return this;
        }
        return this.setHeader(field, value ?? "");
    }
    header(field: string | Record<string, string>, value?: string): this {
        return this.set(field, value);
    }
    get(name: string): string | undefined {
        return this.getHeader(name);
    }
    append(field: string, value: string | string[]): this {
        for (const v of Array.isArray(value) ? value : [value]) {
            this.headers.append(field, v);
        }
        return this;
    }
    vary(field: string): this {
        const cur = this.headers.get("Vary");
        if (!cur) this.headers.set("Vary", field);
        else if (
            !cur
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .includes(field.toLowerCase())
        ) {
            this.headers.set("Vary", cur + ", " + field);
        }
        return this;
    }
    type(t: string): this {
        const map: Record<string, string> = {
            json: "application/json; charset=utf-8",
            html: "text/html; charset=utf-8",
            text: "text/plain; charset=utf-8",
            txt: "text/plain; charset=utf-8",
        };
        this.headers.set("Content-Type", map[t] ?? t);
        return this;
    }

    /* status */
    status(code: number): this {
        this.statusCode = code;
        return this;
    }
    sendStatus(code: number): this {
        this.statusCode = code;
        this.type("text");
        this.end(STATUS_TEXT[code] ?? String(code));
        return this;
    }
    writeHead(
        code: number,
        headersOrMessage?: Record<string, string | number | string[]> | string,
        maybeHeaders?: Record<string, string | number | string[]>,
    ): this {
        this.statusCode = code;
        const hdrs =
            typeof headersOrMessage === "object" ? headersOrMessage : maybeHeaders;
        if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) this.setHeader(k, v);
        }
        return this;
    }

    /* cookies */
    cookie(name: string, value: string, options: CookieOptions = {}): this {
        let val = String(value);
        if (options.signed) {
            const secret = this.req.secret;
            if (!secret) {
                throw new Error("cookieParser(\"secret\") required for signed cookies");
            }
            val = "s:" + cookieSign(val, secret);
        }
        this.headers.append("Set-Cookie", serializeCookie(name, val, options));
        return this;
    }
    clearCookie(name: string, options: CookieOptions = {}): this {
        this.headers.append(
            "Set-Cookie",
            serializeCookie(name, "", {
                ...options,
                signed: false,
                expires: new Date(0),
                maxAge: undefined,
            }),
        );
        return this;
    }

    /* body */
    private commitStream(): void {
        if (this.streaming || this.finished) return;
        this.streaming = true;
        this.headersSent = true;
        const buffered = this.chunks;
        this.chunks = [];
        const self = this;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                self.streamController = controller;
                for (const c of buffered) controller.enqueue(c);
            },
            cancel() {
                // Client walked away mid-stream (SSE disconnect).
                self.streamController = null;
                self.finished = true;
                self.writableEnded = true;
                self.emit("close");
            },
        });
        this.resolveResponse(
            new Response(NO_BODY_STATUS.has(this.statusCode) ? null : stream, {
                status: this.statusCode,
                headers: this.headers,
            }),
        );
    }

    flushHeaders(): void {
        this.commitStream();
    }

    write(chunk: string | Uint8Array): boolean {
        if (this.finished) {
            this.emit("error", new Error("write after end"));
            return false;
        }
        const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
        if (!this.streaming) {
            // First write() → streaming mode (express/node behaviour).
            this.chunks.push(bytes);
            this.commitStream();
        } else if (this.streamController) {
            try {
                this.streamController.enqueue(bytes);
            } catch {
                return false;
            }
        }
        return true;
    }

    end(data?: string | Uint8Array): this {
        if (this.finished) return this;
        if (data !== undefined && data !== null) {
            if (this.streaming) {
                this.write(data);
            } else {
                this.chunks.push(
                    typeof data === "string" ? encoder.encode(data) : data,
                );
            }
        }
        this.finished = true;
        this.writableEnded = true;
        if (this.streaming) {
            try {
                this.streamController?.close();
            } catch {
                /* already closed by cancel */
            }
            this.streamController = null;
        } else {
            this.headersSent = true;
            let body: Uint8Array | null = null;
            if (!NO_BODY_STATUS.has(this.statusCode) && this.req.method !== "HEAD") {
                const total = this.chunks.reduce((n, c) => n + c.length, 0);
                if (total > 0) {
                    body = new Uint8Array(total);
                    let off = 0;
                    for (const c of this.chunks) {
                        body.set(c, off);
                        off += c.length;
                    }
                }
            }
            this.resolveResponse(
                new Response(body as BodyInit | null, {
                    status: this.statusCode,
                    headers: this.headers,
                }),
            );
        }
        this.emit("finish");
        this.emit("close");
        return this;
    }

    json(obj: unknown): this {
        if (!this.headers.has("Content-Type")) this.type("json");
        return this.end(JSON.stringify(obj));
    }

    send(body?: unknown): this {
        if (body === undefined || body === null) return this.end();
        if (typeof body === "string") {
            if (!this.headers.has("Content-Type")) this.type("html");
            return this.end(body);
        }
        if (body instanceof Uint8Array) {
            if (!this.headers.has("Content-Type")) {
                this.headers.set("Content-Type", "application/octet-stream");
            }
            return this.end(body);
        }
        return this.json(body);
    }

    redirect(statusOrUrl: number | string, maybeUrl?: string): this {
        const status = typeof statusOrUrl === "number" ? statusOrUrl : 302;
        const url = typeof statusOrUrl === "string" ? statusOrUrl : maybeUrl!;
        this.statusCode = status;
        this.headers.set("Location", url);
        return this.end();
    }
}

/* ─── application ─────────────────────────────────────────────────────────── */
export class ShimApplication extends ShimRouter {
    private settings: Record<string, unknown> = {};

    set(key: string, value: unknown): this {
        this.settings[key] = value;
        return this;
    }

    // app.get is overloaded: 1 string arg → read setting; otherwise a route.
    get(pathOrSetting: string, ...handlers: unknown[]): any {
        if (handlers.length === 0) return this.settings[pathOrSetting];
        return super.get(pathOrSetting, ...handlers);
    }

    listen(): never {
        throw new Error("app.listen() is not available on Cloudflare Workers");
    }

    /** Entry point: run one Fetch Request through the app. */
    async fetch(request: globalThis.Request): Promise<globalThis.Response> {
        const req = new ShimRequest(request) as any;
        req.app = this;

        // Pre-read the body as BYTES so express.json()/raw() can stay
        // synchronous — binary uploads must not round-trip through text.
        if (!["GET", "HEAD"].includes(req.method)) {
            try {
                req._rawBodyBytes = new Uint8Array(await request.arrayBuffer());
            } catch {
                req._rawBodyBytes = undefined;
            }
        }

        const res = new ShimResponse(req) as any;
        res.app = this;

        this.handle(req, res, (err?: unknown) => {
            // Fallthrough safety net — the copied app installs its own 404 +
            // error middlewares, so this only fires if those are missing.
            if (res.finished || res.headersSent) return;
            if (err !== undefined) {
                console.error("[shim] unhandled error", err);
                res.status(500).json({
                    error: { code: "internal", message: "Internal Server Error" },
                });
            } else {
                res.status(404).json({
                    error: { code: "not_found", message: "Not Found" },
                });
            }
        });

        return res.fetchResponse;
    }
}

/* ─── module surface (mirrors `import express from "express"`) ───────────── */
/** Parse a body-parser-style size limit ("1mb", "500kb", "100kb", "512b") to bytes. */
const parseByteLimit = (limit?: string): number => {
    if (!limit) return 100 * 1024; // body-parser json default
    const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
    if (!m) return 100 * 1024;
    const unit = (m[2] ?? "b").toLowerCase();
    const mult =
        unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
    return Math.floor(parseFloat(m[1]) * mult);
};

const jsonMiddleware =
    (opts?: { limit?: string }): RequestHandler =>
    (req: any, _res: any, next: NextFunction) => {
        // body-parser semantics: `_body` marks an ACTUAL parse; on skip the
        // body defaults to {} but a later parser (express.raw) may still run.
        if (req._body) return next();
        const raw: string | undefined = req.rawText?.();
        const ct = (req.headers["content-type"] as string) ?? "";
        if (raw === undefined || raw === "" || !ct.toLowerCase().includes("json")) {
            req.body ??= {};
            return next();
        }
        // Honour the configured size limit (body-parser → 413). `expose` is set so
        // the app's errorHandler surfaces it as a clean 413 rather than a 500.
        const size = req._rawBodyBytes?.byteLength ?? Buffer.byteLength(raw);
        if (size > parseByteLimit(opts?.limit)) {
            const err = new Error("request entity too large") as Error & {
                status?: number;
                statusCode?: number;
                type?: string;
                expose?: boolean;
            };
            err.status = err.statusCode = 413;
            err.type = "entity.too.large";
            err.expose = true;
            return next(err);
        }
        try {
            req.body = JSON.parse(raw);
            req._body = true;
            next();
        } catch {
            // body-parser sets `expose: true` on a 400 parse failure so it is
            // surfaced to the client; without it the errorHandler treats the
            // error as unknown and renders a 500 for malformed JSON.
            const err = new Error("Invalid JSON body") as Error & {
                status?: number;
                statusCode?: number;
                type?: string;
                expose?: boolean;
            };
            err.status = err.statusCode = 400;
            err.type = "entity.parse.failed";
            err.expose = true;
            next(err);
        }
    };

const urlencodedMiddleware =
    (_opts?: { extended?: boolean }): RequestHandler =>
    (req: any, _res: any, next: NextFunction) => {
        if (req._body) return next();
        const raw: string | undefined = req.rawText?.();
        const ct = (req.headers["content-type"] as string) ?? "";
        if (raw && ct.includes("application/x-www-form-urlencoded")) {
            req.body = qs.parse(raw);
            req._body = true;
        } else {
            req.body ??= {};
        }
        next();
    };

/** express.raw() — body as a Buffer (binary upload proxy routes). */
const rawMiddleware =
    (opts?: {
        type?: string | ((req: any) => boolean);
        limit?: string;
    }): RequestHandler =>
    (req: any, _res: any, next: NextFunction) => {
        if (req._body) return next();
        const t = opts?.type ?? "application/octet-stream";
        const ct = ((req.headers["content-type"] as string) ?? "").toLowerCase();
        const matches =
            typeof t === "function" ? !!t(req) : ct.includes(t.toLowerCase());
        if (matches && req._rawBodyBytes !== undefined) {
            req.body = Buffer.from(req._rawBodyBytes);
            req._body = true;
        } else {
            req.body ??= {};
        }
        next();
    };

const staticMiddleware =
    (_dir?: string): RequestHandler =>
    (_req: any, _res: any, next: NextFunction) =>
        next(); // Astro/Workers assets layer serves static files.

function createApplication(): ShimApplication {
    return new ShimApplication();
}

const express = Object.assign(createApplication, {
    Router: () => new ShimRouter(),
    json: jsonMiddleware,
    urlencoded: urlencodedMiddleware,
    raw: rawMiddleware,
    static: staticMiddleware,
    application: ShimApplication,
    request: ShimRequest,
    response: ShimResponse,
});

export const Router = (): ShimRouter => new ShimRouter();
export const json = jsonMiddleware;
export const urlencoded = urlencodedMiddleware;
export const raw = rawMiddleware;
export type Express = ShimApplication;
export type Application = ShimApplication;
export type IRouter = ShimRouter;
export default express;
