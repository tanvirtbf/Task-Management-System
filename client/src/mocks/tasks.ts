import type { Priority, Task } from "../types";
import { statusesByList } from "./statuses";
import { engTasks } from "./eng-tasks";

/**
 * Generates 250+ realistic tasks for a Bangladesh eCommerce company.
 * Tasks are created at module load — deterministic given a fixed seed
 * via a custom PRNG so refreshes show stable data.
 */

// Seeded PRNG (Mulberry32) so data stays consistent across reloads
let _seed = 20260526;
const random = () => {
    let t = (_seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
    const copy = [...arr];
    const out: T[] = [];
    for (let i = 0; i < Math.min(n, copy.length); i++) {
        const idx = Math.floor(random() * copy.length);
        out.push(copy.splice(idx, 1)[0]);
    }
    return out;
};
const chance = (p: number) => random() < p;

// ─────────────────────────────────────────────────────────
// Data pools
// ─────────────────────────────────────────────────────────
const firstNames = [
    "Rahim", "Karim", "Salma", "Fatima", "Rashida", "Mohammad", "Abdullah",
    "Sumaiya", "Tania", "Mukti", "Habib", "Nasir", "Jahanara", "Shahidul",
    "Ruma", "Anwar", "Lutfa", "Mizan", "Selina", "Tofazzal", "Roksana",
    "Mahbub", "Shabnam", "Iqbal", "Sufia", "Nazmul", "Tahmina", "Aminul",
    "Shahnaz", "Jahangir", "Rabeya", "Mostafa", "Khairul", "Rina", "Sayma",
];
const lastNames = [
    "Uddin", "Hossain", "Begum", "Akter", "Khan", "Rahman", "Ahmed",
    "Chowdhury", "Sheikh", "Ali", "Sultana", "Karim", "Mia", "Khatun",
    "Islam", "Jahan",
];
const products = [
    "Celeste Vitamin C Serum", "Aloe Vera Soothing Gel",
    "Niacinamide 10% Serum", "Hyaluronic Acid Toner",
    "Retinol Night Cream", "Glow Face Mask", "Sunscreen SPF 50",
    "Honey Lip Balm", "Rosewater Mist", "Argan Hair Oil",
    "Coconut Body Butter", "Charcoal Face Wash", "Green Tea Cleanser",
    "Tea Tree Spot Treatment", "Saffron Brightening Cream",
    "Squalane Face Oil", "Bakuchiol Serum", "Centella Calming Gel",
    "Peptide Eye Cream", "AHA/BHA Exfoliating Toner",
];
const issueTypes = [
    "Wrong Item", "Damaged Package", "Late Delivery", "Refund Request",
    "Missing Item", "Quality Issue", "Other",
] as const;
const channels = ["Facebook", "Phone", "Website", "Courier"] as const;
const platforms = ["Facebook", "Instagram", "Website", "Email"] as const;
const contentTypes = ["Image", "Video", "Reel", "Offer", "Blog"] as const;
const campaigns = ["Eid", "Pohela Boishakh", "11.11", "Weekend Offer", "Regular"] as const;

const userIds = [
    "u-001", "u-002", "u-003", "u-004", "u-005", "u-006",
    "u-007", "u-008", "u-009", "u-010", "u-011",
];
// Role-specific user pools for realistic assignment
const opsTeam = ["u-002", "u-004", "u-005", "u-006"]; // admin + ops members
const supportTeam = ["u-007", "u-008"];
const listingTeam = ["u-009", "u-010"];
const marketingTeam = ["u-003", "u-011"];

const fullName = () => `${pick(firstNames)} ${pick(lastNames)}`;
const isoNow = () => new Date().toISOString();

const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
};
const daysFromNow = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString();
};

let _seq = 1000;
const seq = () => ++_seq;

