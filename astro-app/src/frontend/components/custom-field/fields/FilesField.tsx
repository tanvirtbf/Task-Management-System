import { Upload, Button } from "antd";
import { Paperclip, X } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
}

interface FileItem {
    id: string;
    filename: string;
    size: number;
}

const getFiles = (value: unknown): FileItem[] => {
    if (
        value &&
        typeof value === "object" &&
        "attachments" in value &&
        Array.isArray((value as { attachments?: unknown }).attachments)
    ) {
        return (value as { attachments: FileItem[] }).attachments;
    }
    return [];
};

const humanSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FilesFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
}: Props) => {
    const files = getFiles(value);
    const maxFiles = (field.config as { max_files?: number })?.max_files ?? 10;

    const addFile = (filename: string, size: number) => {
        const item: FileItem = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            filename,
            size,
        };
        onChange({ attachments: [...files, item] });
    };

    const removeFile = (id: string) => {
        onChange({ attachments: files.filter((f) => f.id !== id) });
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
            }}
        >
            {files.map((f) => (
                <div
                    key={f.id}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        background: tokens.colors.bgMuted,
                        border: `1px solid ${tokens.colors.borderSubtle}`,
                        borderRadius: tokens.radius.sm,
                    }}
                >
                    <Paperclip
                        size={14}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                    />
                    <span
                        style={{
                            flex: 1,
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textPrimary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {f.filename}
                    </span>
                    <span
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {humanSize(f.size)}
                    </span>
                    {!disabled && (
                        <button
                            onClick={() => removeFile(f.id)}
                            style={{
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                padding: 2,
                                color: tokens.colors.textMuted,
                                display: "flex",
                            }}
                            title="Remove"
                        >
                            <X size={12} strokeWidth={1.75} />
                        </button>
                    )}
                </div>
            ))}

            {!disabled && files.length < maxFiles && (
                <Upload
                    beforeUpload={(file) => {
                        addFile(file.name, file.size);
                        return false; // prevent actual upload — we're mock
                    }}
                    showUploadList={false}
                    disabled={disabled}
                    multiple
                >
                    <Button
                        icon={<Paperclip size={13} strokeWidth={1.75} />}
                        size="small"
                    >
                        Attach file
                    </Button>
                </Upload>
            )}
        </div>
    );
};
