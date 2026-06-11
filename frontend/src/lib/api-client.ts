// Shared fetch wrapper for all frontend → FastAPI calls.
// Always routes through the Next.js rewrite (/api/* → FastAPI).

interface ApiFetchOptions extends RequestInit {
  on404?: "throw" | "null"; // "throw" → tagged Error({ status:404 }), "null" → return null
}

export async function apiFetch<T>(
  path: string,
  token: string,
  init?: ApiFetchOptions,
): Promise<T> {
  const { on404, ...fetchInit } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...fetchInit,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...fetchInit.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 404) {
      if (on404 === "null") return null as T;
      if (on404 === "throw") throw Object.assign(new Error("not_found"), { status: 404 });
    }
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
