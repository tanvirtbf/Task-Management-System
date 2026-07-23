import { Navigate, useSearchParams } from "react-router-dom";
import { Alert, Empty, Select, Spin } from "antd";
import { UserCheck } from "lucide-react";
import { useSpaces } from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import type { ReviewQueueBucket, Space } from "../../types";
import { DeptSummary } from "./DeptSummary";
import { DeptQueue } from "./DeptQueue";
import { QUEUE_BUCKETS } from "./buckets";

/**
 * Dept Review V1 — "My Department" (plan P13 shell; P14 adds the summary
 * tiles + member rollup, P15 the review queue).
 *
 * Access: department heads see their OWN live departments; owner/admin may
 * open any live space's department view. Everyone else bounces home (the
 * server enforces the same gate on every A-2/A-3 call — this is UX, not
 * security). The selected department rides the `?space=` search param so the
 * view is deep-linkable (P17/P30 browser flows).
 */
const DepartmentPage = () => {
    const me = useAuthStore((s) => s.user);
    const { data: spaces = [], isLoading, isError } = useSpaces();
    const [searchParams, setSearchParams] = useSearchParams();

    const isAdmin = me?.role === "owner" || me?.role === "admin";
    const live = spaces.filter((s) => !s.archivedAt);
    const headed = live.filter((s) => s.headUserId === me?.id);
    const available: Space[] = isAdmin ? live : headed;
    const canSee = isAdmin || headed.length > 0;

    if (isLoading) {
        return (
            <div style={{ padding: tokens.spacing[8], textAlign: "center" }}>
                <Spin />
            </div>
        );
    }
    if (isError) {
        return (
            <div style={{ padding: tokens.spacing[6], maxWidth: 720, margin: "0 auto" }}>
                <Alert
                    type="error"
                    showIcon
                    message="Couldn't load your departments"
                    description="Check your connection and reload the page."
                />
            </div>
        );
    }
    if (!canSee) return <Navigate to="/" replace />;

    const requested = searchParams.get("space");
    const selected =
        available.find((s) => s.id === requested) ?? available[0] ?? null;
    // Member filter (set by the rollup table, consumed by the P15 queue).
    // Lives in the URL beside ?space= so filtered views stay deep-linkable.
    const selectedMemberId = searchParams.get("member");
    const setMember = (userId: string | null) => {
        const next = new URLSearchParams(searchParams);
        if (userId) next.set("member", userId);
        else next.delete("member");
        if (selected) next.set("space", selected.id);
        setSearchParams(next);
    };
    // Active queue bucket (deep-linkable; defaults to the review backlog).
    const bucketParam = searchParams.get("bucket");
    const bucket: ReviewQueueBucket = QUEUE_BUCKETS.some(
        (b) => b.key === bucketParam,
    )
        ? (bucketParam as ReviewQueueBucket)
        : "needs_review";
    const setBucket = (b: ReviewQueueBucket) => {
        const next = new URLSearchParams(searchParams);
        next.set("bucket", b);
        if (selected) next.set("space", selected.id);
        setSearchParams(next);
    };

    return (
        <div
            data-testid="dept-page"
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1100,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[5],
            }}
        >
            {/* Header + department switcher */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    flexWrap: "wrap",
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: `${tokens.colors.primary}1A`,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    <UserCheck size={22} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        Department
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        {selected
                            ? `Reviewing ${selected.name}`
                            : "Task review & weekly HR reporting"}
                    </p>
                </div>
                {available.length > 1 && selected && (
                    <Select
                        aria-label="Select department"
                        style={{ width: 240 }}
                        value={selected.id}
                        onChange={(v) => setSearchParams({ space: v })}
                        options={available.map((s) => ({
                            value: s.id,
                            label: s.name,
                        }))}
                    />
                )}
            </div>

            {selected ? (
                <>
                    <DeptSummary
                        // Re-mount on space switch so stale member state
                        // never bleeds across departments.
                        key={selected.id}
                        spaceId={selected.id}
                        selectedMemberId={selectedMemberId}
                        onSelectMember={setMember}
                    />
                    <DeptQueue
                        key={`q-${selected.id}`}
                        spaceId={selected.id}
                        bucket={bucket}
                        onBucketChange={setBucket}
                        selectedMemberId={selectedMemberId}
                    />
                </>
            ) : (
                <Empty
                    description={
                        isAdmin
                            ? "No live spaces yet — create a space and assign a department head."
                            : "You do not head any department yet."
                    }
                />
            )}
        </div>
    );
};

export default DepartmentPage;
