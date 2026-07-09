import { Outlet } from "react-router-dom";
import { Logo } from "../components/ui/Logo";
import { tokens } from "../theme";
import { ProductPreview } from "./auth/ProductPreview";

/**
 * Split-screen auth layout.
 * Left  (≥ 1024px): brand panel — gradient, wordmark, tagline, product teaser.
 * Right: white surface, child form vertically centered.
 * On mobile / tablet: brand panel hidden, form full-width.
 */
const AuthLayout = () => {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: tokens.colors.bgSurface,
      }}
    >
      {/* Brand panel (hidden < 1024px) */}
      <div
        className="auth-brand-panel"
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(135deg, #4F46E5 0%, #6366F1 50%, #818CF8 100%)",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          padding: tokens.spacing[10],
        }}
      >
        {/* Decorative grid pattern */}
        <DecorativeBackdrop />

        {/* Top — wordmark */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <Logo size={32} inverse showWordmark />
        </div>

        {/* Center — tagline + product teaser */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: tokens.spacing[8],
            maxWidth: 480,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: tokens.typography.fontSize["4xl"],
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.03em",
                margin: 0,
                marginBottom: tokens.spacing[4],
              }}
            >
              Operations,
              <br />
              in one place.
            </h2>
            <p
              style={{
                fontSize: tokens.typography.fontSize.lg,
                lineHeight: 1.5,
                color: "rgba(255, 255, 255, 0.85)",
                margin: 0,
                maxWidth: 380,
              }}
            >
              Orders, inventory, support, marketing — every workflow your team
              runs, in a single system.
            </p>
          </div>

          <ProductPreview />
        </div>

        {/* Bottom — copyright */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            fontSize: tokens.typography.fontSize.sm,
            color: "rgba(255, 255, 255, 0.65)",
          }}
        >
          © {new Date().getFullYear()} BeautyBooth · Internal use only
        </div>
      </div>

      {/* Form panel */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: tokens.spacing[6],
          overflow: "auto",
        }}
      >
        <Outlet />
      </div>

      {/* Responsive: hide brand panel on small screens */}
      <style>{`
                @media (max-width: 1024px) {
                    .auth-brand-panel {
                        display: none !important;
                    }
                }
            `}</style>
    </div>
  );
};

/** Subtle dotted grid + radial glow on the brand panel. */
const DecorativeBackdrop = () => (
  <div
    aria-hidden
    style={{
      position: "absolute",
      inset: 0,
      backgroundImage:
        "radial-gradient(circle at 20% 0%, rgba(255,255,255,0.18) 0%, transparent 50%), radial-gradient(circle at 80% 100%, rgba(255,255,255,0.12) 0%, transparent 50%), radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 100% 100%, 24px 24px",
    }}
  />
);

export default AuthLayout;
