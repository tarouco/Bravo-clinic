# STATE — Bravô Clinic · Salas Inteligentes

Source of truth for product scope: `docs/prd.md` (PRD v1.6, 2026-10-25).
Design system: `docs/design/DESIGN.md` (Bravô Serene Architecture) + reference home page `docs/design/home-reference.html` / `home-reference.png`.

## Decisions

### AD-001 · Monorepo with npm workspaces
- `apps/web` — single SPA serving the public site (`/`), tenant PWA (`/app/*`) and Admin (`/admin/*`).
- `apps/api` — Hono HTTP API (deployed as a Neon Function), DB schema/migrations, jobs, MCP server.
- `packages/core` — pure, framework-free domain logic shared by API and web (pricing engine, availability/slot grid with cleanup buffers, proportional package debit, policy calculations, money/time helpers). No I/O.
- **Why:** one repo for GitHub sync; the pricing engine must give identical numbers in the browser simulator and on the server.

### AD-002 · Frontend stack
Vite + React 18 + TypeScript (strict) + React Router 6 + TanStack Query + Tailwind CSS 3 + `vite-plugin-pwa`. Icons: `lucide-react` at `strokeWidth={1.5}` (thin stroke, no emoji). Fonts: Josefin Sans (display) + Jost (text) via Google Fonts. Day/Night themes via CSS variables + `data-theme` on `<html>`. Static `index.html` carries `LocalBusiness` JSON-LD + Open Graph.
- **Why:** PRD §8 requires one front-end project on Netlify with site, PWA and Admin.

### AD-003 · Backend runtime: Hono on Neon Functions, proxied by Netlify
- API is a Hono app exported as `export default app` (Neon Function slug `api`, Node 24). Local dev runs the same app with `@hono/node-server`.
- Netlify rewrites `/api/*` → `<neon-function-url>/:splat` (status 200 proxy), so the browser sees a single origin and auth cookies stay first-party.
- Function verified working on 2026-10-25 (spike on branch `dev`: `DATABASE_URL` and `NEON_BRANCH` injected).
- **Fallback:** if Neon Functions become unavailable, the same Hono app is wrapped by a Netlify Function entry (`hono/netlify`) without code changes.
- **Why:** PRD §8 "API e jobs em Neon Functions"; portable Hono keeps the exit cheap.

### AD-004 · Database: Neon Postgres 17 + Drizzle ORM
- Project `Bravo-clinic` (`dry-dream-65262086`, `aws-us-east-1`), database `bravo`. Branches: `production` (`br-polished-darkness-b8jbvs2x`, default) and `dev` (`br-broad-hat-b8remqjk`, integration tests).
- Drizzle ORM over `pg` (node-postgres) Pool (max 5) + `attachDatabasePool`. Migrations: drizzle-kit generated SQL + hand-written SQL migration for extensions (`btree_gist`) and the exclusion constraint.
- Double-booking prevention **in the database**: one table `room_occupancy(room_id, period tstzrange, kind, ref_id, ...)` with `EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (active)`, where `period = [start, end + cleanup)` for bookings/occurrences and `[start, end)` for manual blocks (PRD §5.2.1, §8).
- Money = integer cents (`bigint`/`integer`). Time = `timestamptz` stored UTC, displayed `America/Sao_Paulo` (PRD §7.6).
- Ledgers (package minutes, credits, coupon uses, payments) are append-only tables; balances are derived or updated inside the same transaction.

### AD-005 · Authentication: in-house in the API
- Email + password (Node `crypto.scrypt`), session = signed JWT (`jose`, HS256, `SESSION_SECRET`) in an httpOnly, Secure, SameSite=Lax cookie (first-party thanks to AD-003).
- Email verification token required before first booking (PRD §7.4). Google login via OAuth 2.0 code flow, enabled only when `GOOGLE_CLIENT_ID/SECRET` are configured.
- Roles: `tenant`, `reception`, `admin`. Admin and reception require TOTP 2FA (`otpauth`) (PRD §8).
- **Why:** PRD leaves Neon Auth "a confirmar"; in-house auth is fully testable in integration tests and has no third-party callback-domain dependency. Revisit Neon Auth in v2.

