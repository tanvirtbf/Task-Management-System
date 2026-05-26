import { Input } from "antd";
import { MapPin } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { geocodeAddress } from "../../../lib/dhaka-geocoder";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "text" in value) {
        return String((value as { text?: string }).text ?? "");
    }
    if (value && typeof value === "object" && "formatted_address" in value) {
        return String(
            (value as { formatted_address?: string }).formatted_address ?? "",
        );
    }
    return "";
};

export const LocationFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const text = getText(value);
    const geo = text ? geocodeAddress(text) : null;
    void field;

    return (
        <div>
            <Input
                value={text}
                onChange={(e) => {
                    const v = e.target.value;
                    const point = geocodeAddress(v);
                    onChange({
                        text: v,
                        formatted_address: v,
                        lat: point?.lat,
                        lng: point?.lng,
                    });
                }}
                disabled={disabled}
                autoFocus={autoFocus}
                prefix={
                    <MapPin
                        size={14}
                        strokeWidth={1.75}
                        color={geo ? tokens.colors.primary : tokens.colors.textMuted}
                    />
                }
                placeholder="Enter address (e.g. Mirpur 10, Dhaka)..."
                suffix={
                    geo ? (
                        <span
                            style={{
                                fontSize: 10,
                                color: tokens.colors.success,
                                fontFamily: tokens.typography.fontFamilyMono,
                                background: tokens.colors.successSubtle,
                                padding: "1px 6px",
                                borderRadius: 8,
                            }}
                            title={`Resolved to ${geo.lat.toFixed(3)}, ${geo.lng.toFixed(3)}`}
                        >
                            ✓ Mapped
                        </span>
                    ) : null
                }
            />
            {geo && (
                <div
                    style={{
                        marginTop: 6,
                        height: 80,
                        background: `linear-gradient(135deg, ${tokens.colors.primarySubtle}, ${tokens.colors.bgMuted})`,
                        borderRadius: tokens.radius.sm,
                        border: `1px solid ${tokens.colors.borderSubtle}`,
                        position: "relative",
                        overflow: "hidden",
                    }}
                    title={`${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`}
                >
                    <div
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -100%)",
                            color: tokens.colors.primary,
                        }}
                    >
                        <MapPin
                            size={20}
                            strokeWidth={2}
                            fill={tokens.colors.primary}
                            color="#FFFFFF"
                        />
                    </div>
                    <div
                        style={{
                            position: "absolute",
                            bottom: 4,
                            right: 8,
                            fontSize: 10,
                            color: tokens.colors.textMuted,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {geo.lat.toFixed(3)}, {geo.lng.toFixed(3)}
                    </div>
                </div>
            )}
        </div>
    );
};
