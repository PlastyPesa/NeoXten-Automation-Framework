/** Empty in Vite dev (proxy); set at runtime in Tauri to `http://127.0.0.1:<port>`. */
let operatorApiBase = "";

export function setOperatorApiBase(baseUrl: string): void {
  operatorApiBase = baseUrl.replace(/\/$/, "");
}

export function getOperatorApiBase(): string {
  return operatorApiBase;
}

export async function opFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${operatorApiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function rawRunUrl(runDbId: string, relpath: string): string {
  const q = new URLSearchParams({ relpath });
  return `${operatorApiBase}/api/runs/${runDbId}/raw?${q.toString()}`;
}
