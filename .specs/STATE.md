# STATE — Bravô Clinic · Salas Inteligentes

Source of truth for product scope: `docs/prd.md` (PRD v1.6, 2026-10-25).
Design system: `docs/design/DESIGN-v3.md` + brand kit `docs/design/v3/` (AD-038). The v2 `docs/design/DESIGN.md` (Serene Architecture) and `home-reference.*` are historical.

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

### AD-025 · Notification event catalog and single emit point (gestao)
Event names, audience (tenant/staff), template owner and push text live in `packages/core/src/notifications/catalog.ts`. All notifications go through `modules/notifications.emit(tx, ctx, event)`: tenant events queue the owning feature's e-mail in the caller's transaction and send web push after commit; staff events fan out to `notification_recipients` when the matching `notifications.events` toggle is on (dedupe `staff:<event>:<entityId>:<recipientId>`). Until gestao lands, nucleo and receita queue every tenant e-mail through one helper per feature using the catalog's template names (nucleo `bookingMailer`, receita `revenueMailer`); gestao rewires those helpers to `emit()` and implements nucleo's `NotificationPort` (AD-033) with it. Staff event `payment_issue` has no toggle and is always sent.
- **Why:** one choke point for e-mail + push + staff notices without polling jobs; rolled-back transactions never notify.

### AD-026 · Binary uploads and room-photo media proxy (gestao)
Upload routes (`PUT .../attachment`, `PUT .../photo-uploads/:uploadId/:variant`) accept raw bodies (PDF/JPEG/PNG/WebP, ≤ 5 MiB, magic bytes checked) and are exempt from the JSON-only rule of `docs/architecture.md` §6.2. Room photos: the browser resizes to WebP `large` (≤ 1600 px) and `small` (≤ 800 px); objects go to bucket `room-photos` (`public_read`, `Cache-Control: public, max-age=31536000, immutable`, new key per upload) and are served same-origin at `/media/*` through a `_redirects` proxy rule emitted only when the build env `STORAGE_PUBLIC_ORIGIN` is set (extends AD-016). Expense attachments go to the private bucket `expense-attachments`, read through 300 s presigned URLs.
- **Why:** LCP budget and CSP stay intact without native image libraries on Neon Functions.

### AD-027 · Finance recognition contract (gestao, binds nucleo/receita data)
Every approved payment is a `charges` row with `purpose`, link (`booking_id` / `subscription_period_id` / `extra_hours_purchase_id`), `approved_at` and provider `fee_cents`; refunds are `refunds` rows `approved` with `completed_at`; credits used as payment are `charges` with `provider = 'internal'`, `method = 'credit'`. Caixa dates by `approved_at`/`completed_at`; Competência dates bookings by usage (`starts_at`, or `cancelled_at` when cancelled/expired), spreads subscription periods evenly per day, and dates extra hours at purchase. DRE gross = cash + discounts + credits used; discounts and credits are deducted on line 2. Computed in `packages/core/src/finance/`.
- **Why:** one definition shared by the screen, the `.xlsx` and MCP, exact to the cent.

### AD-028 · MCP tool boundary and server URL (gestao)
MCP tools call the same services as the Admin with `ctx.origin = 'mcp'` and the token owner (an active admin) as actor; every call writes `mcp.<tool>` to `audit_log`. Not exposed via MCP: users/roles, integration credentials, MCP tokens, LGPD actions, calendar/price/policy writes, closed days. Clients use the native function URL from env `API_FUNCTION_URL` + `/mcp` (Netlify proxy cuts streams at ~26 s).
- **Why:** PRD §8 "mesmas regras de permissão do Admin" plus a smaller blast radius for a leaked token.

### AD-029 · E2E and quality gates (gestao)
Playwright e2e (`npm run e2e -w apps/web`) covers the MVP journey and the admin configuration journey against the test database with the sandbox gateway; `@axe-core/playwright` requires zero WCAG 2.1 A/AA violations on the key pages in both themes; Lighthouse CI (`npm run lhci -w apps/web`, mobile) asserts LCP ≤ 2500 ms, CLS ≤ 0.1, accessibility ≥ 0.95 on `/`, `/salas`, `/salas/principal`.
- **Why:** PRD §9 MVP definition and §8 performance/compatibility become executable gates before the production release.

