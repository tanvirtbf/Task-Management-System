/**
 * Generate a UUID v4. Uses `crypto.randomUUID()` natively (supported in all
 * modern browsers + Node 19+). Falls back to a non-crypto polyfill if not.
 */
export const fakeId = (): string => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    // Fallback (low entropy — only used in non-secure contexts)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

/**
 * Generate a short numeric ID (e.g., task numbers).
 */
let counter = 1000;
export const fakeSeq = (): number => ++counter;