### AD-006 · Payments: generic gateway interface
- `PaymentGateway` interface (create charge Pix/card, charge saved card, get status, refund total/partial, customer+card tokenization, verify+parse webhook). Adapters: `sandbox` (internal simulated gateway with hosted fake checkout page — default until real credentials exist) and `mercadopago` (REST via `fetch`).
- Active gateway selected in Admin → Integrações; credentials encrypted AES-256-GCM with `ENCRYPTION_KEY`, never returned whole.
- Webhooks at `/api/webhooks/pagamentos/:provider`, idempotent by (provider, external_id, status). Recurrence driven by our jobs, never provider subscriptions.

### AD-007 · Scheduled jobs: Neon Function Triggers (cron)
Triggers POST to `/jobs/<name>` on the `api` function, authenticated with `parseTriggerDelivery` (`@neon/functions/triggers`). Every 5 min: expire checkouts and pre-reservations, mark no-shows, charge balances, send reminders, reconcile pending payments. Daily: subscription renewals (2 days before base date), period rollover/expiry, suspensions, holiday reminder (Oct 1), holiday import.

### AD-008 · Notifications
Email via Resend REST when `RESEND_API_KEY` exists; every message is always written to `email_outbox` (visible in Admin) so the system works without a provider. `.ics` attachments per RFC 5545. Web push via VAPID (`web-push`).

### AD-009 · Files
Room photos and expense attachments in Neon Object Storage (S3-compatible, `@aws-sdk/client-s3`). Missing photos → brand placeholder image.

### AD-010 · Tests and gates (greenfield choice)
- Vitest everywhere. `packages/core`: unit tests (pure). `apps/api`: integration tests against the Neon `dev` branch via `DATABASE_URL_TEST`, each test file in its own schema-reset transaction or truncation helper. `apps/web`: Vitest + Testing Library for components with logic; Playwright smoke for the booking flow.
- Gate commands: `npm run typecheck`, `npm run lint`, `npm test -w <workspace>`, `npm run build`.

### AD-011 · MCP server
Streamable HTTP at `/api/mcp` (`@modelcontextprotocol/sdk` + `@hono/mcp`), bearer tokens stored hashed, scopes `read` / `read_write`, rate limited, destructive tools require `confirm: true`; every call audited with origin `MCP`.

### AD-012 · Design source
The claude.ai chat link in the request is private and not readable by agents. Design follows `docs/design/DESIGN.md` (from the Stitch export) and PRD §8 UI guidelines, which match (Josefin Sans/Jost, limestone surfaces, champagne signature never as text on light, bronze actions, walnut bands, Day/Night themes, architectural corners, thin icons, no emoji). Public home replicates `home-reference.html` section by section.

### AD-013 · Delivery split into features (PRD §9 order)
1. `fundacao` — monorepo, design system + UI shell, DB schema for all domains, auth, API skeleton, CI, first deploy.
2. `nucleo` — calendar config, availability, pricing, booking + checkout + gateway, Gestão de Reservas, policies, public site pages.
3. `receita` — hour packages, fixed-schedule packages, extra hours, credits, coupons, slot discounts, Perfil → Compras.
4. `gestao` — Financeiro/DRE, Integrações (ICS, MCP, e-mails, gateway config), Serviços Extras, Clientes, Salas, Usuários, Auditoria, PWA notifications.

### AD-014 · Hosting names
Netlify site `bravo-clinic`; Neon project `Bravo-clinic`; GitHub `tarouco/Bravo-clinic` (branch `main`).

### AD-015 · Native API paths without `/api`
The Hono app serves `/health`, `/public/*`, `/app/*`, `/admin/*`, `/webhooks/*`, `/jobs/*`, `/mcp`. Netlify rewrites `/api/*` → `<function-url>/:splat`; the Vite dev proxy strips `/api` the same way. Docs, browser and gateway webhooks use the public `/api/...` form; triggers and MCP clients use native paths on the function URL.
- **Why:** keeps AD-003 (single origin, first-party cookies) and AD-007 (`/jobs/<name>`) consistent with one route table.

### AD-016 · `_redirects` generated at build from `API_PROXY_ORIGIN`
`apps/web/scripts/write-redirects.mjs` writes `dist/_redirects` (`/api/*` proxy first, SPA fallback last). `API_PROXY_ORIGIN` is a Netlify env var per deploy context: production → production function URL; deploy-preview/branch-deploy → `dev` function URL. Missing or non-https fails the build.
- **Why:** `_redirects` cannot read env vars, and the function URL differs per Neon branch.

### AD-017 · Enumerations as `text` + `CHECK`, English codes, pt-BR labels in core
Status and type columns store English snake_case codes (`awaiting_payment`, `pre_reserved`, `confirmed`, ...). pt-BR labels ("Aguardando pgto", "Pré-reserva", "Confirmada", ...) live in `packages/core/src/labels.ts`.
- **Why:** adding a value is a cheap `CHECK` swap (no `ALTER TYPE`), and UI copy can change without migrations.

