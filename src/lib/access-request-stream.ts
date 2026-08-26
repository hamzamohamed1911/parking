import { API_URL } from "@/lib/api";

export type StreamStatus = "connecting" | "live" | "offline" | "idle";

/** SSE endpoint for pending access requests, optionally scoped to zones. */
export function accessRequestStreamUrl(
  token: string,
  scope: { projectId?: number | null; zoneIds?: number[] } = {}
) {
  const base = API_URL.endsWith("/") ? API_URL.slice(0, -1) : API_URL;
  const params = new URLSearchParams({ access_token: token });
  if (scope.projectId != null) params.set("project", String(scope.projectId));
  for (const zoneId of scope.zoneIds ?? []) {
    params.append("zone", String(zoneId));
  }
  return `${base}/access-requests/stream/?${params.toString()}`;
}

/** Parse SSE text frames from a fetch ReadableStream chunk buffer. */
export function consumeSseBuffer(
  buffer: string,
  onEvent: (event: string, data: string) => void
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    if (!part.trim() || part.trimStart().startsWith(":")) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) onEvent(event, dataLines.join("\n"));
  }
  return rest;
}
