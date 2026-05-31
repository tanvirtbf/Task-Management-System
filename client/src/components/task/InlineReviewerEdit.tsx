import { Select } from "antd";
import { Eye, UserCircle } from "lucide-react";
import { useUsers, useUserMap } from "../../hooks/useReferenceData";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";

interface Props {
    reviewerId: string | null | undefined;
    onChange: (next: string | null) => void;
}

export const InlineReviewerEdit = ({ reviewerId, onChange }: Props) => {
    const { data: allUsers = [] } = useUsers();
    const userMap = useUserMap();
    const user = reviewerId ? userMap.get(reviewerId) : null;
    const active = allUsers.filter((u) => u.status === "active");

    return (
        <Select
            size="small"
            value={reviewerId ?? undefined}
            placeholder={
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: tokens.colors.textMuted,
                    }}
                >
                    <Eye size={12} strokeWidth={1.75} />
                    Assign reviewer
                </span>
            }
            onChange={(v) => onChange(v ?? null)}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: "100%", maxWidth: 220 }}
            variant="borderless"
            options={active.map((u) => ({
                value: u.id,
                label: `${u.firstName} ${u.lastName}`,
            }))}
            optionRender={(opt) => {
                const u = userMap.get(String(opt.value));
                if (!u)
                    return (
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            <UserCircle size={14} strokeWidth={1.75} />
                            {opt.label}
                        </span>
                    );
                return (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <Avatar
                            name={`${u.firstName} ${u.lastName}`}
                            src={u.avatarUrl}
                            size={18}
                        />
                        {opt.label}
                    </span>
                );
            }}
            labelRender={() =>
                user ? (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        <Avatar
                            name={`${user.firstName} ${user.lastName}`}
                            src={user.avatarUrl}
                            size={16}
                        />
                        {user.firstName}
                    </span>
                ) : null
            }
        />
    );
};
