import { useState } from "react";
import { Button, App as AntApp, Alert } from "antd";
import {
    Download,
    Upload,
    FileSpreadsheet,
    Database,
    FileJson,
} from "lucide-react";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";

const ImportExportSettings = () => {
    const { message } = AntApp.useApp();
    const [exporting, setExporting] = useState(false);

    const handleExport = (format: string) => {
        setExporting(true);
        setTimeout(() => {
            message.success(`${format} export ready — file would download here.`);
            setExporting(false);
        }, 800);
    };

    return (
        <div>
            <SettingsHeader
                title="Import & Export"
                description="Bring data in from other tools, or export your workspace for backup."
            />

            <SettingsSection
                title="Import"
                description="Import tasks, lists, and projects from another tool."
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(240px, 1fr))",
                        gap: 8,
                    }}
                >
                    {[
                        {
                            name: "ClickUp",
                            description: "Export from ClickUp as JSON, then import here.",
                            icon: "🚀",
                            color: "#7B68EE",
                        },
                        {
                            name: "Asana",
                            description: "CSV export from Asana — tasks, projects, members.",
                            icon: "🅰️",
                            color: "#F06A6A",
                        },
                        {
                            name: "Trello",
                            description: "JSON or CSV from Trello boards.",
                            icon: "📋",
                            color: "#0079BF",
                        },
                        {
                            name: "Jira",
                            description: "XML or CSV export.",
                            icon: "🔵",
                            color: "#0052CC",
                        },
                        {
                            name: "CSV",
                            description: "Generic CSV with column mapping.",
                            icon: "📄",
                            color: "#10B981",
                        },
                        {
                            name: "Monday.com",
                            description: "Excel or JSON board export.",
                            icon: "📅",
                            color: "#FF3D57",
                        },
                    ].map((src) => (
                        <div
                            key={src.name}
                            style={{
                                background: tokens.colors.bgMuted,
                                border: `1px solid ${tokens.colors.borderSubtle}`,
                                borderRadius: tokens.radius.md,
                                padding: 12,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
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
                                        width: 32,
                                        height: 32,
                                        borderRadius: tokens.radius.sm,
                                        background: `${src.color}1A`,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 16,
                                    }}
                                >
                                    {src.icon}
                                </div>
                                <h4
                                    style={{
                                        margin: 0,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        fontWeight: 600,
                                    }}
                                >
                                    {src.name}
                                </h4>
                            </div>
                            <p
                                style={{
                                    margin: 0,
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    lineHeight: 1.4,
                                    flex: 1,
                                }}
                            >
                                {src.description}
                            </p>
                            <Button
                                size="small"
                                icon={<Upload size={12} strokeWidth={1.75} />}
                                onClick={() =>
                                    message.info(
                                        `${src.name} importer — coming soon`,
                                    )
                                }
                            >
                                Start import
                            </Button>
                        </div>
                    ))}
                </div>
            </SettingsSection>

            <SettingsSection
                title="Export"
                description="Download a full backup of your workspace."
            >
                <Alert
                    type="info"
                    showIcon
                    message="Exports may take a few minutes for large workspaces. You'll receive an email when ready."
                    style={{ marginBottom: 12 }}
                />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <ExportRow
                        icon={FileJson}
                        format="JSON"
                        description="Complete machine-readable backup — tasks, lists, custom fields, comments, automations, dashboards."
                        loading={exporting}
                        onExport={() => handleExport("JSON")}
                    />
                    <ExportRow
                        icon={FileSpreadsheet}
                        format="CSV"
                        description="Spreadsheet-friendly export of tasks across the workspace."
                        loading={exporting}
                        onExport={() => handleExport("CSV")}
                    />
                    <ExportRow
                        icon={Database}
                        format="SQL Dump"
                        description="Self-hosted only — full PostgreSQL dump of the workspace database."
                        loading={exporting}
                        onExport={() => handleExport("SQL")}
                    />
                </div>
            </SettingsSection>
        </div>
    );
};

const ExportRow = ({
    icon: Icon,
    format,
    description,
    loading,
    onExport,
}: {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    format: string;
    description: string;
    loading: boolean;
    onExport: () => void;
}) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            background: tokens.colors.bgMuted,
            borderRadius: tokens.radius.md,
        }}
    >
        <div
            style={{
                width: 36,
                height: 36,
                borderRadius: tokens.radius.sm,
                background: tokens.colors.bgSurface,
                color: tokens.colors.primary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
            }}
        >
            <Icon size={18} strokeWidth={1.5} />
        </div>
        <div style={{ flex: 1 }}>
            <div
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 600,
                }}
            >
                {format}
            </div>
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    lineHeight: 1.4,
                }}
            >
                {description}
            </div>
        </div>
        <Button
            icon={<Download size={13} strokeWidth={1.75} />}
            loading={loading}
            onClick={onExport}
        >
            Export
        </Button>
    </div>
);

export default ImportExportSettings;