### AD-030 · Subscription checkout states and receita schema refinements (receita)
`subscriptions.status` adds `awaiting_payment` (Aguardando pgto) and `expired` (Expirada): `awaiting_payment → active | expired`, then the §3.2 machine; `subscriptions` gains `hold_expires_at`, `sale_mode` (`self|link|manual`), `switch_from_subscription_id`; one hour-package subscription per user in `awaiting_payment|active|suspended` (partial unique index). `subscription_periods.status` adds `cancelled`, plus `renewal_attempts` and `held_conflicts`; `minutes_balance >= 0`. Package minutes are granted when a period becomes `active` and are usable only for bookings dated inside it. New error codes: 409 `OCCURRENCE_CONFLICT`, 422 `COUPON_INVALID`.
- **Why:** fixed-schedule occurrences must be held during checkout under a parent row; one balance per tenant keeps the debit order unambiguous.

### AD-031 · receita plugs into nucleo's extension registry (receita)
receita registers checkout steps (`discount` 100, `package` 200, `credit` 400), payment-mode handlers (`package`, `subscription`), the live `CreditPort`, `ClosedDayCompensationPort`, an `AvailabilityDecorator` and two `CategoryHandler`s in `apps/api/src/extensions/index.ts`, and web components in nucleo's slots; nucleo never imports receita. receita needs nucleo to also expose: charge-purpose handlers for `subscription_initial|subscription_renewal|extra_hours` with booking-less charge create/submit/refund/cancel; the cancellation result in credit release; `CategoryHandler.onUpdate`; staff events `new_subscription`/`renewal_failed`; `expire-holds` and close-day treating `kind = 'fixed_occurrence'` as receita-owned (receita adds the `*/5` trigger `/jobs/expire-purchases`); zero-amount confirmation. All closed by AD-033 (final names in `.specs/features/receita/design.md` "Required from nucleo" table B and nucleo's "Cross-feature interface map").
- **Why:** one transaction per booking change for slots, minutes, credits and coupon counters, while nucleo ships and tests alone.

### AD-032 · Booking state-machine refinements (nucleo)
Architecture §3.1 gains three transitions: `expired → confirmed | paid` only through a late payment approval when the slot's occupancy can be re-inserted (else the charge is refunded), and `paid → confirmed` when an admin reschedule adds the price difference to the balance. A more expensive tenant reschedule is paid first: the new slot is held by a system block, a `booking_difference` charge is created and the move is applied on approval (nucleo table `booking_reschedule_requests`). Cleanup changes apply to every future active booking without a manual cleanup exception (`bookings.cleanup_overridden_*`), only after `findCleanupConflicts` is empty.
- **Why:** PRD §7.6 late approvals and §5.5 "paga a diferença no ato" without stranding the customer or bypassing the exclusion constraint.

### AD-033 · Extension registry and cross-feature ownership (nucleo)
`apps/api/src/extensions/registry.ts` exposes `checkoutSteps` (discount 100, package 200, extras 300, credit 400), `paymentModeHandlers`, `credits` (`CreditPort`, default `deferred`), `closedDayCompensation`, `availabilityDecorators`, `categoryHandlers` (+`onUpdate`), `chargeHandlers` (non-booking purposes), `notifications` (`notifyStaff`) and `roomMedia`; later features register in `apps/api/src/extensions/index.ts` and in web `apps/web/src/extensions/slots.tsx`. nucleo never writes credit tables: the deferred port records grants in `booking_events.data.creditGrant`, which receita's live port backfills. nucleo also owns `importNationalHolidays` (called by gestao's holiday jobs), `GET/POST /admin/customers` minimal search/create (gestao Clientes builds on them), `registerJob`/`runJob`, `listGatewayAdapters` + `PaymentGateway.verifyCredentials` (gestao Integrações), and the daily trigger `/jobs/materialize-blocks`. Mapping of sibling names: `.specs/features/nucleo/design.md` "Cross-feature interface map".
- **Why:** receita and gestao plug in without editing nucleo services, and delivery order (AD-013) stays valid.

### AD-034 · Payment-flow invariants (nucleo)
Webhook signatures are checked before any `webhook_events` insert; Mercado Pago status is always re-fetched from the provider; one pending charge per (booking, purpose); Pix and hosted-card expiry equal the booking hold; all effects go through one `applyProviderStatus` used by webhooks, sandbox and reconciliation. On the Neon `production` branch the sandbox hosted page's approve/reject requires an MFA-verified staff session. Tenant self-service booking returns 409 `BOOKING_NOT_OPEN` until `onboarding.prices_reviewed = true`.
- **Why:** the default sandbox gateway must not allow free bookings, and the first-access checklist is binding (PRD §10).

