process.env.NODE_ENV = "test";

import { applyTestDbName, provisionTestDb } from "./db";

export default async (): Promise<void> => {
    applyTestDbName();
    await provisionTestDb();
};
