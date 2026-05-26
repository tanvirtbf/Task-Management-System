import { Select } from "antd";
import { users as allUsers } from "../../../mocks/users";
import { Avatar } from "../../ui/Avatar";
import { tokens } from "../../../theme";
import type { CustomField } from "../../../types/custom-fields";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getUserIds = (value: unknown): string[] => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && "user_ids" in value) {
        return (value as { user_ids?: string[] }).user_ids ?? [];
    }
    return [];
};

export const PeopleFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const multiple = Boolean(
        (field.config as { multiple?: boolean })?.multiple,
    );
    const userIds = getUserIds(value);

    const options = allUsers.map((u) => ({
        value: u.id,
        label: `${u.firstName} ${u.lastName}`,
        email: u.email,
        avatarUrl: u.avatarUrl,
    }));

    return (
        <Select
            mode={multiple ? "multiple" : undefined}
            value={multiple ? userIds : userIds[0]}
            onChange={(v) =>
                onChange({ user_ids: Array.isArray(v) ? v : v ? [v] : [] })
            }
            options={options}
            placeholder={multiple ? "Select people..." : "Select a person..."}
            disabled={disabled}
            autoFocus={autoFocus}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            optionRender={({ data }) => {
                const user = allUsers.find((u) => u.id === data.value);
                if (!user) return <span>{data.label}</span>;
                return (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <Avatar
                            name={`${user.firstName} ${user.lastName}`}
                            src={user.avatarUrl}
                            size={20}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                                style={{
                                    fontWeight: 500,
                                    fontSize: tokens.typography.fontSize.sm,
                                }}
                            >
                                {user.firstName} {user.lastName}
                            </div>
                            <div
                                style={{
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                }}
                            >
                                {user.email}
                            </div>
                        </div>
                    </div>
                );
            }}
        />
    );
};
