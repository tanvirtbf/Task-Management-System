/**
 * Random delay to make mock API feel realistic.
 * Default: 100ms–400ms.
 */
export const delay = (min = 100, max = 400): Promise<void> =>
    new Promise((resolve) =>
        setTimeout(resolve, min + Math.random() * (max - min)),
    );

/**
 * Force a specific delay (e.g., simulating slow network for testing).
 */
export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
