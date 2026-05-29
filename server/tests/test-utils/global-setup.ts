process.env.NODE_ENV = "test";

import { provisionTestDb } from "./db";

export default async (): Promise<void> => {
    await provisionTestDb();
};
