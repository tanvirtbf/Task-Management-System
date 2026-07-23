import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, App as AntApp, Popconfirm, Tooltip } from "antd";
import {
    Paperclip,
    Upload,
    Download,
    Trash2,
    FileText,
    FileImage,
    FileSpreadsheet,
    File as FileIcon,
} from "lucide-react";
import dayjs from "dayjs";
import { attachmentsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useUserMap } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";
import type { Attachment } from "../../types/extras";

const ICON_BY_TYPE = (
    mime: string,
): React.ComponentType<{ size?: number; strokeWidth?: number }> => {
    if (mime.startsWith("image/")) return FileImage;
    if (mime === "application/pdf") return FileText;
    if (
        mime.includes("sheet") ||
        mime.includes("excel") ||
        mime === "text/csv"
    )
        return FileSpreadsheet;
    if (mime.includes("word") || mime === "text/plain") return FileText;
    return FileIcon;
};

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface Props {
    taskId: string;
}

export const AttachmentsSection = ({ taskId }: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);

    const { data: attachments = [] } = useQuery({
        queryKey: ["attachments", taskId],
        queryFn: () => attachmentsApi.byTask(taskId),
    });

    const upload = useMutation({
        mutationFn: (file: File) => attachmentsApi.upload(taskId, file),
        onSuccess: (att) => {
            qc.invalidateQueries({ queryKey: ["attachments", taskId] });
            qc.invalidateQueries({ queryKey: ["task", taskId] });
            message.success(`"${att.name}" uploaded`);
        },
        onError: (err) =>
            message.error(getApiErrorMessage(err) || "Upload failed"),
    });

    const remove = useMutation({
        mutationFn: (id: string) => attachmentsApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["attachments", taskId] });
            qc.invalidateQueries({ queryKey: ["task", taskId] });
            message.success("Attachment removed");
        },
    });

    const handleFiles = (files: FileList | null) => {
        if (!files) return;
        Array.from(files).forEach((f) => upload.mutate(f));
    };

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <Paperclip size={11} strokeWidth={1.75} />
                Attachments
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {attachments.length}
                </span>
                <Button
                    size="small"
                    type="text"
                    icon={<Upload size={12} strokeWidth={1.75} />}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ marginLeft: "auto" }}
                >
                    Upload
                </Button>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFiles(e.target.files)}
            />

            {/* Drop zone — visible only when empty, otherwise a thin strip */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                }}
                style={{
                    padding: attachments.length === 0 ? 24 : 12,
                    border: `2px dashed ${
                        dragOver
                            ? tokens.colors.primary
                            : tokens.colors.border
                    }`,
                    borderRadius: tokens.radius.md,
                    background: dragOver
                        ? tokens.colors.primarySubtle
                        : tokens.colors.bgPage,
                    textAlign: "center",
                    cursor: "pointer",
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textMuted,
                    marginBottom: attachments.length > 0 ? 12 : 0,
                    transition: "all var(--transition-base)",
                }}
                onClick={() => fileInputRef.current?.click()}
            >
                {dragOver
                    ? "Release to upload"
                    : attachments.length === 0
                      ? "Drag files here or click to upload"
                      : "+ Add more files"}
            </div>

            {/* Attachment grid */}
            {attachments.length > 0 && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(140px, 1fr))",
                        gap: 8,
                    }}
                >
                    {attachments.map((a) => (
                        <AttachmentCard
                            key={a.id}
                            attachment={a}
                            onDelete={() => remove.mutate(a.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const AttachmentCard = ({
    attachment: a,
    onDelete,
}: {
    attachment: Attachment;
    onDelete: () => void;
}) => {
    const Icon = ICON_BY_TYPE(a.type);
    const userMap = useUserMap();
    const uploader = userMap.get(a.uploadedBy);
    const isImage = a.type.startsWith("image/");
    const { message } = AntApp.useApp();

    // Gap-scan M11: the cached `a.url` is a 5-minute signed GET — mint a
    // fresh one at CLICK time or links die while the drawer sits open.
    const openFresh = async () => {
        try {
            const url = await attachmentsApi.freshUrl(a.id);
            window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
            message.error(getApiErrorMessage(err));
        }
    };

    return (
        // A <div> (not <a>) so the inner Download/Delete <a>/<button> aren't
        // nested in an anchor (invalid HTML → React hydration error). Clicking
        // the card opens the file in a new tab.
        <div
            role="button"
            tabIndex={0}
            aria-label={`Open attachment ${a.name}`}
            onClick={() => void openFresh()}
            style={{
                position: "relative",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                cursor: "pointer",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                textDecoration: "none",
                color: "inherit",
            }}
            onMouseEnter={(e) =>
                e.currentTarget.classList.add("attachment-hover")
            }
            onMouseLeave={(e) =>
                e.currentTarget.classList.remove("attachment-hover")
            }
        >
            {/* Preview */}
            <div
                style={{
                    height: 80,
                    background: tokens.colors.bgMuted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tokens.colors.textMuted,
                    overflow: "hidden",
                }}
            >
                {isImage && a.thumbnailUrl ? (
                    <img
                        src={a.thumbnailUrl}
                        alt={a.name}
                        style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                        }}
                        onError={(e) => {
                            // Mock thumbnails don't resolve — fall back to icon
                            e.currentTarget.style.display = "none";
                        }}
                    />
                ) : (
                    // eslint-disable-next-line react-hooks/static-components -- ICON_BY_TYPE returns a stable lucide component (a lookup, not a render-created component)
                    <Icon size={28} strokeWidth={1.5} />
                )}
            </div>

            {/* Meta */}
            <div style={{ padding: 8 }}>
                <Tooltip title={a.name}>
                    <div
                        style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {a.name}
                    </div>
                </Tooltip>
                <div
                    style={{
                        fontSize: 10,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                        marginTop: 2,
                    }}
                >
                    {formatSize(a.size)} ·{" "}
                    {dayjs(a.uploadedAt).format("MMM D")}
                </div>
                {uploader && (
                    <div
                        style={{
                            fontSize: 10,
                            color: tokens.colors.textMuted,
                            marginTop: 2,
                        }}
                    >
                        by {uploader.firstName}
                    </div>
                )}
            </div>

            {/* Actions overlay */}
            <div
                style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    display: "flex",
                    gap: 2,
                }}
            >
                <button
                    aria-label="Download"
                    title="Download"
                    style={overlayBtnStyle}
                    onClick={(e) => {
                        e.stopPropagation();
                        void openFresh();
                    }}
                >
                    <Download size={11} strokeWidth={1.75} />
                </button>
                <Popconfirm
                    title={`Delete "${a.name}"?`}
                    okType="danger"
                    onConfirm={onDelete}
                >
                    <button
                        aria-label="Delete"
                        title="Delete"
                        style={overlayBtnStyle}
                        onClick={(e) => e.preventDefault()}
                    >
                        <Trash2 size={11} strokeWidth={1.75} />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
};

const overlayBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    border: 0,
    borderRadius: 4,
    cursor: "pointer",
    textDecoration: "none",
};
