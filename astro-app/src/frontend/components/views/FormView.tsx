import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    Button,
    Modal,
    Input,
    App as AntApp,
    Empty,
} from "antd";
import {
    Plus,
    FileText,
    ExternalLink,
    Edit3,
    Copy,
    Trash2,
} from "lucide-react";
import { useState } from "react";
import { formsApi } from "../../http/api";
import { LoadingState } from "../shared/LoadingState";
import { tokens } from "../../theme";

interface FormViewProps {
    listId: string;
}

export const FormView = ({ listId }: FormViewProps) => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [creating, setCreating] = useState(false);
    const [draftTitle, setDraftTitle] = useState("");

    const { data: forms = [], isLoading } = useQuery({
        queryKey: ["forms-by-list", listId],
        queryFn: () => formsApi.byList(listId),
    });

    const createMutation = useMutation({
        mutationFn: (title: string) =>
            formsApi.create({ listId, title }),
        onSuccess: (form) => {
            qc.invalidateQueries({ queryKey: ["forms-by-list", listId] });
            qc.invalidateQueries({ queryKey: ["forms"] });
            message.success("Form created");
            setCreating(false);
            setDraftTitle("");
            navigate(`/forms/${form.id}/edit`);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => formsApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["forms-by-list", listId] });
            qc.invalidateQueries({ queryKey: ["forms"] });
            message.success("Form deleted");
        },
    });

    return (
        <div
            style={{
                flex: 1,
                padding: tokens.spacing[6],
                background: tokens.colors.bgPage,
                overflow: "auto",
            }}
        >
            <div
                style={{
                    maxWidth: 900,
                    margin: "0 auto",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: tokens.spacing[5],
                    }}
                >
                    <div>
                        <h2
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 700,
                                letterSpacing: "-0.02em",
                            }}
                        >
                            Forms
                        </h2>
                        <p
                            style={{
                                margin: 0,
                                marginTop: 4,
                                color: tokens.colors.textSecondary,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            Public intake forms that create tasks in this list.
                        </p>
                    </div>
                    <Button
                        type="primary"
                        icon={<Plus size={14} strokeWidth={2} />}
                        onClick={() => setCreating(true)}
                    >
                        New form
                    </Button>
                </div>

                {isLoading ? (
                    <LoadingState />
                ) : forms.length === 0 ? (
                    <Empty
                        image={
                            <FileText
                                size={48}
                                strokeWidth={1.25}
                                color={tokens.colors.textMuted}
                            />
                        }
                        description="No forms for this list yet."
                    >
                        <Button
                            type="primary"
                            onClick={() => setCreating(true)}
                            icon={<Plus size={14} strokeWidth={2} />}
                        >
                            Create the first form
                        </Button>
                    </Empty>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: tokens.spacing[3],
                        }}
                    >
                        {forms.map((form) => (
                            <div
                                key={form.id}
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.lg,
                                    padding: tokens.spacing[4],
                                    display: "flex",
                                    alignItems: "center",
                                    gap: tokens.spacing[4],
                                }}
                            >
                                <div
                                    style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: tokens.radius.md,
                                        background: `${form.branding.primaryColor}1A`,
                                        color: form.branding.primaryColor,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <FileText size={18} strokeWidth={1.75} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize:
                                                tokens.typography.fontSize.base,
                                            fontWeight: 600,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {form.title}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            marginTop: 2,
                                        }}
                                    >
                                        /forms/{form.publicSlug}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        textAlign: "right",
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        marginRight: tokens.spacing[2],
                                    }}
                                >
                                    <div
                                        style={{
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            fontSize: tokens.typography.fontSize.base,
                                            fontWeight: 600,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {form.submissionCount}
                                    </div>
                                    <div>submissions</div>
                                </div>
                                <Button
                                    icon={<Edit3 size={12} strokeWidth={1.75} />}
                                    onClick={() =>
                                        navigate(`/forms/${form.id}/edit`)
                                    }
                                >
                                    Edit
                                </Button>
                                <Button
                                    icon={
                                        <ExternalLink
                                            size={12}
                                            strokeWidth={1.75}
                                        />
                                    }
                                    onClick={() =>
                                        window.open(
                                            `/forms/${form.publicSlug}`,
                                            "_blank",
                                        )
                                    }
                                >
                                    Preview
                                </Button>
                                <Button
                                    icon={<Copy size={12} strokeWidth={1.75} />}
                                    onClick={() => {
                                        navigator.clipboard.writeText(
                                            `${window.location.origin}/forms/${form.publicSlug}`,
                                        );
                                        message.success("Link copied");
                                    }}
                                >
                                    Link
                                </Button>
                                <Button
                                    type="text"
                                    danger
                                    icon={<Trash2 size={12} strokeWidth={1.75} />}
                                    onClick={() =>
                                        deleteMutation.mutate(form.id)
                                    }
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Modal
                open={creating}
                title="New form"
                onCancel={() => setCreating(false)}
                onOk={() => createMutation.mutate(draftTitle.trim())}
                okText="Create"
                okButtonProps={{ disabled: !draftTitle.trim() }}
                confirmLoading={createMutation.isPending}
                width={440}
            >
                <div style={{ paddingTop: tokens.spacing[3] }}>
                    <label
                        style={{
                            display: "block",
                            fontSize: tokens.typography.fontSize.sm,
                            fontWeight: 500,
                            marginBottom: 4,
                            color: tokens.colors.textSecondary,
                        }}
                    >
                        Form title
                    </label>
                    <Input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder="e.g. Order intake form"
                        autoFocus
                        onPressEnter={() =>
                            draftTitle.trim() &&
                            createMutation.mutate(draftTitle.trim())
                        }
                    />
                </div>
            </Modal>
        </div>
    );
};

export default FormView;
