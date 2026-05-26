import { useEffect } from "react";
import { X, Download, ExternalLink } from "lucide-react";
import { tokens } from "../../theme";
import type { Attachment } from "../../types/extras";

interface Props {
    attachment: Attachment;
    onClose: () => void;
}

/**
 * Full-screen viewer for an attachment. Renders images and PDFs inline;
 * other file types fall back to a download prompt.
 */
export const AttachmentLightbox = ({ attachment, onClose }: Props) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        // Prevent body scroll
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose]);

    const isImage = attachment.type.startsWith("image/");
    const isPdf = attachment.type === "application/pdf";
    const isVideo = attachment.type.startsWith("video/");

    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={attachment.name}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.85)",
                zIndex: 3000,
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Toolbar */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    gap: 12,
                    color: "#fff",
                    background: "rgba(0,0,0,0.4)",
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {attachment.name}
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            color: "rgba(255,255,255,0.6)",
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {attachment.type} · {formatSize(attachment.size)}
                    </div>
                </div>
                <a
                    href={attachment.url}
                    download={attachment.name}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Download"
                    style={toolBtnStyle}
                >
                    <Download size={16} strokeWidth={1.75} />
                </a>
                <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Open in new tab"
                    style={toolBtnStyle}
                >
                    <ExternalLink size={16} strokeWidth={1.75} />
                </a>
                <button
                    onClick={onClose}
                    aria-label="Close"
                    style={{ ...toolBtnStyle, background: "transparent" }}
                >
                    <X size={18} strokeWidth={1.75} />
                </button>
            </div>

            {/* Body */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                    overflow: "auto",
                }}
            >
                {isImage ? (
                    <img
                        src={attachment.url}
                        alt={attachment.name}
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            borderRadius: tokens.radius.md,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                        }}
                    />
                ) : isPdf ? (
                    <iframe
                        src={attachment.url}
                        title={attachment.name}
                        style={{
                            width: "100%",
                            height: "100%",
                            background: "#fff",
                            borderRadius: tokens.radius.md,
                            border: 0,
                        }}
                    />
                ) : isVideo ? (
                    <video
                        src={attachment.url}
                        controls
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            borderRadius: tokens.radius.md,
                        }}
                    />
                ) : (
                    <div
                        style={{
                            textAlign: "center",
                            color: "rgba(255,255,255,0.8)",
                            padding: 32,
                            background: "rgba(255,255,255,0.05)",
                            borderRadius: tokens.radius.md,
                            maxWidth: 480,
                        }}
                    >
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.lg,
                                fontWeight: 600,
                                marginBottom: 6,
                            }}
                        >
                            No inline preview for this file type.
                        </div>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                color: "rgba(255,255,255,0.6)",
                                marginBottom: 16,
                            }}
                        >
                            Click download to open it with your default app.
                        </div>
                        <a
                            href={attachment.url}
                            download={attachment.name}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "8px 16px",
                                background: tokens.colors.primary,
                                color: "#fff",
                                borderRadius: tokens.radius.md,
                                textDecoration: "none",
                                fontWeight: 600,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            <Download size={14} strokeWidth={1.75} />
                            Download
                        </a>
                    </div>
                )}
            </div>

            {/* Hint */}
            <div
                style={{
                    padding: "8px 16px",
                    textAlign: "center",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 11,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                Press <kbd>Esc</kbd> or click outside to close
            </div>
        </div>
    );
};

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const toolBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    textDecoration: "none",
};
