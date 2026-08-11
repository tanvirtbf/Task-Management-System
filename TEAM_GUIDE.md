# টিম অ্যাক্সেস গাইড — অ্যাডমিন ও টিম হেডদের জন্য

**BeautyBooth Tasks · team-access P1–P9 (2026-08-11) · অ্যাপ্লিকেশন যেভাবে এখন কাজ করে**

এই গাইডটা অফিসের দুইটা চাওয়া থেকে এসেছে:

1. **যার টিম, সে শুধু তার টিমের কাজ দেখবে** — অন্য টিমের কাজ দেখতে হলে পারমিশন লাগবে, আর অন্য টিমের কাউকে কাজ দিতে হলে তার সম্মতি লাগবে।
2. **কে কী change করেছে সেটা সবাই দেখতে পারবে** — আর task edit করতে পারবে শুধু assignee-রা, task-এর creator, এবং টিমের Head।

---

## ১. টিম মানে কী?

- **টিম = Space (ডিপার্টমেন্ট)।** Marketing, Customer Service, Engineering — প্রতিটা Space-ই একটা টিম।
- **টিমের সদস্য হওয়া মানে** সেই Space-এ একটা role থাকা। Teams পেজ থেকে add/remove করলেই হয় — আলাদা কোনো members টেবিল নেই।
- প্রত্যেকের একটা **home team** থাকে (প্রোফাইলে যেটা দেখায়)। কেউ চাইলে একাধিক টিমেও থাকতে পারে (যেমন সুমাইয়া — Marketing + Social Media)।

## ২. টিম চালানো (অ্যাডমিন / হেড)

**Settings → Teams** পেজ থেকে:

| কাজ | কে পারে | কীভাবে |
|---|---|---|
| নতুন টিম বানানো | অ্যাডমিন | নতুন Space বানালেই নতুন টিম |
| Head বসানো | অ্যাডমিন | Space-এর সেটিংসে `head_user_id` — Head বসালে সে অটোমেটিক টিমের member-ও হয়ে যায় |
| Member যোগ করা | অ্যাডমিন, সেই টিমের Head | Teams পেজে টিমের পাশে **Add member** |
| Member বাদ দেওয়া | অ্যাডমিন, সেই টিমের Head | Member-এর পাশের ✕ — বর্তমান Head-কে বাদ দেওয়া যায় না (আগে নতুন Head বসান) |
| Home team বদলানো | অ্যাডমিন | Members পেজ বা Teams পেজ থেকে |
| Invite করা | অ্যাডমিন | Invite ফর্মে **টিম বাছাই করা বাধ্যতামূলক** — টিম ছাড়া invite করলে নতুন মানুষ ঢুকে খালি অ্যাপ দেখবে |

> ⚠️ **টিম ছাড়া member = কিছুই দেখে না।** কেউ "আমি কিছু দেখছি না" বললে প্রথমে Teams পেজে দেখুন তার কোনো টিম আছে কি না।

## ৩. কে কী দেখে?

- **Member / Guest**: শুধু নিজের টিমের Space, list, task। অন্য টিমের কিছুই দেখে না — এমনকি সেটা আছে কি না তাও বোঝা যায় না।
- **Owner / Admin**: সবকিছু (আগের মতোই)।
- **এক টিম আরেক টিমকে দেখা (sight grant)**: অ্যাডমিন Teams পেজ থেকে দিতে পারেন — "Supply Chain can also see Software"। এটা **শুধু দেখা** — edit/assign এর অধিকার এতে আসে না। এক ধাপই যায় (A→B দিলে B-এর নিজের grant গুলো A পায় না)।
- **Cross-team assignee**: অন্য টিমের কোনো task-এ আপনি assigned হলে **সেই task টা** আপনি সব জায়গা থেকে দেখবেন (Inbox, My Work, search, লিংক) — কিন্তু ওই টিমের list browse করতে পারবেন না। লিংকে ক্লিক করলে task টা নিজেই খুলে যায়।

## ৪. কে edit করতে পারে? (R2.2)

একটা task **edit / archive / delete** করতে পারে শুধু:

1. **Assignee** (task-এ assigned যারা)
2. **Creator** (যে task টা বানিয়েছে)
3. **সেই টিমের Head** — assigned না থাকলেও নিজের ডিপার্টমেন্টের সব task
4. Owner / Admin

