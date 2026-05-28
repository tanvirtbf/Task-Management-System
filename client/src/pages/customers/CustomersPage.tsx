import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Tag, Tooltip, Skeleton } from "antd";
import { Phone, PhoneCall, Search, Crown, AlertCircle } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { formatBdPhone, telHref } from "../../lib/bd-phone";
import { formatBdt } from "../../lib/bdt";
import { tokens } from "../../theme";

const CustomersPage = () => {
    const [query, setQuery] = useState("");

    const { data = [], isLoading } = useQuery({
        queryKey: ["customers", query],
        queryFn: () => mockApi.customers.search(query),
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1100,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[4],
            }}
        >
            <div>
                <h1
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize["2xl"],
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        color: tokens.colors.textPrimary,
                    }}
                >
                    Customers
                </h1>
                <p
                    style={{
                        margin: 0,
                        marginTop: 4,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    Lightweight customer ledger — keyed by phone number. Orders,
                    complaints and lifetime value roll up automatically from
                    tasks tagged with the customer's phone.
                </p>
            </div>

            <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by phone or name (try 01712...)"
                size="large"
                allowClear
                prefix={
                    <Search
                        size={16}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                    />
                }
            />

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : data.length === 0 ? (
                <div
                    style={{
                        padding: tokens.spacing[8],
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                        background: tokens.colors.bgSurface,
                        border: `1px dashed ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                    }}
                >
                    No customers match that search yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                        gap: tokens.spacing[3],
                    }}
                >
                    {data.map((c) => (
                        <div
                            key={c.id}
                            style={{
                                background: tokens.colors.bgSurface,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.lg,
                                padding: tokens.spacing[4],
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                }}
                            >
                                <div
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: "50%",
                                        background: c.vipFlag
                                            ? `${tokens.colors.warning}22`
                                            : tokens.colors.bgMuted,
                                        color: c.vipFlag
                                            ? tokens.colors.warning
                                            : tokens.colors.textSecondary,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontWeight: 700,
                                    }}
                                >
                                    {c.name.charAt(0)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontWeight: 600,
                                                color: tokens.colors.textPrimary,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {c.name}
                                        </span>
                                        {c.vipFlag && (
                                            <Tooltip title="VIP — ≥5 orders or ≥10,000৳">
                                                <Crown
                                                    size={13}
                                                    strokeWidth={2}
                                                    color={
                                                        tokens.colors.warning
                                                    }
                                                />
                                            </Tooltip>
                                        )}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            color: tokens.colors.textSecondary,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            fontSize: 12,
                                        }}
                                    >
                                        <Phone size={11} strokeWidth={1.75} />
                                        {formatBdPhone(c.phone)}
                                    </div>
                                </div>
                                <a
                                    href={telHref(c.phone)}
                                    style={{
                                        background:
                                            tokens.colors.primarySubtle,
                                        color: tokens.colors.primary,
                                        borderRadius: tokens.radius.sm,
                                        padding: 6,
                                        display: "inline-flex",
                                    }}
                                    title="Call now"
                                    aria-label="Call now"
                                >
                                    <PhoneCall size={13} strokeWidth={1.75} />
                                </a>
                            </div>

                            {c.defaultAddress && (
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: tokens.colors.textSecondary,
                                    }}
                                >
                                    {c.defaultAddress}
                                </div>
                            )}

                            <div
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    marginTop: 4,
                                }}
                            >
                                <Tag color="blue">{c.totalOrders} orders</Tag>
                                {c.totalComplaints > 0 && (
                                    <Tag color="red">
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 3,
                                            }}
                                        >
                                            <AlertCircle
                                                size={10}
                                                strokeWidth={1.75}
                                            />
                                            {c.totalComplaints} complaints
                                        </span>
                                    </Tag>
                                )}
                                <Tag color="green">
                                    LTV {formatBdt(c.lifetimeValue, false)}
                                </Tag>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CustomersPage;
