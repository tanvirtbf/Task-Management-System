import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { apiClient, ApiError } from "@/lib/api-client";
import type { DataResponse, User } from "@/types";

interface AuthContextValue {
    user: User | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<User>;
    register: (data: {
        email: string;
        password: string;
        first_name: string;
        last_name?: string;
    }) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchMe = useCallback(async () => {
        try {
            const res = await apiClient.get<DataResponse<User>>("/auth/me");
            setUser(res.data);
        } catch {
            setUser(null);
        }
    }, []);

    useEffect(() => {
        void (async () => {
            await fetchMe();
            setIsLoading(false);
        })();
    }, [fetchMe]);

    const login = useCallback(
        async (email: string, password: string) => {
            const res = await apiClient.post<DataResponse<User>>("/auth/login", {
                email,
                password,
            });
            setUser(res.data);
            return res.data;
        },
        [],
    );

    const register = useCallback(
        async (data: {
            email: string;
            password: string;
            first_name: string;
            last_name?: string;
        }) => {
            await apiClient.post("/auth/register", data);
        },
        [],
    );

    const logout = useCallback(async () => {
        try {
            await apiClient.post("/auth/logout");
        } catch (err) {
            if (!(err instanceof ApiError) || err.status !== 401) throw err;
        } finally {
            setUser(null);
        }
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({ user, isLoading, login, register, logout, refreshUser: fetchMe }),
        [user, isLoading, login, register, logout, fetchMe],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
