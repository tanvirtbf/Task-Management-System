import { LoadingState } from "./LoadingState";

/**
 * Suspense fallback for lazy-loaded routes. Theme-aware, full-area.
 */
export const RouteFallback = () => <LoadingState minHeight="60vh" />;
