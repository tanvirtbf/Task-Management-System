import type { Comment } from "../types/extras";
import { tasks } from "./tasks";

const minutesAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 1000).toISOString();
const hoursAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

// Seed deterministic comments for ~30% of tasks (those that had commentsCount > 0)
const sampleBodies = [
    "Confirmed with customer over phone. Address verified.",
    "Customer requested earlier delivery if possible.",
    "@karim Please pack this with care — fragile items inside.",
    "Courier pickup scheduled for 11 AM tomorrow.",
    "Customer wants to add another item to this order. Should I create a new task?",
    "Tracking ID updated. Awaiting confirmation from RedX.",
    "Customer paid via bKash — moving to prepaid.",
    "Need approval to issue refund of full order value.",
    "Photos attached. Let me know if any retouching is needed.",
    "I'll follow up tomorrow morning if no response by EOD.",
    "Tagged as VIP. Personal call from manager required.",
    "Replacement product is in stock. Dispatching today.",
    "Customer agreed to exchange instead of refund.",
    "Marked as urgent — same-day delivery promised.",
];
const sampleAuthors = [
    "u-001",
    "u-002",
    "u-003",
    "u-004",
    "u-005",
    "u-006",
    "u-007",
];

let _seed = 99;
const rng = () => {
    _seed = (_seed * 1664525 + 1013904223) % 4294967296;
    return _seed / 4294967296;
};
const pick = <T>(a: readonly T[]) => a[Math.floor(rng() * a.length)];

export const comments: Comment[] = [];

for (const task of tasks) {
    if (task.commentsCount === 0) continue;
    const count = Math.min(task.commentsCount, 4);
    for (let i = 0; i < count; i++) {
        comments.push({
            id: `c-${task.id}-${i}`,
            taskId: task.id,
            parentCommentId: null,
            authorId: pick(sampleAuthors),
            body: pick(sampleBodies),
            assignedTo: null,
            resolvedAt: null,
            resolvedBy: null,
            editedAt: null,
            deletedAt: null,
            reactions:
                rng() > 0.7
                    ? [
                          {
                              emoji: pick(["👍", "✅", "🔥", "❤️", "👀"]),
                              userIds: [pick(sampleAuthors)],
                          },
                      ]
                    : [],
            createdAt: rng() > 0.5 ? hoursAgo(rng() * 24) : minutesAgo(rng() * 60),
        });
    }
}

export const commentsByTask = (taskId: string) =>
    comments
        .filter((c) => c.taskId === taskId && !c.deletedAt)
        .sort(
            (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
        );
