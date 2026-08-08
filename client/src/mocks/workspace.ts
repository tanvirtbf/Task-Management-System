import type { Workspace } from "../types";

export const workspace: Workspace = {
  id: "ws-main",
  name: "BeautyBooth",
  logoUrl: null,
  settings: {
    timezone: "Asia/Dhaka",
    defaultLocale: "en",
    weekStartsOn: 6, // Saturday (Bangladesh week start)
    workingDays: [0, 1, 2, 3, 4], // Sun–Thu
    businessHours: { start: "09:00", end: "18:00" },
  },
};
