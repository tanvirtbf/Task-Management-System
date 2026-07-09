/**
 * Demo/test data seeder — fills the Turso DB with realistic BeautyBooth data:
 * ~14 users, 6 spaces, 16 lists (+4 statuses each), 12 tags, ~400 tasks
 * (mixed states/priorities/due-dates, subtasks, eng bug fields, sprints),
 * comments, checklists, on-call rotation, notifications, invitations.
 *
 *   npx tsx scripts/seed-demo.ts          (aborts if demo data already exists)
 *   npx tsx scripts/seed-demo.ts --force  (seeds again regardless)
 *
 * Counter columns (comments_count, subtasks_count) are maintained by the DB
 * triggers on insert — the script does not set them manually.
 */
import { config } from "dotenv";
config({ path: ".dev.vars" });

// ─── deterministic RNG ────────────────────────────────────────────────────────
let rngState = 20260709;
const rand = (): number => {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (min: number, max: number): number =>
    Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
    const copy = [...arr];
    const out: T[] = [];
    for (let i = 0; i < n && copy.length > 0; i++) {
        out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    }
    return out;
};
const chance = (p: number): boolean => rand() < p;

const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (n: number): Date => new Date(NOW - n * DAY);
const daysAhead = (n: number): Date => new Date(NOW + n * DAY);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
/** Monday of the week containing d (UTC). */
const mondayOf = (d: Date): Date => {
    const day = d.getUTCDay(); // 0 sun … 6 sat
    const diff = day === 0 ? -6 : 1 - day;
    return new Date(d.getTime() + diff * DAY);
};

const chunk = <T>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

