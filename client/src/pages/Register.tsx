import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/providers/auth-provider";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";

export function RegisterPage() {
    const { register: registerUser } = useAuth();
    const navigate = useNavigate();
    const [serverError, setServerError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

    const onSubmit = async (data: RegisterInput) => {
        setServerError(null);
        try {
            await registerUser({
                email: data.email,
                password: data.password,
                first_name: data.first_name,
                last_name: data.last_name || undefined,
            });
            navigate("/login");
        } catch (err) {
            if (err instanceof ApiError) setServerError(err.message);
            else setServerError("Registration failed");
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
            <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Create account</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Get started in seconds
                </p>

                <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium" htmlFor="first_name">
                                First name
                            </label>
                            <Input id="first_name" {...register("first_name")} />
                            {errors.first_name && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.first_name.message}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="text-sm font-medium" htmlFor="last_name">
                                Last name
                            </label>
                            <Input id="last_name" {...register("last_name")} />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium" htmlFor="email">
                            Email
                        </label>
                        <Input id="email" type="email" {...register("email")} />
                        {errors.email && (
                            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
                        )}
                    </div>

                    <div>
                        <label className="text-sm font-medium" htmlFor="password">
                            Password
                        </label>
                        <Input id="password" type="password" {...register("password")} />
                        {errors.password && (
                            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
                        )}
                    </div>

                    {serverError && (
                        <p className="text-xs text-destructive">{serverError}</p>
                    )}

                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Creating account…" : "Create account"}
                    </Button>
                </form>

                <p className="mt-4 text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <Link to="/login" className="font-medium text-foreground hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
