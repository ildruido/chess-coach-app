// Sign-in calls for the web app (docs/API.md "Auth"). DOM-free so the messages are unit-tested.

export interface Session {
  userId: string;
  email: string;
}

export type AuthResult = { ok: true; session: Session } | { ok: false; message: string };

type Fetch = typeof fetch;

const post = (f: Fetch, url: string, body?: unknown) =>
  f(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Player-facing text for a failed sign-in or sign-up. */
export function authMessage(kind: "login" | "signup", status: number): string {
  if (status === 429) return "Too many attempts. Wait 15 minutes, then try again.";
  if (status === 401) return "That email or password isn't right.";
  if (status === 400 && kind === "signup") {
    return "That didn't work. The invite may be used or expired, or the email or password isn't valid (passwords need 10 to 200 characters). Ask for a new invite if it keeps failing.";
  }
  if (status === 400) return "Enter your email and your password.";
  return "Couldn't sign in right now. Reload the page and try again.";
}

function toSession(v: unknown): Session | null {
  const o = v as { userId?: unknown; email?: unknown } | null;
  return o && typeof o.userId === "string" && typeof o.email === "string"
    ? { userId: o.userId, email: o.email }
    : null;
}

/** Who is signed in, or null. A network failure also reads as signed out. */
export async function currentSession(f: Fetch = fetch): Promise<Session | null> {
  try {
    const res = await f("/api/auth/me", { credentials: "same-origin" });
    return res.ok ? toSession(await res.json()) : null;
  } catch {
    return null;
  }
}

async function submit(
  f: Fetch,
  kind: "login" | "signup",
  url: string,
  body: unknown,
): Promise<AuthResult> {
  try {
    const res = await post(f, url, body);
    if (!res.ok) return { ok: false, message: authMessage(kind, res.status) };
    const session = toSession(await res.json());
    return session ? { ok: true, session } : { ok: false, message: authMessage(kind, 500) };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

export const login = (email: string, password: string, f: Fetch = fetch) =>
  submit(f, "login", "/api/auth/login", { email, password });

export const signup = (invite: string, email: string, password: string, f: Fetch = fetch) =>
  submit(f, "signup", "/api/auth/signup", { invite, email, password });

export async function logout(f: Fetch = fetch): Promise<void> {
  await post(f, "/api/auth/logout").catch(() => undefined);
}

/** Player-facing text for a failed password change. */
export function changePasswordMessage(status: number): string {
  if (status === 403) return "Your current password isn't right.";
  if (status === 429) return "Too many attempts. Wait 15 minutes, then try again.";
  if (status === 400) return "Enter your current password and a new one of 10 to 200 characters.";
  if (status === 401) return "You've been signed out. Reload the page and sign in again.";
  return "Couldn't change the password right now. Try again in a moment.";
}

/** Changes the password; this device stays signed in, every other device is signed out. */
export async function changePassword(
  current: string,
  password: string,
  f: Fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await post(f, "/api/auth/change-password", { current, password });
    return res.ok ? { ok: true } : { ok: false, message: changePasswordMessage(res.status) };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}