### AD-035 · API response contracts as zod in `@bravo/core` (nucleo, extends AD-024)
Response bodies, not only requests, are zod schemas in `packages/core/src/contracts/*`. API integration tests parse every response with them; web types are `z.infer` of them and MSW fixtures are parsed at import. Contracts change only through a core commit on `main`, noted in the feature design.
- **Why:** backend and frontend lanes run in parallel worktrees; drift fails a test in either lane.

### AD-036 · Build-time prerender of the public pages (gestao T48, amends AD-014)
`npm run build -w apps/web` prerenders `/`, `/salas` and every active `/salas/:slug` (room data from `API_PROXY_ORIGIN` at build time; the room pages are skipped when it cannot be reached) into `home.html`, `salas.html` and `salas/<slug>.html`, hydrated by the SPA (`hydrateRoot` with the dehydrated query state). `dist/index.html` stays the empty SPA shell and fallback (FND-125); `_redirects` gains a forced `/  /home.html  200!`. On prerendered pages the bundle and the Google Fonts stylesheet load once the hero image or video has painted (its `largest-contentful-paint` entry; 1.5 s after the first paint as fallback; hashed inline loader), so links work at once and buttons after hydration. Waiting for the first paint alone was not enough on `/`, where the video poster paints a few frames later and the bundle then counted against LCP (production 2.8 s, runs up to 4.4 s). Lighthouse budgets are measured against a Netlify draft deploy (`LHCI_URL_BASE`).
- **Why:** a client-rendered SPA could not paint before its bundle and the two font origins on the mobile preset (LCP ~2.9–3.4 s); with prerender the three public pages measure 1.2–1.6 s (GES-143).

### AD-037 · Optional two-factor authentication (amends AD-034, AD-005 and PRD §8 "Admin com 2FA obrigatório")
TOTP is opt-in for every role (tenant, reception, admin) and off by default: each user turns it on or off in `/app/perfil/seguranca` ("Verificação em duas etapas"; linked from `/app/perfil` and the admin top bar); nothing redirects to enrollment and `MFA_ENROLLMENT_REQUIRED` is gone (`/login/2fa/configurar` redirects to the page). A user with a confirmed TOTP gets `mfaRequired: true` from password login (Google redirects to `/login/2fa?next=`), and while that session is not MFA-verified `requireMfaIfEnrolled` answers 403 `MFA_REQUIRED` on `/app/*` except `GET /app/me`, `POST /app/auth/totp/verify` and `POST /app/auth/logout`; `requireStaff` keeps the role check and refuses only enrolled, unverified staff sessions, and the production sandbox decision follows the same rule. `POST /app/auth/totp/disable` (current or recovery code, FND-68/69 rules, MFA-verified session) deletes the `user_totp` row and audits `user.totp_disabled` (FND-135..137). MCP tokens and `POST /admin/users/:id/totp-reset` (GES-114) are unchanged.
- **Why:** user decision 2026-10-28: the admin was stuck at `/login/2fa/configurar` after the first login; mandatory staff enrollment blocked access instead of protecting it, so 2FA becomes a per-user choice.

### AD-038 · Design System v3 is the design source (rebrand-v3, supersedes AD-012 and the DESIGN.md palette)
The brand kit exported 2026-10-28 lives in `docs/design/v3/bravo-clinic-design-system/` (tokens, `bundle.css`, guides, examples) with the PDF beside it; `docs/design/DESIGN-v3.md` summarises it and lists the derived decisions. `apps/web/src/styles/tokens.css` holds the kit's Dia/Noite colors as RGB channels plus plain-name `rgb()` variables; `tokens.test.ts` and `tailwind-config.test.ts` compare them with the kit files. Plan: `docs/design/PLANO-ATUALIZACAO-V3.md`.
- **Why:** user decision 2026-10-28: rebrand the whole system to the v3 brand book (névoa, esmeralda, ouro, Marrom Luxo, relief pills, neon interaction).

