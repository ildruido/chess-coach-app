# Chess Coach server

Backend for the web app (`docs/WEB-APP-PLAN.md`, contract in `docs/API.md`). Node 22, TypeScript, Hono, Postgres. Its own package: `cd server && npm ci`.

| Command                                   | What it does                                         |
| ----------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                             | Run from source (needs the variables below)          |
| `npm run typecheck`                       | Typecheck                                            |
| `TEST_DATABASE_URL=postgres://… npm test` | Tests; the database ones are skipped without the URL |
| `docker build -f server/Dockerfile -t chess-coach .` (from the repo root) | Container image: the server and the web app |
| `npx tsx e2e/server.ts`                   | Test server for the browser tests (scripted AI, test-only invite route); never in the image |

Environment: `DATABASE_URL` (required), `WEB_DIR` (folder with the built web app, `npm run build:web` at the repo root; the image sets it; from a checkout the server also finds `../dist-web`; without one it answers the API only), `PORT` (8080), `PUBLIC_URL` (address used in invite links; default the host's `RENDER_EXTERNAL_URL`, else `http://localhost:PORT`), `TRUST_PROXY=1` (set when exactly one reverse proxy sits in front: the client address then comes from the last `X-Forwarded-For` entry, and the cross-site check uses `X-Forwarded-Host`; without it every client behind the proxy shares one rate-limit bucket), `BOOTSTRAP_INVITE=1` (while there are no accounts, prints one invite link in the start-up log; for hosts without a shell, see `docs/PREVIEW.md`), `TEST_ACCOUNT_PASSWORD` (opt-in test account, CC-046: at start-up makes sure an account exists with this password, 10 to 200 characters, and puts the password back if it differs; address from `TEST_ACCOUNT_EMAIL`, default `test@chess-coach.org`; it skips the invite, so private previews only, and never log the value), `COOKIE_SECURE=0` (plain-http local development only; ignored in production), `AUTH_TEST_USER_ID` (dev only: acts as this user when nobody is signed in; refused when `NODE_ENV=production` unless `ALLOW_TEST_USER=1`). Migrations in `migrations/` run at start-up.

## Sign-in and the admin command

Accounts are invite-only. Passwords are hashed with argon2id; sessions are random tokens kept as hashes in Postgres and sent in a `cc_session` cookie (HttpOnly, Secure, SameSite=Lax, 30 days). Wrong passwords are limited to 5 per account and 30 per address per 15 minutes; the counters live in memory, so run **one server instance** (a restart clears them). Anyone can lock an account out for 15 minutes with five wrong guesses; that is the accepted trade-off. A taken email is reported at sign-up, but only to someone holding a valid invite.

Run the admin command where `DATABASE_URL` is set: `npm run admin -- <command>` from source, or `node dist/src/admin.js <command>` in the container.

| Command                                   | Does                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `invite [note] [--days N]`                | Prints a one-use invite link (`PUBLIC_URL/#/invite/<token>`), valid 7 days by default |
| `delete-user <email>`                     | Removes the account, its sessions, saved games and coach usage                        |
| `reset-password <email>`                  | Sets a new random password, prints it once, ends the person's sessions                |
| `set-allowance <email> <tokens\|default>` | Coach tokens per month for one person (read by the coach endpoint)                  |
| `list-users`                              | Accounts and allowances                                                               |

The page that opens `#/invite/<token>` and posts to `/api/auth/signup` is `src/web/` in the web build.

## Coach

`POST /api/coach` streams the coach's answer (`docs/API.md`). Set `ANTHROPIC_API_KEY` on the server only; without it `/api/coach` answers `503 capability_removed`. `COACH_MODEL_QUICK` (default `claude-haiku-4-5`) and `COACH_MODEL_DEFAULT` (default `claude-sonnet-4-5`) pick the models, `COACH_DEFAULT_ALLOWANCE` (default 200000) is the monthly token allowance for anyone the admin has not set one for. Tokens are counted per person per UTC month in `ai_usage`; prompts and answers are never logged. The allowance and the two-calls-at-once cap are checked in this process, so (like sign-in limits) run one server instance.

## The web app, headers and limits

The server hands out the web build and sets the browser security headers on every response (`docs/API.md`, "The site and its headers"). Per signed-in person: 600 document requests and 30 coach requests per minute (in memory, one instance). The browser tests (`npm run test:e2e -- --project=web` at the repo root) start `e2e/server.ts` on port 4175 with its own schema (`e2e_web`, recreated at every start) in the Postgres at `DATABASE_URL` (default `postgres://postgres:test@localhost:5432/postgres`); its scripted AI answers without a key and the server refuses to run with `NODE_ENV=production`.
