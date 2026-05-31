import { Config } from "../../src/config";

/**
 * Pin the §27 SSE suite to its private database in the test runtime, and shrink
 * the SSE cadences so a heartbeat / live notification is observable in ~100ms
 * instead of the production 30s / 3s. Loaded FIRST in `setupFilesAfterEnv` (the
 * SSE controller reads these directly from `process.env` at request time, so
 * they take effect before the app's first request). See `global-setup-sse.ts`.
 */
Config.DB_NAME = "tms_sse_test";
process.env.SSE_HEARTBEAT_MS = "50";
process.env.SSE_POLL_MS = "40";
