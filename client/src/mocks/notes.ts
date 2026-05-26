import type { Note } from "../types/note";

const now = "2025-09-15T08:00:00Z";

export const notes: Note[] = [
    {
        id: "note-001",
        userId: "u-001",
        title: "Festival campaign brief",
        body: `## Festival campaign 2025

**Goal:** Drive 40% MoM sales lift during Eid-ul-Fitr week.

### Key messages
- Premium quality at home delivery
- 24-hour same-day delivery in Dhaka
- Cash on delivery available

### Channels
- Facebook (primary) — boost from 5th
- Instagram reels — 3 per day
- Direct email to top 500 buyers

### Stuck on
- Need photographer confirmed for the shoot
- Pricing model not finalized — review with Rahim`,
        isPinned: true,
        color: "#F59E0B",
        createdAt: "2025-09-10T09:30:00Z",
        updatedAt: "2025-09-14T15:20:00Z",
    },
    {
        id: "note-002",
        userId: "u-001",
        title: "Vendor call notes — Chittagong dried fish",
        body: `**Call with Karim (Chittagong Cold Storage), 11 Sep 2025**

- Can supply 200kg/week of premium dried hilsa
- Lead time: 3 days from order
- Pricing: 1,400 BDT/kg (10% bulk discount above 100kg)
- Payment terms: 50% advance, 50% on delivery
- Quality: Grade A only, no broken pieces

### Action items
- Send sample order request by Thursday
- Verify trade license + food safety cert
- Negotiate exclusive contract for premium SKUs

### Concerns
- Single supplier risk — explore one backup`,
        isPinned: true,
        color: "#10B981",
        createdAt: "2025-09-11T11:00:00Z",
        updatedAt: "2025-09-11T11:45:00Z",
    },
    {
        id: "note-003",
        userId: "u-001",
        title: "Weekly team standup template",
        body: `## Weekly standup — Mondays 10am

Each person, 2 minutes max:

1. **Wins** — what shipped/closed last week
2. **Focus** — top 3 priorities this week
3. **Blockers** — anything I need help with

### Round-robin order
- Ops
- CS
- Marketing
- Listing
- Inventory

### After standup
- Update the Operations dashboard
- Post recap in #general`,
        isPinned: false,
        color: "#4F46E5",
        createdAt: "2025-08-20T08:00:00Z",
        updatedAt: "2025-09-01T08:00:00Z",
    },
    {
        id: "note-004",
        userId: "u-001",
        title: "Books to read",
        body: `## Reading list

- *The Lean Startup* — Eric Ries
- *Crossing the Chasm* — Geoffrey Moore
- *High Output Management* — Andy Grove
- *Shoe Dog* — Phil Knight
- *Built to Last* — Jim Collins

Currently reading: High Output Management — chapter 4`,
        isPinned: false,
        color: "#8B5CF6",
        createdAt: "2025-07-15T20:00:00Z",
        updatedAt: "2025-09-05T22:30:00Z",
    },
    {
        id: "note-005",
        userId: "u-001",
        title: "Office WiFi password",
        body: `**Network:** ShutkiHut-Office
**Password:** \`shutki@2025#secure\`

**Guest network:** ShutkiHut-Guest (no password)

Router admin: 192.168.1.1`,
        isPinned: false,
        color: "#06B6D4",
        createdAt: "2025-06-01T10:00:00Z",
        updatedAt: "2025-06-01T10:00:00Z",
    },
    {
        id: "note-006",
        userId: "u-001",
        title: "Q4 hiring plan",
        body: `## Hiring for Oct–Dec 2025

### Open roles
1. **Customer Support Lead** — replace Saima who is moving on
2. **Photographer** — full-time, for in-house shoots
3. **Junior packer** — peak season backup
4. **Marketing coordinator** — handle festival campaigns

### Budget
- ~210k BDT/month additional payroll
- Approved by board on 8 Sep

### Process owner
Tanvir handles JDs + interviews. Final approval with founders.`,
        isPinned: false,
        color: "#E11D48",
        createdAt: "2025-09-08T14:00:00Z",
        updatedAt: "2025-09-13T16:00:00Z",
    },
    {
        id: "note-007",
        userId: "u-001",
        title: "Random ideas",
        body: `Just braindump — review later

- Loyalty program: 10% credit back after 5 orders
- "Customer of the month" feature on FB
- Mystery box subscription — 1500 BDT/month
- Cold-call top 50 restaurants for B2B supply
- Collab with food bloggers for unboxing videos`,
        isPinned: false,
        createdAt: "2025-09-14T22:15:00Z",
        updatedAt: "2025-09-14T22:15:00Z",
    },
    {
        id: "note-008",
        userId: "u-007",
        title: "Common complaints log",
        body: `Tracking patterns in customer complaints:

### Top 3 issues (last 30d)
1. Late delivery (47%) — outside Dhaka mostly
2. Packaging damage (23%) — fix bubble wrap process
3. Wrong product (12%) — needs better picking QC

### Repeat complainants
- Order #ORD-4231 — 3rd complaint, escalate
- Mrs. Salma — 2 returns this month

### Resolution time SLA
- Target: 24 hours
- Actual avg: 38 hours (need improvement)`,
        isPinned: true,
        color: "#E11D48",
        createdAt: "2025-09-12T10:00:00Z",
        updatedAt: "2025-09-15T07:00:00Z",
    },
];

export const notesById = new Map(notes.map((n) => [n.id, n]));

export const notesByUser = (userId: string): Note[] =>
    notes
        .filter((n) => n.userId === userId)
        .sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return b.updatedAt.localeCompare(a.updatedAt);
        });
