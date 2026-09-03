"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BrandLogo } from "@/components/brand-logo";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, loading, user } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: LoginValues) =>
      login(username, password),
    onSuccess: () => {},
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Login failed");
    },
  });

  if (loading || user) {
    return (
      <div className="login-mesh min-h-screen">
        <Loader
          fullScreen
          label={user ? "Opening console…" : "Checking session…"}
        />
      </div>
    );
  }

  return (
    <div className="login-shell relative flex min-h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="login-mesh pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[14%] top-[16%] size-2 rounded-full bg-primary/70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[19%] top-[12%] size-1.5 rounded-full bg-(--brand-lavender)/80"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[23%] top-[20%] size-1 rounded-full bg-primary/40"
      />

      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle className="text-foreground hover:bg-foreground/10 hover:text-foreground" />
      </div>

      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl border border-border/60 bg-card/70 px-5 py-4 shadow-lg shadow-primary/10 ring-1 ring-primary/10 backdrop-blur-md">
            <BrandLogo priority />
          </div>
          <p className="text-sm text-muted-foreground">
            Parking operations control panel
          </p>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card/90 p-6 text-card-foreground shadow-2xl shadow-primary/10 backdrop-blur-sm sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Use your staff account to manage sites, wallets, and access.
            </p>
          </div>
          <form
            className="space-y-4"
            onSubmit={handleSubmit((values) => loginMutation.mutate(values))}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                aria-invalid={Boolean(errors.username)}
                aria-describedby={
                  errors.username ? "username-error" : undefined
                }
                className="h-11 rounded-xl"
                {...register("username")}
              />
              {errors.username ? (
                <p id="username-error" className="text-sm text-destructive">
                  {errors.username.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                  className="h-11 rounded-xl pr-11"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((open) => !open)}
                  className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {errors.password ? (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              ) : null}
            </div>
            <Button
              className="h-11 w-full rounded-xl text-base font-semibold"
              type="submit"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-8 text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
          Easy Technology
        </p>
      </div>
    </div>
  );
}
