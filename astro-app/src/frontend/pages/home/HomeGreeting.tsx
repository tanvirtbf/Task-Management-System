import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

const greetingFor = (h: number) => {
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
};

export const HomeGreeting = () => {
    const user = useAuthStore((s) => s.user);
    const now = new Date();
    const greeting = greetingFor(now.getHours());

    const dayFormatter = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    return (
        <div>
            <div
                style={{
                    fontSize: 12,
                    color: tokens.colors.textMuted,
                    fontWeight: 500,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    marginBottom: 4,
                }}
            >
                {dayFormatter.format(now)}
            </div>
            <h1
                style={{
                    fontSize: tokens.typography.fontSize["3xl"],
                    fontWeight: 700,
                    color: tokens.colors.textPrimary,
                    margin: 0,
                    letterSpacing: "-0.025em",
                    lineHeight: 1.15,
                }}
            >
                {greeting}, {user?.firstName ?? "there"}
                <span style={{ color: tokens.colors.primary }}>.</span>
            </h1>
        </div>
    );
};
