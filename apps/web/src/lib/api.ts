import type { HealthDto } from '@office/contracts';

// Cliente HTTP da API do escritório. Token opcional (OFFICE_TOKEN no servidor).

const TOKEN_KEY = 'pixel-office.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // armazenamento indisponível: segue sem lembrar
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    /** Corpo inteiro da resposta de erro (ex.: `code`, `missing`). */
    readonly body?: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

/** A API respondeu? Sem token: /api/health é público. */
export async function health(): Promise<HealthDto | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as HealthDto) : null;
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // corpo não-JSON (ex.: proxy fora do ar)
  }
  if (!res.ok) {
    const msg = data?.error ?? `HTTP ${res.status}`;
    const details = Array.isArray(data?.details) ? `: ${data.details.join('; ')}` : '';
    throw new ApiError(res.status, `${msg}${details}`, data?.details, data);
  }
  return data as T;
}

export function wsUrl(after: number): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getToken();
  return `${proto}://${location.host}/ws?after=${after}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}
