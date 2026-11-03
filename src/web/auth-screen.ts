// The sign-in gate of the web app: nothing else loads until someone is signed in.
// Built with DOM calls only (no innerHTML), and styled by the page's stylesheet.

import { type Session, changePassword, currentSession, login, logout, signup } from "./auth";
import { inviteFromHash } from "./route";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  return el("label", { className: "auth-field" }, label, input);
}

/** Resolves with the signed-in person: straight away when a session exists, else after the form. */
export async function requireSignIn(): Promise<Session> {
  const existing = await currentSession();
  if (existing) return existing;

  const invite = inviteFromHash(location.hash);
  const email = el("input", {
    type: "email",
    name: "email",
    autocomplete: "username",
    required: true,
  });
  const password = el("input", {
    type: "password",
    name: "password",
    required: true,
    minLength: invite ? 10 : 1,
    maxLength: 200,
    autocomplete: invite ? "new-password" : "current-password",
  });
  const message = el("p", { className: "auth-message", role: "alert" });
  const submit = el("button", { type: "submit" }, invite ? "Create my account" : "Sign in");
  const form = el(
    "form",
    { className: "auth-card" },
    el("h1", { tabIndex: -1 }, invite ? "Welcome to Chess Coach" : "Sign in to Chess Coach"),
    el(
      "p",
      { className: "lede" },
      invite
        ? "Choose the email and password you will use to sign in. Your password needs at least 10 characters."
        : "Chess Coach is invite only. Use the email and password you chose when you joined.",
    ),
    field("Email", email),
    field("Password", password),
    message,
    submit,
  );
  const wrap = el("main", { className: "wrap auth-wrap" }, form);
  document.body.replaceChildren(wrap);
  email.focus();

  return new Promise<Session>(() => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.textContent = "";
      const result = invite
        ? await signup(invite, email.value.trim(), password.value)
        : await login(email.value.trim(), password.value);
      if (!result.ok) {
        message.textContent = result.message;
        submit.disabled = false;
        password.focus();
        return;
      }
      // The invite is spent: drop it from the address and reload into the app.
      history.replaceState(null, "", location.pathname);
      // Reloading starts the app with the new session; this promise never resolves, so
      // nothing mounts (or calls the server) in the meantime.
      location.reload();
    });
  });
}

/** The small form behind "Change password"; hides itself after a successful change. */
function passwordForm(onDone: () => void): HTMLFormElement {
  const current = el("input", {
    type: "password",
    name: "current",
    required: true,
    maxLength: 200,
    autocomplete: "current-password",
  });
  const next = el("input", {
    type: "password",
    name: "new",
    required: true,
    minLength: 10,
    maxLength: 200,
    autocomplete: "new-password",
  });
  const message = el("p", { className: "auth-message", role: "alert" });
  const save = el("button", { type: "submit" }, "Save new password");
  const form = el(
    "form",
    { className: "auth-card password-form", id: "password-form" },
    field("Current password", current),
    field("New password (10 or more characters)", next),
    message,
    save,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    message.textContent = "";
    const result = await changePassword(current.value, next.value);
    save.disabled = false;
    if (!result.ok) {
      message.textContent = result.message;
      return;
    }
    form.reset();
    onDone();
  });
  return form;
}

/** "Signed in as …  Change password  Sign out" next to the version line. */
export function mountSessionBar(session: Session, anchor: HTMLElement): void {
  const out = el(
    "button",
    { type: "button", className: "link-button", id: "sign-out" },
    "Sign out",
  );
  out.addEventListener("click", async () => {
    out.disabled = true;
    await logout();
    location.reload();
  });
  const change = el(
    "button",
    { type: "button", className: "link-button", id: "change-password" },
    "Change password",
  );
  const status = el("span", { className: "auth-status", role: "status" });
  const form = passwordForm(() => {
    form.hidden = true;
    status.textContent = " Password changed. Your other devices were signed out.";
  });
  form.hidden = true;
  change.addEventListener("click", () => {
    form.hidden = !form.hidden;
    status.textContent = "";
    if (!form.hidden) form.querySelector("input")?.focus();
  });
  const bar = el(
    "span",
    { className: "session-bar", id: "session-bar" },
    ` · ${session.email} · `,
    change,
    " · ",
    out,
    status,
  );
  anchor.after(bar, form);
}