const seed = async () => {
    const force = process.argv.includes("--force");

    const { initDb, closeDb } = await import("../src/server/db/client");
    const { eq } = await import("drizzle-orm");
    const schema = await import("../src/server/db/schema");
    const { fakeId, sha256, randomToken } = await import("../src/server/utils");
    const { CredentialService } = await import(
        "../src/server/services/CredentialService"
    );

    const db = await initDb();

    // ── preconditions: base workspace + owner + task types from db:seed ──────
    const [ws] = await db.select().from(schema.workspaces).limit(1);
    if (!ws) throw new Error("No workspace — run `npm run db:seed` first.");
    const [owner] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, "owner@company.local"))
        .limit(1);
    if (!owner) throw new Error("No owner — run `npm run db:seed` first.");
    const taskTypes = await db.select().from(schema.taskTypes);
    const typeByName = (n: string) =>
        taskTypes.find((t) => t.name.toLowerCase() === n.toLowerCase()) ??
        taskTypes[0];

    const already = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, "nusrat@beautybooth.com.bd"))
        .limit(1);
    if (already.length > 0 && !force) {
        console.log("Demo data already seeded — use --force to add again.");
        await closeDb();
        return;
    }

    const wsId = ws.id;
    console.log(`Seeding demo data into workspace ${ws.name} (${wsId})…`);

    // ── 1. users (14) ─────────────────────────────────────────────────────────
    const credentialService = new CredentialService();
    const passwordHash = await credentialService.hashPassword("Test@12345");
    const PEOPLE: Array<[string, string, "admin" | "member"]> = [
        ["Nusrat", "Jahan", "admin"],
        ["Rakib", "Hasan", "admin"],
        ["Mim", "Akter", "member"],
        ["Sabbir", "Rahman", "member"],
        ["Farhana", "Islam", "member"],
        ["Tanjil", "Hossain", "member"],
        ["Sadia", "Sultana", "member"],
        ["Imran", "Kabir", "member"],
        ["Jannatul", "Ferdous", "member"],
        ["Mehedi", "Hasan", "member"],
        ["Ayesha", "Siddika", "member"],
        ["Shakil", "Khan", "member"],
        ["Rumana", "Akter", "member"],
        ["Fahim", "Chowdhury", "member"],
    ];
    const users = PEOPLE.map(([firstName, lastName, role]) => ({
        id: fakeId("u"),
        workspaceId: wsId,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}@beautybooth.com.bd`,
        passwordHash,
        role,
        status: "active" as const,
        lastLoginAt: chance(0.7) ? daysAgo(randInt(0, 10)) : null,
        createdAt: daysAgo(randInt(30, 90)),
    }));
    await db.insert(schema.users).values(users);
    const allUsers = [owner, ...users];
    const engUsers = users.slice(9); // Mehedi, Ayesha, Shakil, Rumana, Fahim
    console.log(`users: ${users.length}`);

    // ── 2. spaces (6) ─────────────────────────────────────────────────────────
    const SPACES: Array<[string, string, string]> = [
        ["Orders & Fulfillment", "ShoppingBag", "#10B981"],
        ["Customer Support", "Headphones", "#3B82F6"],
        ["Inventory", "Package", "#F59E0B"],
        ["Product Listings", "Tag", "#8B5CF6"],
        ["Marketing", "Megaphone", "#EC4899"],
        ["Engineering", "Code", "#6366F1"],
    ];
    const spaces = SPACES.map(([name, icon, color], i) => ({
        id: fakeId("sp"),
        workspaceId: wsId,
        name,
        icon,
        color,
        position: i + 1,
        createdBy: owner.id,
        createdAt: daysAgo(80),
    }));
    await db.insert(schema.spaces).values(spaces);
    console.log(`spaces: ${spaces.length}`);

    // ── 3. lists (16) ─────────────────────────────────────────────────────────
    const LISTS: Array<[number, string, string]> = [
        [0, "Order Issues", "AlertCircle"],
        [0, "Deliveries", "Truck"],
        [0, "Returns & Refunds", "RotateCcw"],
        [1, "Complaints", "MessageCircle"],
        [1, "Callbacks", "Phone"],
        [1, "Reviews Follow-up", "Star"],
        [2, "Restock Requests", "PackagePlus"],
        [2, "Stock Audits", "ClipboardList"],
        [3, "New Products", "Sparkles"],
        [3, "Content Fixes", "Pencil"],
        [4, "Campaigns", "Rocket"],
        [4, "Influencer Collabs", "Users"],
        [4, "Creative Requests", "Palette"],
        [5, "Bugs", "Bug"],
        [5, "Features", "Zap"],
        [5, "Tech Debt", "Wrench"],
    ];
    const lists = LISTS.map(([spaceIdx, name, icon], i) => ({
        id: fakeId("l"),
        spaceId: spaces[spaceIdx].id,
        name,
        icon,
        position: i,
        createdBy: owner.id,
        createdAt: daysAgo(75),
    }));
    await db.insert(schema.lists).values(lists);
    console.log(`lists: ${lists.length}`);

    // ── 4. statuses (4 per list) ──────────────────────────────────────────────
    const STATUS_DEFS: Array<[string, string, "not_started" | "active" | "done"]> = [
        ["To Do", "#6B7280", "not_started"],
        ["In Progress", "#3B82F6", "active"],
        ["Review", "#F59E0B", "active"],
        ["Done", "#10B981", "done"],
    ];
    const statusesByList = new Map<string, { id: string; group: string }[]>();
    const statusRows = lists.flatMap((l) =>
        STATUS_DEFS.map(([name, color, statusGroup], i) => {
            const row = {
                id: fakeId("st"),
                scopeType: "list" as const,
                scopeId: l.id,
                name,
                color,
                statusGroup,
                position: i,
            };
            const arr = statusesByList.get(l.id) ?? [];
            arr.push({ id: row.id, group: statusGroup });
            statusesByList.set(l.id, arr);
            return row;
        }),
    );
    for (const c of chunk(statusRows, 40)) {
        await db.insert(schema.statuses).values(c);
    }
    console.log(`statuses: ${statusRows.length}`);

    // ── 5. tags (12) ──────────────────────────────────────────────────────────
    const TAGS: Array<[string, string]> = [
        ["urgent", "#EF4444"],
        ["vip-customer", "#F59E0B"],
        ["cod-issue", "#8B5CF6"],
        ["damaged", "#DC2626"],
        ["refund", "#0EA5E9"],
        ["restock", "#10B981"],
        ["eid-campaign", "#EC4899"],
        ["facebook", "#2563EB"],
        ["website", "#6366F1"],
        ["app", "#14B8A6"],
        ["payment", "#F97316"],
        ["courier", "#64748B"],
    ];
    const tags = TAGS.map(([name, color]) => ({
        id: fakeId("tag"),
        workspaceId: wsId,
        name,
        color,
    }));
    await db.insert(schema.tags).values(tags);
    console.log(`tags: ${tags.length}`);

    // ── 6. sprints (3, one active) ────────────────────────────────────────────
    const sprints = [
        {
            id: fakeId("spr"),
            workspaceId: wsId,
            name: "Sprint 12",
            goal: "Checkout bug bash + courier API",
            startDate: iso(daysAgo(35)),
            endDate: iso(daysAgo(22)),
            status: "closed" as const,
            committedPoints: 34,
        },
        {
            id: fakeId("spr"),
            workspaceId: wsId,
            name: "Sprint 13",
            goal: "Inventory sync + payment retries",
            startDate: iso(daysAgo(21)),
            endDate: iso(daysAgo(8)),
            status: "closed" as const,
            committedPoints: 29,
        },
        {
            id: fakeId("spr"),
            workspaceId: wsId,
            name: "Sprint 14",
            goal: "Eid campaign readiness + app crash fixes",
            startDate: iso(daysAgo(7)),
            endDate: iso(daysAhead(6)),
            status: "active" as const,
            committedPoints: 31,
        },
    ];
    await db.insert(schema.sprints).values(sprints);
    console.log(`sprints: ${sprints.length}`);

    // ── 7. tasks (~400) ───────────────────────────────────────────────────────
    const NAME_POOLS: Record<string, string[]> = {
        "Order Issues": [
            "Order #%N stuck in processing",
            "Wrong shade shipped for order #%N",
            "Order #%N — customer paid twice via bKash",
            "Missing free gift in order #%N",
            "Address change request for order #%N",
            "Order #%N flagged for fraud review",
        ],
        Deliveries: [
            "Pathao pickup pending — batch %N",
            "RedX delivery failed twice — order #%N",
            "Courier reconciliation for %M",
            "Same-day delivery escalation #%N",
            "Steadfast return manifest %N",
        ],
        "Returns & Refunds": [
            "Refund for damaged serum — order #%N",
            "Return pickup not scheduled #%N",
            "Partial refund approval — order #%N",
            "Exchange request: cleanser 100ml → 200ml #%N",
        ],
        Complaints: [
            "Allergic reaction complaint — ticket #%N",
            "Late delivery complaint — order #%N",
            "Fake product accusation on FB post #%N",
            "Wrong billing amount — ticket #%N",
            "Rude delivery rider report #%N",
            "Package opened complaint — order #%N",
        ],
        Callbacks: [
            "Callback: VIP customer about routine #%N",
            "Callback: bulk order inquiry #%N",
            "Callback: reseller partnership #%N",
        ],
        "Reviews Follow-up": [
            "1-star review response — product %N",
            "Follow up 5-star reviewer for UGC #%N",
            "Daraz review dispute #%N",
        ],
        "Restock Requests": [
            "Restock: Vitamin C serum (%N units)",
            "Restock: sunscreen SPF50 (%N units)",
            "Restock: rose water toner (%N units)",
            "Low stock alert: niacinamide %N%",
        ],
        "Stock Audits": [
            "Monthly stock audit — %M",
            "Damaged stock write-off batch %N",
            "Expiry check: Q3 skincare lot %N",
        ],
        "New Products": [
            "List new Korean sheet mask set #%N",
            "Photoshoot for lip tint collection %N",
            "Price research: competitor serum %N",
            "Ingredient translation for SKU %N",
        ],
        "Content Fixes": [
            "Fix wrong ingredients on SKU %N",
            "Update size chart for product %N",
            "Rewrite description — flagged SKU %N",
        ],
        Campaigns: [
            "Eid flash sale landing page",
            "11.11 mega campaign plan",
            "Payday sale creatives batch %N",
            "Free delivery weekend promo %N",
            "Skincare quiz funnel v%N",
        ],
        "Influencer Collabs": [
            "Brief for influencer collab #%N",
            "Product seeding box — batch %N",
            "Collab contract review #%N",
        ],
        "Creative Requests": [
            "Reels edit for product launch %N",
            "Static ads set — campaign %N",
            "Thumbnail refresh for YT video %N",
        ],
        Bugs: [
            "Checkout fails with bKash on iOS — #%N",
            "Cart total wrong with stacked coupons #%N",
            "OTP SMS not delivered on GP numbers #%N",
            "Product images 404 after CDN purge #%N",
            "Search returns empty for Bangla queries #%N",
            "Double order created on slow 3G retry #%N",
        ],
        Features: [
            "Wishlist share via WhatsApp",
            "COD partial advance payment flow",
            "Loyalty points redemption v%N",
            "Order tracking page redesign",
            "Auto-suggest routine builder v%N",
        ],
        "Tech Debt": [
            "Upgrade payment SDK to v%N",
            "Remove legacy jQuery from checkout",
            "Add indexes to slow order queries #%N",
            "Split monolith cron worker %N",
        ],
    };
    const MONTHS = ["May 2026", "June 2026", "July 2026"];
    const fillName = (tpl: string): string =>
        tpl
            .replace("%N", String(randInt(1000, 9999)))
            .replace("%M", pick(MONTHS));

    const DESCRIPTIONS = [
        "Reported via Facebook page inbox. Customer is waiting for an update.",
        "Escalated from the support hotline; see call notes in the thread.",
        "Needs to be resolved before the weekend campaign goes live.",
        "Blocked on a reply from the courier's merchant panel.",
        "Repeat issue — third time this month, consider a process fix.",
        null,
        null,
        null,
    ];

    const bugType = typeByName("Bug");
    const featureType = typeByName("Feature");
    const taskType = typeByName("Task");
    const complaintType = typeByName("Complaint");
    const orderType = typeByName("Order");
    const campaignType = typeByName("Campaign");
    const typeForList = (listName: string) => {
        if (listName === "Bugs") return bugType;
        if (listName === "Features" || listName === "Tech Debt") return featureType;
        if (listName === "Complaints") return complaintType;
        if (listName.startsWith("Order") || listName === "Deliveries" || listName === "Returns & Refunds") return orderType;
        if (listName === "Campaigns" || listName === "Influencer Collabs" || listName === "Creative Requests") return campaignType;
        return taskType;
    };

    // per-list volumes → ~400 total
    const VOLUME: Record<string, number> = {
        "Order Issues": 48,
        Deliveries: 30,
        "Returns & Refunds": 28,
        Complaints: 44,
        Callbacks: 16,
        "Reviews Follow-up": 14,
        "Restock Requests": 22,
        "Stock Audits": 10,
        "New Products": 24,
        "Content Fixes": 16,
        Campaigns: 22,
        "Influencer Collabs": 12,
        "Creative Requests": 16,
        Bugs: 46,
        Features: 30,
        "Tech Debt": 18,
    };

    type TaskRow = typeof schema.tasks.$inferInsert;
    const taskRows: TaskRow[] = [];
    const subtaskRows: TaskRow[] = [];
    const engTaskIds: string[] = [];
    const allTaskIds: string[] = [];
    const doneTaskIds = new Set<string>();

    for (const l of lists) {
        const pool = NAME_POOLS[l.name] ?? ["Task %N"];
        const sts = statusesByList.get(l.id)!;
        const stTodo = sts[0].id;
        const stProg = sts[1].id;
        const stReview = sts[2].id;
        const stDone = sts[3].id;
        const isEng = ["Bugs", "Features", "Tech Debt"].includes(l.name);
        let taskNumber = 0;
        const count = VOLUME[l.name] ?? 20;

        for (let i = 0; i < count; i++) {
            taskNumber += 1;
            const id = fakeId("t");
            const createdAt = daysAgo(randInt(0, 60));
            // state mix: 30% done / 42% todo / 22% in-progress / 6% review
            const roll = rand();
            const statusId =
                roll < 0.3 ? stDone : roll < 0.72 ? stTodo : roll < 0.94 ? stProg : stReview;
            const isDone = statusId === stDone;
            if (isDone) doneTaskIds.add(id);

            // due dates: 15% overdue / 10% today / 35% upcoming / 40% none
            let dueDate: string | null = null;
            const dr = rand();
            if (!isDone) {
                if (dr < 0.15) dueDate = iso(daysAgo(randInt(1, 12)));
                else if (dr < 0.25) dueDate = iso(new Date(NOW));
                else if (dr < 0.6) dueDate = iso(daysAhead(randInt(1, 21)));
            } else if (dr < 0.5) {
                dueDate = iso(daysAgo(randInt(2, 30)));
            }

            const slaDueAt =
                !isDone && chance(0.06)
                    ? chance(0.5)
                        ? new Date(NOW - randInt(1, 48) * 3_600_000) // breached
                        : new Date(NOW + randInt(4, 72) * 3_600_000)
                    : null;

            // ck_tasks_dates: start_date <= due_date — derive start FROM due
            // when a due date exists, else a free-standing past date.
            const startDate = chance(0.25)
                ? dueDate
                    ? iso(new Date(new Date(dueDate).getTime() - randInt(1, 14) * DAY))
                    : iso(daysAgo(randInt(1, 20)))
                : null;

            const type = typeForList(l.name);
            const row: TaskRow = {
                id,
                workspaceId: wsId,
                primaryListId: l.id,
                taskNumber,
                name: fillName(pick(pool)),
                description: pick(DESCRIPTIONS),
                statusId,
                priority: pick([1, 2, 2, 3, 3, 3, 4] as const),
                taskTypeId: type.id,
                startDate,
                dueDate,
                completedAt: isDone ? daysAgo(randInt(0, 20)) : null,
                slaDueAt,
                createdBy: pick(allUsers).id,
                createdAt,
            };
            if (isEng) {
                engTaskIds.push(id);
                row.storyPoints = pick([1, 2, 3, 5, 8] as const);
                if (l.name === "Bugs") {
                    row.bugSeverity = pick(["S0", "S1", "S2", "S2", "S3", "S3"] as const);
                    row.bugReproducibility = pick(["always", "sometimes", "once"] as const);
                    row.bugEnvironment = pick(["production", "production", "staging"] as const);
                    row.reporterTeam = pick(["ops", "cs", "inventory", "marketing", "internal"] as const);
                }
                // last two sprints get most non-done eng work
                if (chance(0.55)) {
                    row.sprintId = isDone ? pick(sprints).id : pick([sprints[1], sprints[2], sprints[2]]).id;
                }
            }
            taskRows.push(row);
            allTaskIds.push(id);

            // ~8% get 1-2 subtasks
            if (chance(0.08)) {
                const nSubs = randInt(1, 2);
                for (let s = 0; s < nSubs; s++) {
                    taskNumber += 1;
                    const subId = fakeId("t");
                    const subDone = chance(0.4);
                    if (subDone) doneTaskIds.add(subId);
                    subtaskRows.push({
                        id: subId,
                        workspaceId: wsId,
                        primaryListId: l.id,
                        taskNumber,
                        name: pick([
                            "Call the customer",
                            "Verify payment trail",
                            "Update the tracker sheet",
                            "Collect photos as proof",
                            "Confirm with courier hub",
                            "QA on staging",
                            "Write test cases",
                        ]),
                        statusId: subDone ? stDone : stTodo,
                        priority: 3,
                        taskTypeId: type.id,
                        parentTaskId: id,
                        nestingDepth: 1,
                        completedAt: subDone ? daysAgo(randInt(0, 10)) : null,
                        createdBy: pick(allUsers).id,
                        createdAt,
                    });
                    allTaskIds.push(subId);
                }
            }
        }
    }

    // parents first (subtask trigger bumps parent counters on child insert)
    for (const c of chunk(taskRows, 30)) await db.insert(schema.tasks).values(c);
    for (const c of chunk(subtaskRows, 30)) await db.insert(schema.tasks).values(c);
    console.log(`tasks: ${taskRows.length} + ${subtaskRows.length} subtasks`);

    // ── 8. assignees / watchers / tags ────────────────────────────────────────
    const assigneeRows: (typeof schema.taskAssignees.$inferInsert)[] = [];
    const watcherRows: (typeof schema.taskWatchers.$inferInsert)[] = [];
    const tagRows: (typeof schema.taskTags.$inferInsert)[] = [];
    for (const t of [...taskRows, ...subtaskRows]) {
        const nAssignees = pick([0, 1, 1, 1, 2] as const);
        for (const u of pickN(allUsers, nAssignees)) {
            assigneeRows.push({
                taskId: t.id,
                userId: u.id,
                assignedBy: owner.id,
            });
        }
        for (const u of pickN(allUsers, chance(0.25) ? randInt(1, 2) : 0)) {
            watcherRows.push({ taskId: t.id, userId: u.id });
        }
        const nTags = pick([0, 0, 1, 1, 2, 3] as const);
        for (const tg of pickN(tags, nTags)) {
            tagRows.push({ taskId: t.id, tagId: tg.id });
        }
    }
    for (const c of chunk(assigneeRows, 60)) await db.insert(schema.taskAssignees).values(c);
    for (const c of chunk(watcherRows, 60)) await db.insert(schema.taskWatchers).values(c);
    for (const c of chunk(tagRows, 60)) await db.insert(schema.taskTags).values(c);
    console.log(
        `assignees: ${assigneeRows.length}, watchers: ${watcherRows.length}, task-tags: ${tagRows.length}`,
    );

    // ── 9. comments (~90; triggers bump comments_count) ──────────────────────
    const COMMENT_BODIES = [
        "Customer called again — please prioritize.",
        "Talked to the courier hub, pickup rescheduled to tomorrow.",
        "Refund initiated from the bKash merchant panel.",
        "Waiting on a screenshot from the customer.",
        "Duplicate of an earlier ticket, merging the threads.",
        "Stock arrived at the warehouse, updating counts now.",
        "Creative draft attached in the shared drive.",
        "Fixed on staging, needs QA before deploy.",
        "This keeps happening for GP numbers only, checking with the SMS vendor.",
        "Approved. Ship it.",
        "Adding this to the sprint board for this week.",
        "Customer confirmed the replacement arrived. Closing.",
    ];
    const commentRows: (typeof schema.comments.$inferInsert)[] = [];
    for (let i = 0; i < 90; i++) {
        commentRows.push({
            id: fakeId("c"),
            taskId: pick(allTaskIds),
            authorId: pick(allUsers).id,
            body: pick(COMMENT_BODIES),
            createdAt: daysAgo(randInt(0, 25)),
        });
    }
    for (const c of chunk(commentRows, 40)) await db.insert(schema.comments).values(c);
    console.log(`comments: ${commentRows.length}`);

    // ── 10. checklists (~25 + items) ──────────────────────────────────────────
    const CHECKLIST_ITEMS = [
        "Verify order details",
        "Contact the customer",
        "Update the tracker",
        "Get manager approval",
        "Confirm with courier",
        "Attach proof photos",
        "Post-resolution follow-up",
    ];
    const checklistRows: (typeof schema.checklists.$inferInsert)[] = [];
    const itemRows: (typeof schema.checklistItems.$inferInsert)[] = [];
    for (const taskId of pickN(allTaskIds, 25)) {
        const clId = fakeId("ch");
        checklistRows.push({
            id: clId,
            taskId,
            name: pick(["Resolution steps", "QC checklist", "Launch checklist"]),
            position: 0,
        });
        const items = pickN(CHECKLIST_ITEMS, randInt(2, 4));
        items.forEach((text, idx) => {
            const isCompleted = chance(0.45);
            const completer = pick(allUsers).id;
            itemRows.push({
                id: fakeId("chi"),
                checklistId: clId,
                text,
                isCompleted,
                completedAt: isCompleted ? daysAgo(randInt(0, 7)) : null,
                completedBy: isCompleted ? completer : null,
                assigneeId: chance(0.4) ? pick(allUsers).id : null,
                position: idx,
            });
        });
    }
    await db.insert(schema.checklists).values(checklistRows);
    for (const c of chunk(itemRows, 40)) await db.insert(schema.checklistItems).values(c);
    console.log(`checklists: ${checklistRows.length}, items: ${itemRows.length}`);

    // ── 11. on-call rotation (4 weeks around now) ─────────────────────────────
    const thisMonday = mondayOf(new Date(NOW));
    const onCallRows = [-1, 0, 1, 2].map((w, i) => {
        const start = new Date(thisMonday.getTime() + w * 7 * DAY);
        return {
            id: fakeId("ocs"),
            workspaceId: wsId,
            weekStart: iso(start),
            weekEnd: iso(new Date(start.getTime() + 6 * DAY)),
            engineerId: engUsers[i % engUsers.length].id,
            createdBy: owner.id,
        };
    });
    await db.insert(schema.onCallShifts).values(onCallRows);
    console.log(`on-call shifts: ${onCallRows.length}`);

    // ── 12. notifications (~45, mostly for the owner) ─────────────────────────
    const notifRows: (typeof schema.notifications.$inferInsert)[] = [];
    for (let i = 0; i < 45; i++) {
        const forOwner = chance(0.6);
        const target = forOwner ? owner : pick(users);
        const actor = pick(allUsers.filter((u) => u.id !== target.id));
        const taskId = pick(allTaskIds);
        const kind = pick([
            "assigned",
            "assigned",
            "comment",
            "comment",
            "mentioned",
            "status_change",
            "due_soon",
            "overdue",
        ] as const);
        const titles: Record<string, string> = {
            assigned: `${actor.firstName} assigned you a task`,
            comment: `${actor.firstName} commented on a task`,
            mentioned: `${actor.firstName} mentioned you in a comment`,
            status_change: `A task you watch changed status`,
            due_soon: `A task is due soon`,
            overdue: `A task is overdue`,
        };
        notifRows.push({
            id: fakeId("n"),
            userId: target.id,
            type: kind,
            entityType: "task",
            entityId: taskId,
            actorId: actor.id,
            title: titles[kind],
            body: null,
            isRead: chance(0.35),
            createdAt: daysAgo(randInt(0, 14)),
        });
    }
    for (const c of chunk(notifRows, 40)) await db.insert(schema.notifications).values(c);
    console.log(`notifications: ${notifRows.length}`);

    // ── 13. pending invitations (2) ───────────────────────────────────────────
    await db.insert(schema.invitations).values(
        ["hr@beautybooth.com.bd", "finance@beautybooth.com.bd"].map((email) => ({
            id: fakeId("inv"),
            workspaceId: wsId,
            email,
            role: "member" as const,
            tokenHash: sha256(randomToken()),
            invitedBy: owner.id,
            expiresAt: daysAhead(7),
        })),
    );
    console.log("invitations: 2");

    const total =
        users.length + spaces.length + lists.length + statusRows.length +
        tags.length + sprints.length + taskRows.length + subtaskRows.length +
        assigneeRows.length + watcherRows.length + tagRows.length +
        commentRows.length + checklistRows.length + itemRows.length +
        onCallRows.length + notifRows.length + 2;
    console.log(`\nDONE — ${total} rows seeded.`);
    console.log("Demo users all log in with password: Test@12345");
    await closeDb();
};

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Demo seed failed:", err);
        process.exit(1);
    });
