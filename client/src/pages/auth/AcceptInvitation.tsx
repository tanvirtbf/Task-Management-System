import { Link } from "react-router-dom";
import { FormCard } from "../../components/ui/FormCard";
import { tokens } from "../../theme";

/**
 * Invitation accept-via-link is a V1 follow-up. Admins CAN invite teammates
 * (that creates the account and emails a link), but completing onboarding
 * through the public link needs a backend accept endpoint that isn't built yet.
 * Until then this page is informational — use the seeded owner to sign in, or
 * have an admin finish setting up the account directly.
 */
export const AcceptInvitationPage = () => {
    return (
        <FormCard
            title="Invitation links coming soon"
            description="Accepting an invitation through this link isn't available yet. Please ask your workspace admin to finish setting up your account, then sign in."
            footer={
                <Link
                    to="/login"
                    style={{ color: tokens.colors.primary, fontWeight: 500 }}
                >
                    Go to login
                </Link>
            }
        >
            <span />
        </FormCard>
    );
};

export default AcceptInvitationPage;