// ─────────────────────────────────────────────────────────
// Status weighting per list (realistic distribution)
// ─────────────────────────────────────────────────────────
const pickStatus = (listId: string): string => {
    const s = statusesByList(listId);
    // Weight active statuses higher than closed
    const weights = s.map((st, i) => {
        if (st.statusGroup === "closed") return 1;
        if (st.statusGroup === "done") return 2;
        if (i === 0) return 3; // first status (e.g., "New")
        return 5;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = random() * total;
    for (let i = 0; i < s.length; i++) {
        r -= weights[i];
        if (r <= 0) return s[i].id;
    }
    return s[s.length - 1].id;
};

const pickPriority = (): Priority => {
    const r = random();
    if (r < 0.05) return 1; // Urgent 5%
    if (r < 0.20) return 2; // High 15%
    if (r < 0.75) return 3; // Normal 55%
    if (r < 0.90) return 4; // Low 15%
    return 0; // None 10%
};

const randomTaskDates = (statusGroup: string) => {
    if (statusGroup === "closed" || statusGroup === "done") {
        return {
            startDate: daysAgo(Math.floor(random() * 14) + 7),
            dueDate: daysAgo(Math.floor(random() * 7)),
            completedAt: daysAgo(Math.floor(random() * 7)),
        };
    }
    if (chance(0.65)) {
        // Has dates
        const offset = Math.floor(random() * 14) - 4;
        return {
            startDate: daysAgo(Math.floor(random() * 5)),
            dueDate: offset >= 0 ? daysFromNow(offset) : daysAgo(-offset),
            completedAt: null,
        };
    }
    return { startDate: null, dueDate: null, completedAt: null };
};

// ─────────────────────────────────────────────────────────
// Per-list generators
// ─────────────────────────────────────────────────────────

function generateOrderTask(listId: string, _idx: number, isFb: boolean): Task {
    const taskNumber = seq();
    const statusId = pickStatus(listId);
    const status = statusesByList(listId).find((s) => s.id === statusId)!;
    const dates = randomTaskDates(status.statusGroup);
    const customer = fullName();

    return {
        id: `t-${taskNumber}`,
        taskNumber,
        customId: `ORD-${taskNumber}`,
        name: `#${taskNumber} — ${customer}`,
        statusId,
        priority: pickPriority(),
        taskTypeId: "tt-order",
        primaryListId: listId,
        parentTaskId: null,
        isMilestone: false,
        startDate: dates.startDate,
        dueDate: dates.dueDate,
        timeEstimateSeconds: chance(0.3) ? 3600 : null,
        timeTrackedSeconds: Math.floor(random() * 3600),
        assignees: pickN(opsTeam, chance(0.6) ? 1 : 2),
        watchers: pickN(userIds, 2),
        tags: [
            isFb ? "tag-first-order" : "tag-returning",
            ...(chance(0.1) ? ["tag-urgent"] : []),
            ...(chance(0.08) ? ["tag-vip"] : []),
        ].filter(Boolean) as string[],
        customFields: {},
        subtasksCount: chance(0.4) ? Math.floor(random() * 4) + 1 : 0,
        subtasksCompleted: 0,
        commentsCount: Math.floor(random() * 4),
        attachmentsCount: chance(0.3) ? Math.floor(random() * 3) : 0,
        createdAt: daysAgo(Math.floor(random() * 21)),
        updatedAt: daysAgo(Math.floor(random() * 3)),
        createdBy: pick(opsTeam),
        completedAt: dates.completedAt,
        archivedAt: null,
        nestingDepth: 0,
    };
}

function generateComplaintTask(idx: number): Task {
    const taskNumber = seq();
    const statusId = pickStatus("l-complaints");
    const status = statusesByList("l-complaints").find((s) => s.id === statusId)!;
    const customer = fullName();
    return {
        id: `t-${taskNumber}`,
        taskNumber,
        customId: `CMP-${taskNumber}`,
        name: `${pick(issueTypes)} — ${customer}`,
        statusId,
        priority: chance(0.3) ? 1 : 2,
        taskTypeId: "tt-complaint",
        primaryListId: "l-complaints",
        parentTaskId: null,
        isMilestone: false,
        startDate: null,
        dueDate: daysFromNow(Math.floor(random() * 5) - 2),
        timeEstimateSeconds: null,
        timeTrackedSeconds: Math.floor(random() * 1800),
        assignees: pickN(supportTeam, 1),
        watchers: ["u-001", ...pickN(supportTeam, 1)],
        tags: pickN(["tag-damaged", "tag-late-delivery", "tag-wrong-item", "tag-replacement"], 1),
        customFields: {
            cf_order_number: { text: `ORD-${1000 + Math.floor(random() * 1000)}` },
            cf_issue_type: { option_id: pick(issueTypes) },
            cf_channel: { option_id: pick(channels) },
            cf_resolution: {
                text:
                    status.statusGroup === "done"
                        ? "Customer satisfied. Replacement sent."
                        : "",
            },
        },
        subtasksCount: 0,
        subtasksCompleted: 0,
        commentsCount: Math.floor(random() * 5),
        attachmentsCount: chance(0.4) ? 1 : 0,
        createdAt: daysAgo(Math.floor(random() * 14)),
        updatedAt: daysAgo(Math.floor(random() * 3)),
        createdBy: pick(supportTeam),
        completedAt: status.statusGroup === "done" || status.statusGroup === "closed" ? daysAgo(Math.floor(random() * 5)) : null,
        archivedAt: null,
        nestingDepth: 0,
    };
}

function generateProductTask(idx: number): Task {
    const taskNumber = seq();
    const product = products[idx % products.length] + " — Restock";
    const statusId = pickStatus("l-new-products");
    return {
        id: `t-${taskNumber}`,
        taskNumber,
        name: product,
        statusId,
        priority: pickPriority(),
        taskTypeId: "tt-product",
        primaryListId: "l-new-products",
        parentTaskId: null,
        isMilestone: false,
        startDate: daysAgo(7),
        dueDate: daysFromNow(Math.floor(random() * 14)),
        timeEstimateSeconds: 7200,
        timeTrackedSeconds: Math.floor(random() * 3600),
        assignees: pickN(listingTeam, 1),
        watchers: ["u-001", ...listingTeam],
        tags: ["tag-new-arrival"],
        customFields: {
            cf_product_sku: { text: `SKU-${2000 + idx}` },
            cf_category: { option_id: "Skincare" },
        },
        subtasksCount: 4,
        subtasksCompleted: Math.floor(random() * 4),
        commentsCount: Math.floor(random() * 3),
        attachmentsCount: Math.floor(random() * 5),
        createdAt: daysAgo(Math.floor(random() * 30)),
        updatedAt: daysAgo(Math.floor(random() * 5)),
        createdBy: pick(listingTeam),
        completedAt: null,
        archivedAt: null,
        nestingDepth: 0,
    };
}

function generateContentTask(idx: number): Task {
    const taskNumber = seq();
    const campaign = pick(campaigns);
    const platform = pick(platforms);
    const contentType = pick(contentTypes);
    const statusId = pickStatus("l-content");
    return {
        id: `t-${taskNumber}`,
        taskNumber,
        name: `${platform} ${contentType} — ${campaign}`,
        statusId,
        priority: pickPriority(),
        taskTypeId: "tt-task",
        primaryListId: "l-content",
        parentTaskId: null,
        isMilestone: false,
        startDate: daysAgo(3),
        dueDate: daysFromNow(Math.floor(random() * 14) - 3),
        timeEstimateSeconds: 3600,
        timeTrackedSeconds: Math.floor(random() * 1800),
        assignees: pickN(marketingTeam, 1),
        watchers: marketingTeam,
        tags: campaign === "Eid" ? ["tag-eid"] : campaign === "11.11" ? ["tag-1111"] : campaign === "Pohela Boishakh" ? ["tag-boishakh"] : ["tag-weekend"],
        customFields: {
            cf_platform: { option_id: platform },
            cf_content_type: { option_id: contentType },
            cf_campaign: { option_id: campaign },
            cf_publish_date: { date: daysFromNow(Math.floor(random() * 14)) },
            cf_designer: { user_ids: pickN(listingTeam, 1) },
            cf_boost_budget: {
                amount: chance(0.4) ? 200000 : 0,
                currency: "BDT",
            },
        },
        subtasksCount: chance(0.5) ? 3 : 0,
        subtasksCompleted: 0,
        commentsCount: Math.floor(random() * 3),
        attachmentsCount: chance(0.5) ? Math.floor(random() * 4) + 1 : 0,
        createdAt: daysAgo(Math.floor(random() * 14)),
        updatedAt: daysAgo(Math.floor(random() * 2)),
        createdBy: pick(marketingTeam),
        completedAt: null,
        archivedAt: null,
        nestingDepth: 0,
    };
}

function generateGenericTask(
    listId: string,
    title: string,
    team: string[],
    taskTypeId = "tt-task",
): Task {
    const taskNumber = seq();
    const statusId = pickStatus(listId);
    const status = statusesByList(listId).find((s) => s.id === statusId)!;
    const dates = randomTaskDates(status.statusGroup);
    return {
        id: `t-${taskNumber}`,
        taskNumber,
        name: title,
        statusId,
        priority: pickPriority(),
        taskTypeId,
        primaryListId: listId,
        parentTaskId: null,
        isMilestone: false,
        startDate: dates.startDate,
        dueDate: dates.dueDate,
        timeEstimateSeconds: chance(0.4) ? 3600 : null,
        timeTrackedSeconds: Math.floor(random() * 1800),
        assignees: pickN(team, 1),
        watchers: pickN(userIds, 2),
        tags: [],
        customFields: {},
        subtasksCount: chance(0.2) ? Math.floor(random() * 3) + 1 : 0,
        subtasksCompleted: 0,
        commentsCount: Math.floor(random() * 3),
        attachmentsCount: 0,
        createdAt: daysAgo(Math.floor(random() * 14)),
        updatedAt: daysAgo(Math.floor(random() * 5)),
        createdBy: pick(team),
        completedAt: dates.completedAt,
        archivedAt: null,
        nestingDepth: 0,
    };
}

// ─────────────────────────────────────────────────────────
// Build full task list
// ─────────────────────────────────────────────────────────
const generated: Task[] = [];

// Facebook Orders — 80
for (let i = 0; i < 80; i++) {
    generated.push(generateOrderTask("l-fb-orders", i, true));
}

// Website Orders — 60
for (let i = 0; i < 60; i++) {
    generated.push(generateOrderTask("l-web-orders", i, false));
}

// Returns — 15
for (let i = 0; i < 15; i++) {
    const taskNumber = seq();
    const statusId = pickStatus("l-returns");
    const customer = fullName();
    generated.push({
        id: `t-${taskNumber}`,
        taskNumber,
        customId: `RET-${taskNumber}`,
        name: `Return #${taskNumber} — ${customer}`,
        statusId,
        priority: 2,
        taskTypeId: "tt-return",
        primaryListId: "l-returns",
        parentTaskId: null,
        isMilestone: false,
        startDate: null,
        dueDate: daysFromNow(Math.floor(random() * 7)),
        timeEstimateSeconds: null,
        timeTrackedSeconds: 0,
        assignees: pickN(opsTeam, 1),
        watchers: ["u-001"],
        tags: ["tag-damaged"],
        customFields: {
            cf_return_order_number: { text: `ORD-${1000 + Math.floor(random() * 1000)}` },
            cf_return_reason: { text: pick(issueTypes) },
        },
        subtasksCount: 0,
        subtasksCompleted: 0,
        commentsCount: Math.floor(random() * 2),
        attachmentsCount: 1,
        createdAt: daysAgo(Math.floor(random() * 10)),
        updatedAt: daysAgo(Math.floor(random() * 3)),
        createdBy: pick(opsTeam),
        completedAt: null,
        archivedAt: null,
        nestingDepth: 0,
    });
}

// Daily Operations — 10
const dailyOpsTasks = [
    "Morning order confirmation calls",
    "Update tracking IDs in spreadsheet",
    "Reconcile yesterday's COD with courier",
    "Review return requests",
    "Pack & dispatch confirmed orders",
    "Send daily report to management",
    "Update Facebook page status",
    "Process refund queue",
    "Check courier pickup schedule",
    "Customer follow-up calls",
];
for (const title of dailyOpsTasks) {
    generated.push(generateGenericTask("l-daily-ops", title, opsTeam));
}

// Purchase Orders — 10
const poTitles = [
    "Reorder Aloe Vera Gel (200 units)",
    "Reorder Sunscreen SPF 50 (150 units)",
    "Reorder Vitamin C Serum (100 units)",
    "Bulk order — Retinol Cream",
    "Niacinamide Serum restock",
    "Hyaluronic Toner bulk",
    "Charcoal Face Wash refill",
    "Tea Tree Spot Treatment",
    "Argan Oil reorder",
    "Coconut Body Butter",
];
for (const t of poTitles) {
    generated.push(generateGenericTask("l-po", t, ["u-006"]));
}

// Damaged Stock — 5
for (let i = 0; i < 5; i++) {
    generated.push(generateGenericTask("l-damaged", `Damaged batch — ${pick(products)}`, ["u-006"]));
}

// Complaints — 25
for (let i = 0; i < 25; i++) {
    generated.push(generateComplaintTask(i));
}

// Queries — 10
for (let i = 0; i < 10; i++) {
    generated.push(
        generateGenericTask("l-queries", `Customer query — ${fullName()}`, supportTeam),
    );
}

// New Product Pipeline — 15
for (let i = 0; i < 15; i++) {
    generated.push(generateProductTask(i));
}

// Photo Shoots — 5
for (let i = 0; i < 5; i++) {
    generated.push(
        generateGenericTask(
            "l-photo-shoots",
            `${pick(products)} — Photo shoot`,
            listingTeam,
        ),
    );
}

// Content Calendar — 25
for (let i = 0; i < 25; i++) {
    generated.push(generateContentTask(i));
}

// Active Campaigns — 5
const activeCampaigns = [
    "Eid Festival Launch 2026",
    "Summer Glow Collection",
    "Skincare Routine Bundle",
    "11.11 Mega Sale Prep",
    "Influencer Outreach Q2",
];
for (const t of activeCampaigns) {
    generated.push(generateGenericTask("l-campaigns", t, marketingTeam, "tt-campaign"));
}

// Boost Manager — 8
for (let i = 0; i < 8; i++) {
    generated.push(
        generateGenericTask("l-boost", `Boost — ${pick(products)} Post`, marketingTeam),
    );
}

export const tasks: Task[] = [...generated, ...engTasks];

export const tasksById = new Map(tasks.map((t) => [t.id, t]));
export const tasksByList = (listId: string) =>
    tasks.filter((t) => t.primaryListId === listId && !t.archivedAt);
