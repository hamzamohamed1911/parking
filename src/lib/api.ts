import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "./auth-storage";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://parkingapi.3utilities.com/api/";

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(
    path.replace(/^\//, ""),
    API_URL.endsWith("/") ? API_URL : `${API_URL}/`,
  );
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(buildUrl("auth/refresh/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = (await res.json()) as { access: string };
  const currentRefresh = getRefreshToken();
  if (currentRefresh) setTokens(data.access, currentRefresh);
  return data.access;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = true, query } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let token = auth ? getAccessToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    token = await refreshAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status, data);
  }
  return data as T;
}

/** Fetch a non-JSON endpoint (e.g. the printable session bill HTML) as text. */
export async function apiText(
  path: string,
  options: RequestOptions = {},
): Promise<string> {
  const { method = "GET", body, auth = true, query } = options;
  const headers: Record<string, string> = { Accept: "text/html, */*" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let token = auth ? getAccessToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    token = await refreshAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status, data);
  }
  return res.text();
}

export async function apiDownload(
  path: string,
  options: RequestOptions & { filename?: string } = {},
): Promise<void> {
  const { method = "GET", body, auth = true, query, filename } = options;
  const headers: Record<string, string> = {
    Accept: "*/*",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let token = auth ? getAccessToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    token = await refreshAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `Download failed (${res.status})`;
    throw new ApiError(detail, res.status, data);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const name = filename || match?.[1] || "download.csv";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: Omit<RequestOptions, "body"> = {},
): Promise<T> {
  const { method = "POST", auth = true, query } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  let token = auth ? getAccessToken() : null;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: formData,
  });

  if (res.status === 401 && auth) {
    token = await refreshAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: formData,
      });
    }
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `Upload failed (${res.status})`;
    throw new ApiError(detail, res.status, data);
  }
  return data as T;
}

export async function login(username: string, password: string) {
  const data = await api<{ access: string; refresh: string }>("auth/login/", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  setTokens(data.access, data.refresh);
  return data;
}
