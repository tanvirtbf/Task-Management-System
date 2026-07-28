import { Button, Result, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../hooks/usePermissions";

/**
 * Route-level permission guard (RBAC_DYNAMIC_PLAN.md P28/P31).
 *
 * Before RBAC, `/settings/members`, `/eng/on-call` and the form builder were
 * reachable by anyone with a URL — `RequireAuth` only checked that a user
 * existed. This checks whether they hold the permission the page needs.
 *
 * It renders a friendly refusal rather than redirecting: a redirect makes a
 * shared link look broken, while "you don't have access to this page" tells
 * the person what actually happened and who to ask.
 *
 * The API enforces the same rule regardless — this only stops the page from
 * loading data it would be refused anyway.
 */
export const Forbidden = ({ what }: { what?: string }) => {
    const navigate = useNavigate();
    return (
        <Result
            status="403"
            title="এই পেজে আপনার অ্যাক্সেস নেই"
            subTitle={
                what
                    ? `এই কাজটি করার অনুমতি (${what}) আপনার রোলে দেওয়া নেই। ওয়ার্কস্পেস অ্যাডমিনকে বলুন।`
                    : "এই পেজটি দেখার অনুমতি আপনার রোলে দেওয়া নেই। ওয়ার্কস্পেস অ্যাডমিনকে বলুন।"
            }
            extra={
                <Button type="primary" onClick={() => navigate("/")}>
                    হোমে ফিরে যান
                </Button>
            }
        />
    );
};

interface Props {
    /** Permission key the page needs, e.g. `"role.manage"`. */
    permission: string;
    children: React.ReactNode;
}

const RequirePermission = ({ permission, children }: Props) => {
    const { holds, ready } = usePermissions();

    // Never flash a refusal before the permission set has landed.
    if (!ready) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
                <Spin />
            </div>
        );
    }
    if (!holds(permission)) return <Forbidden what={permission} />;
    return <>{children}</>;
};

export default RequirePermission;
