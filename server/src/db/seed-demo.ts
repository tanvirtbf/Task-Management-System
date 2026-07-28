/**
 * Demo seed — a coherent, meaningful dataset for BeautyBooth (a Bangladeshi
 * skincare / beauty e-commerce company) so every screen has realistic data.
 *
 *   cd server && npx tsx src/db/seed-demo.ts
 *
 * ⚠️ DESTRUCTIVE: truncates ALL tables in the target DB, then seeds fresh. Runs
 * against DB_NAME (default `taskmanagement`) — back up first if unsure.
 *
 * Logins (all password: Owner@12345):
 *   owner@company.local            — Owner (Founder)
 *   farhana@beautybooth.com.bd     — Admin (Operations)
 *   tanvir@beautybooth.com.bd      — Admin + Engineering Head
 *   nusrat@beautybooth.com.bd      — Marketing Head
 *   rakib@beautybooth.com.bd       — Customer Service Head
 *   sadia@beautybooth.com.bd       — Orders & Fulfillment Head
 *   imran@beautybooth.com.bd       — Product & Inventory Head
 *   mitu@beautybooth.com.bd        — Social Media Head
 *   (+ members: arif, sumaiya, jhankar, priya)
 */
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { initDb, closeDb, getPool } from "./client";
import * as S from "./schema";
import { fakeId } from "../utils";
import logger from "../config/logger";
import { bootstrapRbac } from "../rbac/bootstrap";
import {
    dhakaWeekOf,
    previousWeekStart,
    weekBoundsUtc,
} from "../utils/dhakaTime";

// ─── date helpers ────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOffset = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toLocalDate = (s: string): Date => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
};
const dueOff = (days: number): Date => toLocalDate(ymdOffset(days));

// A Thursday inside the last completed Dhaka week — used to backdate DONE tasks
// + their reviews so the weekly `department-report` job produces real reports.
const LAST_WEEK = previousWeekStart(dhakaWeekOf(new Date()).weekStart);
const LAST_WEEK_INSTANT = new Date(
    weekBoundsUtc(LAST_WEEK).fromUtc.getTime() + 3 * 86_400_000 + 4 * 3_600_000,
);

// name → task id map, populated as tasks are inserted; used by the comment,
// checklist and extra-notification helpers below.
const taskIdByName: Record<string, string> = {};