### AD-018 · Test databases
Local API integration tests use the Neon `dev` branch through `DATABASE_URL_TEST`; CI uses a `postgres:17` service container. API test files run serially and truncate all `public` tables before each test; the harness refuses to run against the production branch or `DATABASE_URL`.
- **Why:** isolated, free CI with `btree_gist` available; no cross-run interference.

### AD-019 · Settings as a typed key/value catalog
All configurable parameters of PRD §5.2/§5.4/§5.5 (and clinic/notification/MCP toggles) are rows of `settings(key, value jsonb)`. Keys, zod schemas and factory defaults live in `packages/core/src/settings/catalog.ts` (`docs/architecture.md` §4). Seeds insert defaults and never overwrite. Booking-time values are frozen in `bookings.policy_snapshot`.
- **Why:** PRD "nada é fixo no código" without a migration per parameter; one typed source for web and API.

### AD-020 · Design-token mapping
Colors are CSS variables with RGB channels (`--c-<token>`) switched by `data-theme="day|night"`; Tailwind colors are `rgb(var(--c-x) / <alpha-value>)`. Material tokens get the Night values in `docs/architecture.md` §9.3; `-night` and `*-fixed*` tokens are constants. Tailwind `borderRadius` copies the home-reference export (DEFAULT .125rem, lg .25rem, xl .5rem, full .75rem) plus semantic aliases `rounded-control` 2px, `rounded-card` 8px, `rounded-feature` 20px, `rounded-pill` 9999px. Material Symbols map to lucide (§9.4).
- **Why:** ported reference markup renders identically; DESIGN.md front matter has no Night values for Material tokens and a radius scale that conflicts with the export.

### AD-021 · Revocable sessions and lifetimes
The session JWT carries `sid`; `requireAuth` checks the `sessions` row (revoked/expired → 401). Lifetimes: tenant 30 days, admin/reception 12 hours. MFA state is per session (`mfa_verified_at`). Login lockout: 5 failures per e-mail per 15 min (counted in `rate_limit_buckets` by e-mail hash).
- **Why:** logout and password reset must revoke at once; staff sessions are privileged.

### AD-022 · Library version lines
React 18.3, React Router 6.30, TanStack Query 5, Tailwind 3.4, Vite 7, @vitejs/plugin-react 5, vite-plugin-pwa 1, Vitest 3.2, TypeScript 5.9, ESLint 9 + typescript-eslint 8, zod 4, Hono 4, drizzle-orm 0.45 / drizzle-kit 0.31, pg 8, jose 6, otpauth 9, @neon/functions 0.11, @neon/config 1. Workers run `npm view <pkg>@<line> version` and pin the newest patch; no major jumps without a new AD.
- **Why:** newer majors exist (React 19, Tailwind 4, Vite 8, TS 7) but AD-002 fixed the frontend lines and the ecosystem pairs above are known to work together.

### AD-023 · Fixed-schedule occurrences are bookings
Each occurrence of a fixed-schedule subscription is a `bookings` row (`kind = 'fixed_occurrence'`, `subscription_period_id`). Next-period occurrences held for the subscriber use status `held_for_renewal` ("Pré-reservada (renovação)") and become `confirmed` on renewal or `expired` when it fails. `room_occupancy.kind` is therefore only `booking` or `block`.
- **Why:** one exclusion constraint, one check-in/no-show/reschedule path, one ICS feed for every occupied slot.

### AD-024 · Shared zod schemas in `@bravo/core`
Form and request schemas (auth, later booking/purchase inputs) are defined once in `packages/core` with pt-BR messages and used by `react-hook-form` (zodResolver) and the API validator. `zod` is the only runtime dependency of core.
- **Why:** identical validation and messages in browser and server.

## Handoff

- 2026-10-25: Repo cloned, Neon project + branches created, Neon Function spike verified. Next: plan `fundacao` (spec/design/tasks), then the other three features in parallel.
- 2026-10-25: Planned `fundacao` (spec 134 reqs, design, tasks 78 in 14 phases) and wrote the global blueprint `docs/architecture.md` (full data model, API conventions, core signatures, deploy, frontend). Added AD-015..AD-024. Next: approve fundacao tasks and execute; plan nucleo/receita/gestao against `docs/architecture.md`.
