"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Loader } from "@/components/loaders";
import { api, ApiError } from "@/lib/api";
import type { Paginated } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
};

export function ResourceTable<T extends { id: number }>({
  path,
  columns,
  query,
  empty = "No records found.",
  refreshKey = 0,
}: {
  path: string;
  columns: Column<T>[];
  query?: Record<string, string | number | boolean | undefined | null>;
  empty?: string;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [path, JSON.stringify(query), refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await api<Paginated<T>>(path, {
          query: { ...query, page },
        });
        if (!cancelled) {
          setRows(data.results);
          setCount(data.count);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof ApiError ? err.message : "Failed to load");
          setRows([]);
          setCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [path, page, JSON.stringify(query), refreshKey]);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <Loader compact label="Loading…" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center">
                  <p className="text-sm font-medium text-foreground">{empty}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try adjusting search or filters.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {count} result{count === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