### AD-039 · Two-step migration through aliases (rebrand-v3)
Step 1 keeps every v2 class name (`bronze`, `champagne`, `walnut`, Material roles…) as an alias of a v3 value (`bronze`→`accent`, `champagne`→`gold`, `walnut`→`accent-deep`, `surface-stone`→`surface-deboss`, `error`→`danger`; radius `control`→pill, `card`→28px), so the whole app switches palette at once and stays deployable. Step 2 (phase 7) renames the classes by codemod and deletes the aliases. `accent` is emerald by day and gold by night (text/icon highlight, active state, focus ring); filled actions use `emerald` in both themes.
- **Why:** ~1,300 `ink`, ~225 `bronze` and 160+ styled files; renaming first would be one undeployable change.

### AD-040 · v3 components as CSS + React, not `bundle.js` (rebrand-v3)
`bundle.css` is ported to `apps/web/src/styles/bv.css` (theme selector `[data-theme='night']`, fonts and gradients moved to tokens), imported before the Tailwind layers so utilities override `bv-*`. The kit's script behaviours (click lights the neon 1.6 s, single-choice groups, slider drag, nav state) are React state and hooks in `components/ui`.
- **Why:** the kit script writes `aria-*` straight into the DOM, which React would overwrite on the next render.

### AD-041 · Theme attribute stays `day`/`night` (rebrand-v3)
The kit uses `data-theme="dark"`; the app keeps `day`/`night` (stored preference, prerendered markup, `darkMode` selector) and applies Noite v3 on `[data-theme='night']`.

### AD-042 · Derived tokens where v3 is silent (rebrand-v3)
`danger` #A12A1E / Noite #FFB4A6 (≥5:1 on every surface), `danger-soft`, warnings as gold fill + `on-gold` text (never yellow text), success = emerald; form fields sink (`bv-field`: `surface-deboss` + `deboss`, `radius-md`, neon focus) while actions rise; admin tables use pearl rows with `eyebrow` headers. Typography: the kit sizes are app sizes (`-mobile`, `body`/`label`/`caption`); unsuffixed `display-*`, `heading` and `lead` are ~1.3–1.4× web variants. Marked "derived" until the brand validates them.

### AD-043 · Link preview shows the logo banner (FND-123)
`og:image` / `twitter:image` = `public/og-logo.jpg`, a 1200×630 banner of the Ô monogram and the BRAVÔ / CLINIC / SALAS INTELIGENTES lockup in Josefin Sans, `gold` on the emerald gradient (`summary_large_image`, chosen by Eduardo on 2026-10-29). It is set in type because the only logo files are photo crops; regenerate it when the official vectors arrive. A new filename busts the WhatsApp/Facebook preview cache. `og-image.jpg` (room photo) stays as the JSON-LD `image`; `logo` points to the banner.

## Handoff

