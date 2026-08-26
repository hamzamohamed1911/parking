"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";

type VehicleNoteEditorProps = {
  vehicleId: number;
  note?: string | null;
  plate?: string;
  /** Compact card for detail pages; dialog-only for lists/cards. */
  variant?: "card" | "button" | "icon";
  onSaved?: (note: string) => void;
};

export function VehicleNoteEditor({
  vehicleId,
  note = "",
  plate,
  variant = "card",
  onSaved,
}: VehicleNoteEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const current = (note ?? "").trim();

  useEffect(() => {
    if (open) setDraft(note ?? "");
  }, [open, note]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const updated = await api<{ note?: string }>(`vehicles/${vehicleId}/`, {
        method: "PATCH",
        body: { note: draft.trim() },
      });
      const next = (updated.note ?? draft).trim();
      toast.success(next ? "Note saved" : "Note cleared");
      setOpen(false);
      onSaved?.(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save note");
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {current ? "Edit note" : "Add note"}
            {plate ? (
              <span className="mt-1 block font-mono text-sm font-normal tracking-wider text-muted-foreground">
                {plate}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void save(e)}>
          <div className="space-y-2">
            <Label htmlFor={`vehicle-note-${vehicleId}`}>Note</Label>
            <Textarea
              id={`vehicle-note-${vehicleId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Operator note for this plate…"
              rows={4}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  if (variant === "button" || variant === "icon") {
    const iconButton = (
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label={
          current
            ? `Edit note for ${plate ?? "vehicle"}`
            : `Add note for ${plate ?? "vehicle"}`
        }
        title={current ? "Edit note" : "Add note"}
      >
        {current ? (
          <Pencil className="size-4" />
        ) : (
          <StickyNote className="size-4" />
        )}
      </Button>
    );

    return (
      <>
        {variant === "icon" ? (
          iconButton
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil className="size-3.5" />
            {current ? "Edit note" : "Add note"}
          </Button>
        )}
        {dialog}
      </>
    );
  }

  return (
    <>
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <StickyNote className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold tracking-tight">Vehicle note</h2>
              <p className="text-sm text-muted-foreground">
                Visible on wallet cards and this plate page.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil className="size-3.5" />
            {current ? "Edit" : "Add note"}
          </Button>
        </div>
        {current ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{current}</p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No note yet.</p>
        )}
      </section>
      {dialog}
    </>
  );
}
