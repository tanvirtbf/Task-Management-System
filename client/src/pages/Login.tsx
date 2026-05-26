import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/providers/auth-provider";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";

export function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [serverError, setServerError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

    const onSubmit = async (data: LoginInput) => {
        setServerError(null);
        try {
            await login(data.email, data.password);
            navigate("/");
        } catch (err) {
            if (err instanceof ApiError) setServerError(err.message);
            else setServerError("Login failed");
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
            <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Welcome back</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Sign in to manage your tasks
                </p>

                <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                    <div>
                        <label className="text-sm font-medium" htmlFor="email">
                            Email
                        </label>
                        <Input id="email" type="email" autoComplete="email" {...register("email")} />
                        {errors.email && (
                            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
                        )}
                    </div>

                    <div>
                        <label className="text-sm font-medium" htmlFor="password">
                            Password
                        </label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            {...register("password")}
                        />
                        {errors.password && (
                            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
                        )}
                    </div>

                    {serverError && (
                        <p className="text-xs text-destructive">{serverError}</p>
                    )}

                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Signing in…" : "Sign in"}
                    </Button>
                </form>

                <p className="mt-4 text-center text-sm text-muted-foreground">
                    No account?{" "}
                    <Link to="/register" className="font-medium text-foreground hover:underline">
                        Register
                    </Link>
                </p>
            </div>
        </div>
    );
}
