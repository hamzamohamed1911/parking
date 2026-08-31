"use client";

import { FormEvent, useState } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand-logo";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login, loading, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading || user) {
    return (
      <div className="login-mesh min-h-screen">
        <Loader fullScreen label={user ? "Opening console…" : "Checking session…"} />
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(username, password);
      toast.success("Signed in");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell relative flex min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="login-mesh pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[14%] top-[16%] size-2 rounded-full bg-primary/70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[19%] top-[12%] size-1.5 rounded-full bg-[var(--brand-lavender)]/80"
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
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 rounded-xl"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl"
                required
              />
            </div>
            <Button
              className="h-11 w-full rounded-xl text-base font-semibold"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
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
