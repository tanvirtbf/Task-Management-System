import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { tokens } from "../../theme";

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Deliberate: this is the last place a crash can be seen at all, so
        // it goes to the console even in production. (The `no-console`
        // disable that used to sit here was inert — unlike the server, the
        // client config never enables that rule.)
        console.error("Uncaught error:", error, errorInfo);
    }

    handleReset = () => {
        this.setState({ error: null });
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.error) {
            return (
                <div
                    style={{
                        minHeight: "100vh",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: tokens.spacing[6],
                        background: tokens.colors.bgPage,
                    }}
                >
                    <div
                        style={{
                            maxWidth: 480,
                            width: "100%",
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.lg,
                            padding: tokens.spacing[6],
                            boxShadow: tokens.shadows.lg,
                            textAlign: "center",
                        }}
                    >
                        <div
                            style={{
                                width: 56,
                                height: 56,
                                borderRadius: "50%",
                                background: tokens.colors.dangerSubtle,
                                color: tokens.colors.danger,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: tokens.spacing[3],
                            }}
                        >
                            <AlertTriangle size={28} strokeWidth={1.75} />
                        </div>
                        <h2
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 700,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            Something went wrong
                        </h2>
                        <p
                            style={{
                                margin: `${tokens.spacing[2]}px 0 ${tokens.spacing[4]}px`,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textSecondary,
                                lineHeight: 1.5,
                            }}
                        >
                            An unexpected error occurred while rendering this
                            page. We've logged the details to the console.
                        </p>
                        <pre
                            style={{
                                background: tokens.colors.bgMuted,
                                border: `1px solid ${tokens.colors.borderSubtle}`,
                                padding: tokens.spacing[3],
                                borderRadius: tokens.radius.md,
                                fontSize: 11,
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                                textAlign: "left",
                                color: tokens.colors.danger,
                                marginBottom: tokens.spacing[4],
                                overflow: "auto",
                                maxHeight: 160,
                            }}
                        >
                            {this.state.error.message}
                        </pre>
                        <div
                            style={{
                                display: "flex",
                                gap: 8,
                                justifyContent: "center",
                            }}
                        >
                            <Button onClick={this.handleReset}>Try again</Button>
                            <Button
                                type="primary"
                                icon={<RefreshCw size={14} strokeWidth={1.75} />}
                                onClick={this.handleReload}
                            >
                                Reload the app
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
