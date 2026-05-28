/**
 * Bangladesh mobile-number utilities.
 *
 * Operator prefix range is 01[3-9] (Robi/Airtel/Banglalink/Grameenphone/
 * Teletalk). Total length is 11 digits including the leading 0.
 */

const BD_REGEX = /^01[3-9]\d{8}$/;

export const isValidBdPhone = (raw: string): boolean => {
    const digits = raw.replace(/\D/g, "");
    return BD_REGEX.test(digits);
};

export const normaliseBdPhone = (raw: string): string =>
    raw.replace(/\D/g, "").replace(/^88/, "").replace(/^0+/, "0");

export const formatBdPhone = (raw: string): string => {
    const d = normaliseBdPhone(raw);
    if (!isValidBdPhone(d)) return raw;
    return `+880 ${d.slice(1, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};

export const telHref = (raw: string): string => {
    const d = normaliseBdPhone(raw);
    return isValidBdPhone(d) ? `tel:+88${d}` : `tel:${raw}`;
};
