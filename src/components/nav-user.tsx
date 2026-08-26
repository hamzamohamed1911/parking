"use client";

import { FormEvent, useState } from "react";
import { ChevronsUpDown, KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { api, ApiError } from "@/lib/api";

function fieldError(data: unknown, field: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[field];
  if (Array.isArray(value) && value.length) return String(value[0]);
  if (typeof value === "string") return value;
  return null;
}

export function NavUser() {
  const { isMobile, state } = useSidebar();
  const { user, logout } = useAuth();
  const name = user?.username || "User";
  const email = user?.email || user?.groups?.join(", ") || "Staff";
  const initials = name.slice(0, 2).toUpperCase();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function resetPasswordForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFormError(null);
    setBusy(false);
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("auth/change-password/", {
        method: "POST",
        body: {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
      });
      toast.success("Password updated");
      setPasswordOpen(false);
      resetPasswordForm();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(
          fieldError(err.data, "current_password") ||
            fieldError(err.data, "new_password") ||
            fieldError(err.data, "confirm_password") ||
            err.message
        );
      } else {
        setFormError("Could not update password");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="h-12 hover:bg-white/[0.06] data-[state=open]:bg-white/[0.06]"
              >
                <Avatar className="h-8 w-8 rounded-xl">
                  <AvatarFallback className="rounded-xl bg-[linear-gradient(135deg,var(--brand-400),var(--brand-600))] text-xs font-bold text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold text-white">{name}</span>
                  <span className="truncate text-xs text-white/45">{email}</span>
                </div>
                {state === "expanded" || isMobile ? (
                  <ChevronsUpDown className="ml-auto size-4 text-white/40 group-data-[collapsible=icon]:hidden" />
                ) : null}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-xl">
                    <AvatarFallback className="rounded-xl bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  resetPasswordForm();
                  setPasswordOpen(true);
                }}
              >
                <KeyRound />
                Change password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) resetPasswordForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Enter your current password, then choose a new one.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void onChangePassword(event)}>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPasswordOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