বাকি সবাই task **দেখতে ও comment করতে** পারবে (আলোচনা খোলা), কিন্তু কিছু বদলাতে পারবে না — drawer-এ 🔒 **View only** লেখা দেখবে। Checklist, attachment, custom field, dependency, tag — সব একই নিয়মে ("task-এর content বদলানো মানেই edit")।

**Audit log**: প্রতিটা task-এর drawer-এর নিচে **Activity** — কে, কখন, কী change করেছে (আগের মান → নতুন মান সহ)। কিছুই লুকানো নেই।

## ৫. অন্য টিমের কাউকে কাজ দেওয়া (Approval flow — R1.4/R1.5)

**নিয়ম**: assignee যদি task-এর মালিক টিমের member না হয় → assignment সাথে সাথে হয় না, একটা **request** তৈরি হয়।

```
আপনি assign করলেন  ──►  Request (pending)  ──►  সে Accept করলে ──► তখন সত্যিই assigned
                              │
                              ├── Decline করতে পারে (কারণসহ)
                              └── Query করতে পারে: "আমার ২ দিন বেশি লাগবে"
                                       │
                                       └── আপনি Answer দেবেন (চাইলে due date-ও বদলে) → তারপর সে Accept
```

- **কে Accept/Decline/Query করতে পারে**: যাকে চাওয়া হয়েছে সে নিজে, **তার টিমের Head**, বা অ্যাডমিন। **যে চেয়েছে সে কখনো না** — চাওয়া মানেই সম্মতি না।
- **কোথায় দেখবেন**: Inbox-এর **Requests** ট্যাব (নিজের + Head হলে টিমের সবগুলো) আর task-এর drawer-এ **Assignment approval** প্যানেল। ইমেইল আর push-ও যায়।
- **Assign করার আগেই সতর্কতা**: assignee picker-এ cross-team কাউকে বাছলে কমলা রঙে লেখা আসে — *"Cross-team — will need X's approval"*।
- **৭ দিনে মেয়াদ শেষ**: কেউ সাড়া না দিলে request নিজে নিজে expire হয় আর যে চেয়েছিল সে জানতে পারে। আবার চাওয়া যায়।
- **একই টিমের ভিতরে** assignment আগের মতোই সাথে সাথে — কোনো approval লাগে না।
- **S0/S1 incident**: on-call ইঞ্জিনিয়ার auto-assign হয় approval ছাড়াই — emergency page কারো সম্মতির জন্য বসে থাকে না।
- Bulk assign করলে টুলবার সত্যি কথা বলে: *"Updated 12 tasks — 3 assignments waiting for approval"*।

## ৬. সাধারণ প্রশ্ন

**"আমি একটা টিমের কিছুই দেখছি না"** — আপনি ওই টিমের member না। অ্যাডমিন/Head-কে বলুন Teams পেজ থেকে add করতে, অথবা আপনার টিমকে sight grant দিতে।

**"Task-এ ঢুকতে গেলে বলছে access নেই"** — হয় task টা অন্য টিমের (আপনার pending request থাকলে আগে Inbox থেকে Accept করুন), নয়তো আপনাকে unassign করা হয়েছে।

**"Edit করতে পারছি না"** — আপনি ওই task-এর assignee/creator/টিম-Head নন। দরকার হলে assignee-কে বা Head-কে বলুন।

**"Assign করলাম কিন্তু হলো না"** — cross-team ছিল; request গেছে। Drawer-এর Assignment approval প্যানেলে বা আপনার Inbox → Requests (sent) এ অবস্থা দেখুন।

**"Request-এর টাস্ক টা খুলতে পারছি না"** — ঠিক তাই; Accept করার **আগে** task টা আপনার না। Request কার্ডেই নাম/টিম/due date দেখে সিদ্ধান্ত দিন — Accept করলেই খুলবে।

---

*ডেমো ডেটায় (db:seed:demo) এই পুরো মডেলটা চালু অবস্থায় seeded থাকে — ৬টা টিম, সব Head, সদস্যরা, আর নুসরাত→ঝংকার একটা pending cross-team request (query সহ) যাতে প্রথম লগইনেই সব দেখা যায়। টেকনিক্যাল বিস্তারিত: `TEAM_ACCESS_AND_AUDIT_PLAN.md` + `API_DESIGN.md` §34।*
