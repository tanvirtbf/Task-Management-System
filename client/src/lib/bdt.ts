/**
 * BDT (৳) money formatting helpers.
 *
 * Amounts are stored as integer "paisa" (i.e. 100x taka) to avoid floating
 * point. Inputs to these helpers may be either taka or paisa — see each
 * function.
 */

const SYMBOL = "৳";

/** Format a taka amount with thousands separators. e.g. 1234.5 → ৳1,234.50 */
export const formatBdt = (taka: number, withDecimals = true): string => {
    if (!Number.isFinite(taka)) return `${SYMBOL}0`;
    const fixed = withDecimals ? taka.toFixed(2) : Math.round(taka).toString();
    return `${SYMBOL}${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
};

/** Compact lakh / crore display for KPI cards. */
export const formatBdtCompact = (taka: number): string => {
    if (!Number.isFinite(taka)) return `${SYMBOL}0`;
    if (taka >= 10_000_000) return `${SYMBOL}${(taka / 10_000_000).toFixed(2)} Cr`;
    if (taka >= 100_000) return `${SYMBOL}${(taka / 100_000).toFixed(2)} L`;
    if (taka >= 1_000) return `${SYMBOL}${(taka / 1_000).toFixed(1)}k`;
    return `${SYMBOL}${Math.round(taka)}`;
};

export const paisaToTaka = (paisa: number) => paisa / 100;
export const takaToPaisa = (taka: number) => Math.round(taka * 100);