const seed = async () => {
    const db = await initDb();
    const pool = getPool();
    logger.info("Demo seed starting…");

    // ── 1. wipe everything ───────────────────────────────────────────────────
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    const [tbls] = (await pool.query(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    )) as [{ t: string }[], unknown];
    for (const { t } of tbls) await pool.query(`TRUNCATE TABLE \`${t}\``);
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    logger.info(`Wiped ${tbls.length} tables`);

    // ── 2. workspace ─────────────────────────────────────────────────────────
    const ws = fakeId("ws");
    await db.insert(S.workspaces).values({
        id: ws,
        name: "BeautyBooth",
        timezone: "Asia/Dhaka",
        defaultLocale: "en-US",
    });

    // ── 3. users ─────────────────────────────────────────────────────────────
    const hash = await bcrypt.hash("Owner@12345", 10);
    const people: {
        first: string;
        last: string;
        email: string;
        role: "owner" | "admin" | "member";
    }[] = [
        { first: "Owner", last: "User", email: "owner@company.local", role: "owner" },
        { first: "Farhana", last: "Akter", email: "farhana@beautybooth.com.bd", role: "admin" },
        { first: "Tanvir", last: "Ahmed", email: "tanvir@beautybooth.com.bd", role: "admin" },
        { first: "Nusrat", last: "Jahan", email: "nusrat@beautybooth.com.bd", role: "member" },
        { first: "Rakib", last: "Hasan", email: "rakib@beautybooth.com.bd", role: "member" },
        { first: "Sadia", last: "Islam", email: "sadia@beautybooth.com.bd", role: "member" },
        { first: "Imran", last: "Kabir", email: "imran@beautybooth.com.bd", role: "member" },
        { first: "Mitu", last: "Rahman", email: "mitu@beautybooth.com.bd", role: "member" },
        { first: "Arif", last: "Chowdhury", email: "arif@beautybooth.com.bd", role: "member" },
        { first: "Sumaiya", last: "Haque", email: "sumaiya@beautybooth.com.bd", role: "member" },
        { first: "Jhankar", last: "Mahbub", email: "jhankar@beautybooth.com.bd", role: "member" },
        { first: "Priya", last: "Das", email: "priya@beautybooth.com.bd", role: "member" },
    ];
    const U: string[] = people.map(() => fakeId("u"));
    await db.insert(S.users).values(
        people.map((p, i) => ({
            id: U[i],
            workspaceId: ws,
            firstName: p.first,
            lastName: p.last,
            email: p.email,
            passwordHash: hash,
            role: p.role,
            status: "active" as const,
        })),
    );

    // ── 4. task types ────────────────────────────────────────────────────────
    const TT: Record<string, string> = {};
    const typeDefs: [string, string, string, boolean][] = [
        ["Task", "CheckSquare", "#6B7280", false],
        ["Bug", "Bug", "#EF4444", true],
        ["Feature", "Sparkles", "#8B5CF6", true],
        ["Campaign", "Megaphone", "#F59E0B", false],
        ["Order", "ShoppingBag", "#10B981", false],
        ["Complaint", "MessageCircle", "#EC4899", false],
        ["Incident", "Siren", "#DC2626", true],
    ];
    for (let i = 0; i < typeDefs.length; i++) {
        const [name, icon, color, dev] = typeDefs[i];
        const id = fakeId("tt");
        TT[name] = id;
        await db.insert(S.taskTypes).values({
            id,
            workspaceId: ws,
            name,
            icon,
            color,
            isDevType: dev,
            position: i,
        });
    }

    // ── 5. tags ──────────────────────────────────────────────────────────────
    const TAG: Record<string, string> = {};
    const tagDefs: [string, string][] = [
        ["urgent", "#EF4444"],
        ["vip-customer", "#8B5CF6"],
        ["skincare", "#10B981"],
        ["makeup", "#EC4899"],
        ["eid-2026", "#F59E0B"],
        ["restock", "#0EA5E9"],
        ["high-value", "#6366F1"],
        ["social", "#14B8A6"],
    ];
    for (const [name, color] of tagDefs) {
        const id = fakeId("tag");
        TAG[name] = id;
        await db.insert(S.tags).values({ id, workspaceId: ws, name, color });
    }

    // ── 6. spaces (departments) + heads ──────────────────────────────────────
    // [key, name, icon, color, headIdx]
    const spaceDefs: [string, string, string, string, number][] = [
        ["mkt", "Marketing", "Megaphone", "#F59E0B", 3],
        ["cs", "Customer Service", "Headphones", "#EC4899", 4],
        ["ord", "Orders & Fulfillment", "Package", "#10B981", 5],
        ["prod", "Product & Inventory", "Boxes", "#0EA5E9", 6],
        ["soc", "Social Media & Content", "Instagram", "#8B5CF6", 7],
        ["eng", "Engineering", "Code2", "#4F46E5", 2],
    ];
    const SP: Record<string, string> = {};
    for (let i = 0; i < spaceDefs.length; i++) {
        const [key, name, icon, color, headIdx] = spaceDefs[i];
        const id = fakeId("sp");
        SP[key] = id;
        await db.insert(S.spaces).values({
            id,
            workspaceId: ws,
            name,
            icon,
            color,
            position: i,
            createdBy: U[0],
            headUserId: U[headIdx],
        });
    }

    // ── 7. lists + statuses ──────────────────────────────────────────────────
    // [key, spaceKey, name]
    const listDefs: [string, string, string][] = [
        ["eid", "mkt", "Eid Campaign 2026"],
        ["email", "mkt", "Email & SMS"],
        ["influencer", "mkt", "Influencer Outreach"],
        ["complaints", "cs", "Complaints"],
        ["returns", "cs", "Returns & Refunds"],
        ["orders", "ord", "Daily Orders"],
        ["delivery", "ord", "Delivery Issues"],
        ["launches", "prod", "New Launches"],
        ["stock", "prod", "Stock & Reorder"],
        ["insta", "soc", "Instagram"],
        ["fbads", "soc", "Facebook Ads"],
        ["bugs", "eng", "Bug Triage"],
        ["features", "eng", "Website Features"],
    ];
    const L: Record<string, string> = {};
    // ST[listKey][statusName] = statusId
    const ST: Record<string, Record<string, string>> = {};
    const statusPlan: [
        string,
        "not_started" | "active" | "done" | "closed",
    ][] = [
            ["To Do", "not_started"],
            ["In Progress", "active"],
            ["In Review", "active"],
            ["Done", "done"],
            ["Closed", "closed"],
        ];
    for (const [key, spaceKey, name] of listDefs) {
        const id = fakeId("l");
        L[key] = id;
        ST[key] = {};
        await db.insert(S.lists).values({
            id,
            spaceId: SP[spaceKey],
            name,
            createdBy: U[0],
        });
        for (let p = 0; p < statusPlan.length; p++) {
            const [sName, grp] = statusPlan[p];
            const sid = fakeId("st");
            ST[key][sName] = sid;
            await db.insert(S.statuses).values({
                id: sid,
                scopeType: "list",
                scopeId: id,
                name: sName,
                statusGroup: grp,
                position: p,
            });
        }
    }

    // ── 8. tasks ─────────────────────────────────────────────────────────────
    interface Spec {
        list: string;
        name: string;
        status: string; // status name
        pri?: number; // 0 none,1 urgent,2 high,3 normal
        who?: number[]; // assignee indexes
        due?: number | null; // day offset (negative=overdue)
        done?: boolean; // completed last week
        review?: { st: "approved" | "flagged"; by: number; note?: string };
        type?: string;
        cid?: string;
        tags?: string[];
        desc?: string;
        sprint?: boolean;
        points?: number;
        sev?: "S0" | "S1" | "S2" | "S3";
    }
    const T: Spec[] = [
        // Marketing / Eid
        { list: "eid", name: "Eid Sale banner design (homepage + app)", status: "In Progress", pri: 1, who: [9], due: 2, tags: ["eid-2026"], desc: "Need a hero banner for the homepage and a matching in-app banner for the Eid 25% sale." },
        { list: "eid", name: "Write Eid email campaign copy", status: "In Review", pri: 2, who: [3], due: 1, tags: ["eid-2026"] },
        { list: "eid", name: "Set up 25% Eid discount codes", status: "To Do", pri: 2, who: [9], due: 3, tags: ["eid-2026"] },
        { list: "eid", name: "Approve Eid campaign budget (BDT 2,00,000)", status: "To Do", pri: 1, who: [0], due: 1, type: "Campaign" },
        { list: "eid", name: "Book Facebook ad budget for Eid", status: "To Do", pri: 1, who: [3], due: -1, tags: ["eid-2026"] },
        { list: "eid", name: "Finalize Eid influencer list", status: "Done", who: [9], done: true, review: { st: "approved", by: 3 } },
        // Marketing / Email
        { list: "email", name: "Weekly newsletter — skincare tips", status: "Done", who: [9], done: true, review: { st: "approved", by: 3 } },
        { list: "email", name: "SMS blast for flash sale", status: "In Progress", pri: 3, who: [9], due: 0 },
        { list: "email", name: "A/B test email subject lines", status: "To Do", pri: 3, who: [9], due: 5 },
        { list: "email", name: "Segment inactive customers for win-back", status: "Done", who: [3], done: true },
        // Marketing / Influencer
        { list: "influencer", name: "Reach out to 10 beauty influencers", status: "In Progress", pri: 2, who: [3], due: 4, tags: ["social"] },
        { list: "influencer", name: "Send PR boxes to selected influencers", status: "To Do", pri: 3, who: [9], due: 7 },
        // CS / Complaints
        { list: "complaints", name: "Allergic reaction reported — Vitamin C serum", status: "In Progress", pri: 1, who: [8], due: 0, type: "Complaint", tags: ["urgent", "skincare"], desc: "Customer says they got redness after using the 20% Vitamin C serum. Priority — call today." },
        { list: "complaints", name: "Wrong foundation shade delivered (order #BB-3421)", status: "In Review", pri: 2, who: [8], due: 1, type: "Complaint", tags: ["makeup"] },
        { list: "complaints", name: "Repeated late delivery — VIP customer", status: "To Do", pri: 1, who: [4], due: -2, type: "Complaint", tags: ["vip-customer", "urgent"] },
        { list: "complaints", name: "Damaged sunscreen bottle — refund requested", status: "Done", who: [8], done: true, type: "Complaint", review: { st: "flagged", by: 4, note: "Confirm the refund was actually processed before closing." } },
        { list: "complaints", name: "Product feels different from last batch", status: "Done", who: [8], done: true, type: "Complaint" },
        // CS / Returns
        { list: "returns", name: "Process return — unopened moisturizer set", status: "Done", who: [8], done: true, review: { st: "approved", by: 4 } },
        { list: "returns", name: "Refund stuck — bKash gateway issue", status: "In Progress", pri: 1, who: [8], due: 0, tags: ["urgent"] },
        { list: "returns", name: "Update return policy page copy", status: "To Do", pri: 3, who: [4], due: 6 },
        // Orders / Daily
        { list: "orders", name: "Process 45 COD orders — Dhaka zone", status: "In Progress", pri: 2, who: [11], due: 0, type: "Order" },
        { list: "orders", name: "Verify high-value orders (> BDT 5,000)", status: "In Progress", pri: 2, who: [5], due: 0, type: "Order", tags: ["high-value"] },
        { list: "orders", name: "Pack & label 30 prepaid orders", status: "Done", who: [11], done: true, type: "Order", review: { st: "approved", by: 5 } },
        { list: "orders", name: "Reconcile yesterday's COD collection", status: "Done", who: [5], done: true, type: "Order" },
        // Orders / Delivery
        { list: "delivery", name: "Delivery delayed in Chittagong — follow up with Pathao", status: "In Progress", pri: 1, who: [11], due: -1 },
        { list: "delivery", name: "Lost parcel — order #BB-3390, file claim", status: "To Do", pri: 1, who: [5], due: 0 },
        { list: "delivery", name: "Notify customers of Eid delivery cutoff", status: "To Do", pri: 2, who: [11], due: 2, tags: ["eid-2026"] },
        // Product / Launches
        { list: "launches", name: "Launch Niacinamide 10% serum — coordinate supplier", status: "In Progress", pri: 1, who: [6], due: 3, tags: ["skincare"], desc: "New hero SKU. Coordinate stock, photos, description and the launch post." },
        { list: "launches", name: "Approve Niacinamide serum pricing", status: "To Do", pri: 2, who: [0], due: 2 },
        { list: "launches", name: "Photoshoot for new sunscreen range", status: "To Do", pri: 2, who: [6], due: 5, tags: ["skincare"] },
        { list: "launches", name: "Write product descriptions for 5 new SKUs", status: "In Review", pri: 3, who: [6], due: 1 },
        // Product / Stock
        { list: "stock", name: "Restock sunscreen — only 12 units left", status: "In Progress", pri: 1, who: [6], due: 0, tags: ["restock", "urgent"] },
        { list: "stock", name: "Reorder Vitamin C serum from supplier", status: "Done", who: [6], done: true, tags: ["restock"], review: { st: "approved", by: 6 } },
        { list: "stock", name: "Audit slow-moving inventory", status: "To Do", pri: 3, who: [6], due: 10 },
        // Social / Instagram
        { list: "insta", name: "Post skincare routine reel", status: "Done", who: [7], done: true, tags: ["social"], review: { st: "approved", by: 7 } },
        { list: "insta", name: "Design 5 story templates for Eid", status: "In Progress", pri: 2, who: [7], due: 2, tags: ["eid-2026", "social"] },
        { list: "insta", name: "Schedule this week's grid posts", status: "To Do", pri: 3, who: [9], due: 1, tags: ["social"] },
        // Social / FB Ads
        { list: "fbads", name: "Boost moisturizer ad — target women 25-35 Dhaka", status: "In Progress", pri: 2, who: [7], due: 0, tags: ["social"] },
        { list: "fbads", name: "Review ad spend vs ROAS this week", status: "To Do", pri: 2, who: [7], due: 3 },
        // Engineering / Bugs
        { list: "bugs", name: "Checkout crashes on mobile Safari", status: "In Progress", pri: 1, who: [10], due: -1, type: "Bug", cid: "BUG-1", sev: "S1", tags: ["urgent"], desc: "Steps: add item → checkout on iPhone Safari → white screen. Repro 100%." },
        { list: "bugs", name: "Product images load slowly on 3G", status: "To Do", pri: 2, who: [10], due: 2, type: "Bug", cid: "BUG-2", sev: "S2" },
        { list: "bugs", name: "Cart total wrong when coupon applied", status: "Done", who: [10], done: true, type: "Bug", cid: "BUG-3", sev: "S1", review: { st: "flagged", by: 2, note: "This was a regression — please add a test before closing." } },
        // Engineering / Features
        { list: "features", name: "Add bKash payment integration", status: "In Progress", pri: 1, who: [10], due: 4, type: "Feature", sprint: true, points: 8 },
        { list: "features", name: "Build order tracking page", status: "To Do", pri: 2, who: [10], due: 6, type: "Feature", sprint: true, points: 5 },
        { list: "features", name: "Product review & rating system", status: "To Do", pri: 3, who: [2], due: 14, type: "Feature", points: 13 },
        { list: "features", name: "Wishlist feature", status: "Done", who: [10], done: true, type: "Feature", review: { st: "approved", by: 2 } },
    ];

    // one sprint for Engineering
    const sprintId = fakeId("spr");
    await db.insert(S.sprints).values({
        id: sprintId,
        workspaceId: ws,
        name: "Sprint 12 — Checkout & Payments",
        goal: "Ship bKash payments + fix checkout crashes before Eid rush.",
        startDate: dueOff(-4),
        endDate: dueOff(10),
        status: "active",
        committedPoints: 26,
    });

    const listCounter: Record<string, number> = {};
    // collect reviews + notifications to insert after
    const reviewRows: (typeof S.taskReviews.$inferInsert)[] = [];
    const notifRows: (typeof S.notifications.$inferInsert)[] = [];

    for (const s of T) {
        const listId = L[s.list];
        listCounter[s.list] = (listCounter[s.list] ?? 0) + 1;
        const tid = fakeId("t");
        const typeName = s.type ?? "Task";
        const done = !!s.done;
        await db.insert(S.tasks).values({
            id: tid,
            workspaceId: ws,
            primaryListId: listId,
            taskNumber: listCounter[s.list],
            customId: s.cid ?? null,
            name: s.name,
            description: s.desc ?? null,
            statusId: ST[s.list][s.status],
            priority: s.pri ?? 0,
            taskTypeId: TT[typeName],
            dueDate: s.due === undefined || s.due === null ? null : dueOff(s.due),
            completedAt: done ? LAST_WEEK_INSTANT : null,
            reviewStatus: s.review ? s.review.st : null,
            reviewedAt: s.review ? LAST_WEEK_INSTANT : null,
            reviewedBy: s.review ? U[s.review.by] : null,
            sprintId: s.sprint ? sprintId : null,
            storyPoints: s.points ?? null,
            bugSeverity: s.sev ?? null,
            createdBy: U[0],
        });
        // assignees
        for (const idx of s.who ?? []) {
            await db.insert(S.taskAssignees).values({
                taskId: tid,
                userId: U[idx],
                assignedBy: U[0],
            });
        }
        // tags
        for (const tg of s.tags ?? []) {
            await db.insert(S.taskTags).values({ taskId: tid, tagId: TAG[tg] });
        }
        // review ledger row + denorm + notification to the assignee
        if (s.review) {
            const spaceId = (
                await db
                    .select({ spaceId: S.lists.spaceId })
                    .from(S.lists)
                    .where(eq(S.lists.id, listId))
            )[0].spaceId;
            reviewRows.push({
                id: fakeId("rev"),
                workspaceId: ws,
                spaceId,
                taskId: tid,
                reviewerId: U[s.review.by],
                status: s.review.st,
                note: s.review.note ?? null,
                createdAt: LAST_WEEK_INSTANT,
            });
            const assignee = (s.who ?? [])[0];
            if (assignee !== undefined && assignee !== s.review.by) {
                notifRows.push({
                    id: fakeId("ntf"),
                    userId: U[assignee],
                    type: "task_reviewed",
                    entityType: "task",
                    entityId: tid,
                    actorId: U[s.review.by],
                    title:
                        s.review.st === "flagged"
                            ? `Your task was flagged: ${s.name.slice(0, 60)}`
                            : `Your task was approved: ${s.name.slice(0, 60)}`,
                    body: s.review.note ?? null,
                    isRead: false,
                    createdAt: LAST_WEEK_INSTANT,
                });
            }
        }
        // an assignment notification for the owner's strategic tasks
        if ((s.who ?? []).includes(0)) {
            notifRows.push({
                id: fakeId("ntf"),
                userId: U[0],
                type: "assigned",
                entityType: "task",
                entityId: tid,
                actorId: U[1],
                title: `You were assigned: ${s.name.slice(0, 60)}`,
                body: null,
                isRead: false,
                createdAt: new Date(Date.now() - 3_600_000),
            });
        }
        // stash a few task ids for comments/checklists by name
        taskIdByName[s.name] = tid;
    }
    if (reviewRows.length) await db.insert(S.taskReviews).values(reviewRows);

    // ── 9. comments (triggers keep comments_count) ───────────────────────────
    const comment = async (taskName: string, authorIdx: number, body: string) => {
        const tid = taskIdByName[taskName];
        if (!tid) return;
        await db.insert(S.comments).values({
            id: fakeId("cmt"),
            taskId: tid,
            authorId: U[authorIdx],
            body,
        });
    };
    await comment("Allergic reaction reported — Vitamin C serum", 4, "@Arif please call the customer today and offer a full refund + a note to see a dermatologist. Mark as urgent.");
    await comment("Allergic reaction reported — Vitamin C serum", 8, "Called. Customer is okay now, refund initiated via bKash. Will follow up tomorrow.");
    await comment("Checkout crashes on mobile Safari", 2, "Reproduced on iPhone 12 Safari — looks like a null in the payment callback handler.");
    await comment("Checkout crashes on mobile Safari", 10, "Fix pushed to a branch, testing on staging now.");
    await comment("Restock sunscreen — only 12 units left", 6, "Supplier confirmed — 200 units arriving Thursday. Will update stock then.");
    await comment("Launch Niacinamide 10% serum — coordinate supplier", 6, "Waiting on the final ingredient list from the supplier before we can write the description.");
    await comment("Process 45 COD orders — Dhaka zone", 5, "Great pace today team! Let's clear the backlog before 5pm.");

    // ── 10. checklists ───────────────────────────────────────────────────────
    const checklist = async (
        taskName: string,
        name: string,
        items: [string, boolean][],
    ) => {
        const tid = taskIdByName[taskName];
        if (!tid) return;
        const cid = fakeId("chk");
        await db.insert(S.checklists).values({ id: cid, taskId: tid, name });
        for (let i = 0; i < items.length; i++) {
            const [text, doneItem] = items[i];
            await db.insert(S.checklistItems).values({
                id: fakeId("cki"),
                checklistId: cid,
                text,
                isCompleted: doneItem,
                completedAt: doneItem ? new Date() : null,
                completedBy: doneItem ? U[6] : null,
                position: i,
            });
        }
    };
    await checklist("Launch Niacinamide 10% serum — coordinate supplier", "Launch checklist", [
        ["Supplier stock confirmed", true],
        ["Photoshoot done", false],
        ["Product description written", true],
        ["Listed on website", false],
        ["Announced on social media", false],
    ]);
    await checklist("Eid Sale banner design (homepage + app)", "Design deliverables", [
        ["Homepage hero banner", true],
        ["In-app banner", false],
        ["Email header image", false],
        ["Instagram story template", false],
    ]);
    await checklist("Checkout crashes on mobile Safari", "Fix steps", [
        ["Reproduce the crash", true],
        ["Find root cause", true],
        ["Write the fix", false],
        ["Add a regression test", false],
        ["Deploy to production", false],
    ]);

    // ── 11. extra notifications for a lively inbox ───────────────────────────
    notifRows.push({
        id: fakeId("ntf"),
        userId: U[0],
        type: "mentioned",
        entityType: "task",
        entityId: taskIdByName["Approve Eid campaign budget (BDT 2,00,000)"],
        actorId: U[1],
        title: "Farhana mentioned you in a comment",
        body: "@Owner the budget breakdown is in the task description — need your approval by tomorrow.",
        isRead: false,
        createdAt: new Date(Date.now() - 2 * 3_600_000),
    });
    notifRows.push({
        id: fakeId("ntf"),
        userId: U[3],
        type: "comment",
        entityType: "task",
        entityId: taskIdByName["Write Eid email campaign copy"],
        actorId: U[9],
        title: "New comment on your task",
        body: "Draft is ready for review 🙂",
        isRead: true,
        createdAt: new Date(Date.now() - 5 * 3_600_000),
    });
    if (notifRows.length) await db.insert(S.notifications).values(notifRows);

    // ── 12. on-call (current week → Jhankar) ─────────────────────────────────
    const now = new Date();
    const addDays = (b: Date, d: number) =>
        new Date(b.getFullYear(), b.getMonth(), b.getDate() + d);
    await db.insert(S.onCallShifts).values({
        id: fakeId("ocs"),
        workspaceId: ws,
        weekStart: addDays(now, -3),
        weekEnd: addDays(now, 3),
        engineerId: U[10],
        createdBy: U[2],
    });

    // ── 13. RBAC bootstrap (catalog + system roles + assignments) ────────────
    // Also derives a starting space-membership map from who is assigned tasks,
    // so the demo workspace is ready for an admin to tighten access.
    const rbac = await bootstrapRbac(db, ws);
    logger.info("RBAC bootstrapped", rbac);

    const counts = (await pool.query(
        "SELECT (SELECT COUNT(*) FROM users) u,(SELECT COUNT(*) FROM spaces) s,(SELECT COUNT(*) FROM lists) l,(SELECT COUNT(*) FROM tasks) t,(SELECT COUNT(*) FROM comments) c,(SELECT COUNT(*) FROM checklists) ck,(SELECT COUNT(*) FROM task_reviews) r,(SELECT COUNT(*) FROM notifications) n",
    )) as [Record<string, number>[], unknown];
    logger.info("Demo seed complete", counts[0][0]);
    logger.info(
        "Logins (password Owner@12345): owner@company.local, tanvir@beautybooth.com.bd (eng head), nusrat@beautybooth.com.bd (mkt head), rakib@…, sadia@…, imran@…, mitu@…",
    );
    await closeDb();
    process.exit(0);
};

seed().catch((err: unknown) => {
    logger.error("Demo seed failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
});
