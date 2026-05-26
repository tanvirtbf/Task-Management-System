import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const navItems = [
    { to: "/", label: "Dashboard" },
    { to: "/tasks", label: "Tasks" },
];

export function AppLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate("/login");
    };

    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-border bg-background">
                <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
                    <Link to="/" className="font-semibold">
                        {APP_NAME}
                    </Link>
                    <nav className="flex items-center gap-1">
                        {navItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.to === "/"}
                                className={({ isActive }) =>
                                    cn(
                                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                        isActive
                                            ? "bg-secondary text-secondary-foreground"
                                            : "text-muted-foreground hover:text-foreground",
                                    )
                                }
                            >
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">{user?.email}</span>
                        <button
                            onClick={handleLogout}
                            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                <Outlet />
            </main>
        </div>
    );
}
