/**
 * Session-based auth client (email/password + email verification for KYC).
 *
 * Always routed through the same-origin proxy — deliberately NOT via
 * NEXT_PUBLIC_BACKEND_URL. The HttpOnly `monocle_session` cookie is scoped to
 * whichever origin sets it, so if login went straight to the backend's domain
 * the cookie would land there, while sensitiveFetch (which goes through the
 * proxy on the dashboard's origin) would never see it and every gated action
 * would 401. Keeping auth same-origin makes the session behave identically in
 * dev and production.
 */

const API_URL = "/api/proxy";

export interface AuthUser {
  id: string;
  wallet: string | null;
  solName: string | null;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt?: string;
  lastSeenAt?: string;
}

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty/non-JSON body */
  }

  if (!res.ok) {
    const err = json?.error ?? {};
    throw new AuthError(err.code ?? "UNKNOWN", err.message ?? `HTTP ${res.status}`, res.status);
  }
  // Backend wraps payloads as { success, data }.
  return (json?.data ?? json) as T;
}

// ---- session bootstrap ------------------------------------------------------

/** Returns the current user, or null if not signed in. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const data = await request<{ user: AuthUser }>("/v1/auth/me", { method: "GET" });
    return data.user;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) return null;
    throw err;
  }
}

// ---- email/password ---------------------------------------------------------

export async function register(email: string, password: string) {
  return post<{ user: AuthUser; verificationEmailSent: boolean }>("/v1/auth/register", {
    email,
    password,
  });
}

export async function login(email: string, password: string) {
  return post<{ user: AuthUser }>("/v1/auth/login", { email, password });
}

export async function logout() {
  return post<{ ok: boolean }>("/v1/auth/logout");
}

/** Attach email+password to an already signed-in (e.g. wallet) account. */
export async function attachEmail(email: string, password: string) {
  return post<{ user: AuthUser; verificationEmailSent: boolean }>("/v1/auth/email/attach", {
    email,
    password,
  });
}

// ---- email verification (KYC) -----------------------------------------------

export async function sendVerificationCode() {
  return post<{ sent: boolean; email: string }>("/v1/auth/email/send-code");
}

export async function verifyEmail(code: string) {
  return post<{ user: AuthUser }>("/v1/auth/email/verify", { code });
}