- 2026-10-25: Repo cloned, Neon project + branches created, Neon Function spike verified. Next: plan `fundacao` (spec/design/tasks), then the other three features in parallel.
- 2026-10-25: Planned `fundacao` (spec 134 reqs, design, tasks 78 in 14 phases) and wrote the global blueprint `docs/architecture.md` (full data model, API conventions, core signatures, deploy, frontend). Added AD-015..AD-024. Next: approve fundacao tasks and execute; plan nucleo/receita/gestao against `docs/architecture.md`.
- 2026-10-25: Planned `nucleo`, `receita` and `gestao` (spec/design/tasks, 50 tasks each) and reconciled their interfaces: receita and gestao use nucleo's extension-registry names (checkout steps incl. `extras`, `Quote.extensions`, slot names, `resolveGateway`, `buildIcs`, `NotificationPort` with `entityId`); receita template names follow gestao's notification catalog; gestao's Required-from table cites producer tasks. Added AD-025..AD-035. Next: execute `fundacao`, then `nucleo` → `receita` → `gestao` (lanes in parallel inside each).
- 2026-10-26: `fundacao` executed (78 tasks) and first production deploy done. Site https://bravo-clinic.netlify.app (Netlify site `bravo-clinic`, id `d92faacc-3e90-4bfd-984f-ee087514328f`, deployed from local build via `netlify deploy --prod --filter @bravo/web --dir apps/web/dist`). API Neon Function `api` on `production`: https://br-polished-darkness-b8jbvs2x-api.compute.c-14.us-east-1.aws.neon.tech (deployed with `npx neonctl deploy --project-id dry-dream-65262086 --branch production --env <operator env file>`). Netlify env: `API_PROXY_ORIGIN` (function URL), `VITE_SITE_URL`. Production DB migrated and seeded (18 tables, 3 rooms, 28 holidays, 38 settings, 1 admin). `node scripts/smoke.mjs` green. Open: admin first login + TOTP enrollment (user), request-log line not found in `neon logs query` output (only invoke begin/end + pg sslmode warning), setting `clinic.whatsapp_e164` empty until the admin fills it. Already merged ahead: nucleo Phase 1 + web Phases 7–8, receita Phases 1–2 (core), gestao T1–T2 (core). In flight: nucleo lane A Phases 2–3, lane B Phases 9–10.
- 2026-10-26: `nucleo` executed (50 tasks) and rolled out (T50). Integration fixed clinic cancellation of pending bookings, reschedule overlapping the booking's own slot (new `GET /app/bookings/:id/reschedule/availability`), availability p95 (~590 → ~150 ms), Pix hosted-checkout link and `ApiError.details` typing; Playwright e2e 8/8 (`npm run e2e -w apps/web`, real API on `DATABASE_URL_TEST`, installed Chrome via `channel: 'chrome'`). Production: migrations 0000–0003 (30 tables), seed idempotent re-run, `api` redeployed with the six schedule triggers (all five 5-minute jobs logged `ok` in `job_runs` at 22:05Z), web redeployed with `API_PROXY_ORIGIN` = function URL, `node scripts/smoke.mjs` green incl. public rooms and day availability. Ops notes: drive C: nearly full (point TEMP/TMP into the worktree for installs, eslint and e2e); the main checkout may be on another session's branch (`gestao/web-visual-media`, Home photos/video, not merged) — orchestrate `main` from a worktree. In flight: nucleo independent verification; receita lane A Phases 3–4. Next: receita Phases 5–6 → Phase 10 e2e → verify → redeploy; then gestao lane A, Phases 11–12, final release.
- 2026-10-28: `receita` executed (50 tasks), verified and rolled out. Phase 10 e2e (3 specs, desktop + mobile) found and fixed renewal holds missing from the admin calendar feed (`2f079b7`). Verification iteration 1 FAIL (157/161, 13/16 mutants: wall-clock reads, three untested branches), fixed in `8261082` + `b0fdc11` (request/job clock passed through the nucleo seams as an explicit `now`) and test commits; iteration 2 PASS (161/161, 16/16 mutants, core 1191, web 1191, api 1041, e2e 14/14); all REC rows `Verified` (`2d8766c`). Production at `27b56bc`: migrations 0004–0007 applied (0007 is gestao's additive schema), seed re-run (no-op), `api` redeployed with triggers `renewals`/`period-rollover`/`suspensions` (`0 6 * * *`) and `expire-purchases` (`*/5`), web rebuilt with `API_PROXY_ORIGIN` and deployed, `node scripts/smoke.mjs` 5/5, `expire-purchases` logged `ok` at 01:00Z. Ops notes: an unrelated Docker stack holds :5173, so e2e runs need a temporary config on 127.0.0.1; the nucleo availability p95 e2e (300 ms) flaps on the cold verify branch (286–333 ms). Open: F6 (minor, clock assertions at `cancel.service.ts:250`, `ports.ts:64`). In flight: gestao lane A Phases 5–6 (T20–T27); gestao T1–T19 merged on `main`. Next: gestao Phase 11 integration, Phase 12 hardening + final release (VAPID keys, buckets, gestao triggers at T49).
- 2026-10-28: `gestao` T1–T47 executed and verified, backend and site released (T49–T50). Verification iteration 1 FAIL (3 surviving mutants, missing tests only), fixed in the F1–F6 test commits; iteration 2 PASS (142 rows Verified, 27/27 behavioural mutants killed, core 1194, web 1213, api 1228). T47: axe WCAG 2.1 AA on 13 pages × Day/Night × desktop/mobile, zero violations. Production at `ab1deb5`: migrations through 0007 (no-op, already applied), seed no-op (14 expense categories, 3 extra services present), `api` redeployed with VAPID keys and `API_FUNCTION_URL`, buckets `room-photos` (public_read) and `expense-attachments` (private), triggers `email-retry`, `retention`, `recurring-expenses`, `holiday-reminder`, `import-holidays` (15 triggers total). Netlify env `STORAGE_PUBLIC_ORIGIN` = branch storage endpoint (`/media/*` → `room-photos`), web deployed, `node scripts/smoke.mjs` 9/9 (extras, `/servicos-extras`, ICS 404, MCP 404 while disabled). Open: T48 LCP budget (production medians `/` 3256 ms, `/salas` 2961 ms, `/salas/principal` 2930 ms against 2500; CLS/a11y pass) — early data fetch, poster preload and, if needed, prerendering in progress, measured against draft deploys with `LHCI_URL_BASE`; user manual checks: admin TOTP enrollment, `clinic.whatsapp_e164`, Integrações shows the MCP URL and payments tab; the availability p95 e2e (300 ms) still flaps on this host; receita F6 minor; dev-branch spike function still present (delete needs the user's OK).
- 2026-10-28: gestao T48 merged (`cea300e`) and released. First production run after the merge: `/` median 2829 ms (runs to 4427) because the loader requested the bundle at first paint, before the hero poster painted; fixed in `fbb9dfb` (loader waits for the hero's LCP entry; CSP hash updated, behavioural loader tests). Draft `6ae24421…` then production at `f701ee6`: Lighthouse mobile medians `/` 2015 ms, `/salas` 1373 ms, `/salas/principal` 1503 ms, CLS ≤ 0.002, a11y ≥ 0.98, `lhci` exit 0. `scripts/smoke.mjs` now asserts the prerendered hero `<h1>` (FND-129 original wording; the SPEC_DEVIATION recorded in fundacao `validation.md` is resolved), 9/9 on production. GES-143 and GES-144 are `Implemented`; independent verification of both is open. Open: user manual checks (admin TOTP enrollment, `clinic.whatsapp_e164`, Integrações MCP URL + payments tab), T47 follow-up `heading-order` on `/` and `/salas`, no room photos uploaded yet (LCP measured on the placeholder), availability p95 e2e flake, receita F6, dev-branch spike function (delete needs the user's OK).
- 2026-10-29: `rebrand-v3` executed on `feat/rebrand-v3` and merged to `main` (plan `docs/design/PLANO-ATUALIZACAO-V3.md`, decisions AD-038..AD-042). Brand kit in `docs/design/v3/` (the 11 MB PDF and 10 MB ZIP stay untracked in `docs/design/`). Phases 0–3 (tokens, `bv.css`, primitives, shells) here; phases 4 (site + auth), 5 (tenant app) and 6 (admin + calendars) in three parallel worktrees, merged without conflicts; phase 7: e-mail layout colors, PWA icons + og-image (Ô monogram, provisional), v2 aliases removed, `Button` `danger`, `StatTile tone="gold"`, toast stack fixed for phones (`inset-x-4`; the old `left-1/2` + translate widened the mobile layout viewport to 848 px). Gates: typecheck, eslint, prettier, web Vitest 1296/1296; e2e 76/78 with axe A/AA green in Dia/Noite after fixing the auth brand link name (WCAG 2.5.3). The two e2e failures also fail on `main` 461aa24 (verified): `receita-discounts` on mobile when run after desktop (coupon sheet click intercepted after the visual viewport pans; passes alone) and `admin.spec` reusing the admin TOTP step without waiting (`loginAdmin` waits). Open: copy pass ("Reservar Sala", "Gestão de Reservas", simulator captions, new "Melhor valor por hora", WhatsApp "Olá, quero…"), app Agenda still month/week/day views, brand assets (vector logo, fonts, photos, icons), derived tokens awaiting brand validation, API e-mail layout needs the next `api` deploy.
- 2026-10-29: `api` redeployed on `production` (deployment 6) from `main` f960e12 with `neonctl functions deploy api --src apps/api/src/index.ts` and no `--env`, which keeps the live keys (proven first on a throwaway `dev` function, since deleted); the 8 keys are unchanged. Ships the v3 e-mail layout and the optional 2FA API (AD-037). The root `.env` is a dev file (`APP_BASE_URL=http://localhost:5173`) and must never feed a production `neon deploy --env`. Smoke 9/9, `/health` ok.
- 2026-10-29: link preview switched to the logo banner (AD-043, `701e385`): web built locally with the production env (`API_PROXY_ORIGIN`, `STORAGE_PUBLIC_ORIGIN`, `VITE_SITE_URL` read with `netlify env:get --filter @bravo/web`) and deployed with `netlify deploy --prod --no-build --filter @bravo/web --dir apps/web/dist` (without `--no-build` the CLI re-runs the build and fails on `EALLOWSCRIPTS`). Live on https://www.bravoclinic.com.br and bravo-clinic.netlify.app, smoke green. Open: `VITE_SITE_URL` is still the netlify.app address, so `og:url`, `og:image`, canonical JSON-LD and the sitemap point there instead of the custom domain.
