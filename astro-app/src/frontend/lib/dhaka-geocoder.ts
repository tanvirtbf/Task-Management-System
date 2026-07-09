/**
 * Dhaka & Bangladesh neighborhood → lat/lng lookup.
 * Used to convert mock address strings into map coordinates.
 */

export interface GeoPoint {
    lat: number;
    lng: number;
}

const lookup: Record<string, GeoPoint> = {
    // Dhaka
    mirpur: { lat: 23.8223, lng: 90.3654 },
    "mirpur 10": { lat: 23.8076, lng: 90.3683 },
    "mirpur dohs": { lat: 23.8345, lng: 90.3686 },
    dhanmondi: { lat: 23.745, lng: 90.3742 },
    uttara: { lat: 23.8758, lng: 90.3795 },
    "uttara sector 7": { lat: 23.8742, lng: 90.3854 },
    "bashundhara r/a": { lat: 23.8221, lng: 90.4288 },
    bashundhara: { lat: 23.8221, lng: 90.4288 },
    gulshan: { lat: 23.7925, lng: 90.4078 },
    "gulshan 2": { lat: 23.7935, lng: 90.4143 },
    mohammadpur: { lat: 23.766, lng: 90.359 },
    banani: { lat: 23.7937, lng: 90.4066 },
    tejgaon: { lat: 23.7596, lng: 90.4015 },
    wari: { lat: 23.717, lng: 90.4137 },
    lalbagh: { lat: 23.7188, lng: 90.3879 },
    khilkhet: { lat: 23.829, lng: 90.4163 },
    "mohakhali dohs": { lat: 23.7805, lng: 90.405 },
    mohakhali: { lat: 23.7805, lng: 90.405 },
    badda: { lat: 23.7796, lng: 90.4244 },
    rampura: { lat: 23.7651, lng: 90.4226 },
    motijheel: { lat: 23.7332, lng: 90.4172 },
    farmgate: { lat: 23.7561, lng: 90.3895 },

    // Outside Dhaka
    chattogram: { lat: 22.3569, lng: 91.7832 },
    sylhet: { lat: 24.8949, lng: 91.8687 },
    khulna: { lat: 22.8456, lng: 89.5403 },
    rajshahi: { lat: 24.3745, lng: 88.6042 },
    barishal: { lat: 22.701, lng: 90.3535 },
    rangpur: { lat: 25.7439, lng: 89.2752 },
    comilla: { lat: 23.4607, lng: 91.1809 },
    mymensingh: { lat: 24.7471, lng: 90.4203 },
    narayanganj: { lat: 23.6238, lng: 90.5 },
    gazipur: { lat: 23.9999, lng: 90.4203 },
    bogra: { lat: 24.8466, lng: 89.3776 },
    jessore: { lat: 23.1685, lng: 89.2072 },
};

/**
 * Resolve a free-text address to lat/lng using simple prefix/substring match.
 * Returns null if no match.
 */
export const geocodeAddress = (address: string): GeoPoint | null => {
    const lower = address.toLowerCase();

    // Try direct match first
    for (const [key, point] of Object.entries(lookup)) {
        if (lower.includes(key)) {
            // Add a small jitter (±0.005 deg ~ 500m) so pins at the same address
            // don't overlap perfectly.
            const jitter = () => (Math.random() - 0.5) * 0.01;
            return {
                lat: point.lat + jitter(),
                lng: point.lng + jitter(),
            };
        }
    }
    return null;
};

export const DHAKA_CENTER: GeoPoint = { lat: 23.8103, lng: 90.4125 };
