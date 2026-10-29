# Fundação Specification

## Problem Statement

Bravô Clinic has a PRD, a design system and architecture decisions, but no code. Every later feature (nucleo, receita, gestao) needs the same base: a monorepo with quality gates, pure money/time helpers, an API that boots on Neon Functions with a migrated database, authentication with optional TOTP 2FA, an audit trail, the Day/Night design system, the public home page and the app/admin shells. Building this once, tested and deployed, removes setup work and inconsistency from the three revenue-bearing features.

## Goals

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` exits 0 on a clean clone with only `.env` filled from `.env.example`.
- [ ] A visitor can open the production Home (replica of `docs/design/home-reference.html`), sign up with CPF or CNPJ, verify the e-mail and log in; an admin logs in with TOTP 2FA and sees the Admin shell.
- [ ] `https://<site>/api/health` returns 200 through the Netlify proxy against the Neon `production` branch, with the base migration and seeds applied.
- [ ] The base schema enforces "no double booking" in Postgres (exclusion constraint) before any booking code exists.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Availability engine, pricing engine, booking, checkout, gateway adapters, jobs/triggers | `nucleo` (AD-013) |
| Booking categories, bookings, charges and all other non-base tables | Created by the owning feature's migration (`docs/architecture.md` §5) |
| Live data on Home (rooms, prices, availability) | Home ships static content now; `nucleo` wires it |
| Packages, extra hours, credits, coupons, slot discounts | `receita` |
| Financeiro, Integrações screens, MCP, ICS feeds, web push, quote request persistence, Object Storage uploads | `gestao` |
| Admin screens' contents (Calendário, Gestão de Reservas, ...) | Shell + placeholders only; content in later features |
| BrasilAPI holiday import job | `gestao` (AD-007 daily job); fundacao seeds a static 2026–2027 list |
| Legal texts (termos, privacidade) | Supplied by the clinic (PRD §11); placeholder pages now |
| Analytics (GA4/PostHog) | Funnel events belong to `nucleo` booking flow |
| LGPD data export/deletion endpoints | `gestao`; fundacao only records consents |
| Neon Auth | AD-005 chose in-house auth |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| home-reference.html contradicts the PRD in places (São Paulo/Jardins address, "sinal reembolsável 7 dias antes", "Exclusivo Salas 1 & 2", "Turno completo 5h30", footer hours "07:00 às 00:00 Seg a Dom") | Keep the reference layout, classes and copy; replace only facts that contradict the PRD (list in design.md §Home content corrections) | PRD is the product source of truth; the design is the visual model | n |
| Reference icons are Material Symbols | Map each to a lucide icon (`docs/architecture.md` §9.4), stroke 1.5 | AD-002 mandates lucide thin icons | n |
| Reference radius scale differs from DESIGN.md front matter | Tailwind keys copy the reference export (DEFAULT .125rem, lg .25rem, xl .5rem, full .75rem) plus semantic aliases (`rounded-control/card/feature/pill`) | Ported markup renders pixel-identical; new components use semantic names (AD-020) | n |
| DESIGN.md defines no Night value for Material tokens | Night mapping table in `docs/architecture.md` §9.3 | Night theme needs a value for every utility the Home uses | n |
| Reference uses desktop type sizes on mobile | Display/heading use `*-mobile` sizes below `md` and DESIGN.md sizes from `md` up | DESIGN.md defines mobile variants; PRD is mobile-first | n |
| Quote modal on Home has no backend yet | Submitting opens WhatsApp (`https://wa.me/<number>?text=<message>`) in a new tab with service, name and details | Real persistence is gestao; a fake "received" message would mislead | n |
| WhatsApp number is unknown | Setting `clinic.whatsapp_e164` (default `""`); empty → link `https://wa.me/` like the reference | PRD §11 lists the number as a clinic dependency | n |
| Street address is unknown | JSON-LD/Home/footer use "Praia Brava, Itajaí – SC" without street | PRD §1 gives only neighborhood and city | n |
| Data Magna de SC 2027 date "a confirmar" | Seed 2027-08-15 (Sunday after Aug 11, same rule that yields 2026-08-16) with `needs_review = true` | PRD §5.2 table; flagged for the Oct 1 review | n |
| National holidays 2026–2027 | Static seed of the 10 national holidays per year (Carnaval excluded: ponto facultativo, manual per §5.2) | System works without BrasilAPI; gestao import refreshes | n |
| Password policy not in PRD | 8–128 chars, at least one letter and one digit | Common baseline; PRD silent | n |
| Session lifetime not in PRD | Tenant 30 days (PWA "login persistente"), staff 12 hours | Persistent tenant login (§7.2) vs privileged staff sessions | n |
| Signup logs the user in before e-mail verification | Yes; booking is blocked until verified (nucleo enforces) | PRD §7.4 only requires verification before the first booking | n |
| Duplicate CPF/CNPJ at signup | Rejected with 409 `DOCUMENT_TAKEN` | Coupon eligibility is by document (§5.3.4); one account per document | n |
| Login error enumeration | Same 401 message for unknown e-mail and wrong password; password-reset request always 202 | Avoid account enumeration | n |
| 2FA recovery | 10 single-use recovery codes shown once at enrollment; admin bootstrap env can create a fresh admin if all admins are locked out | 2FA is optional for every user (user decision 2026-10-28, AD-037, amends PRD §8 "2FA obrigatório"); whoever turns it on must still be able to recover from a lost authenticator | n |
| Google OAuth users without CPF/CNPJ | Created as tenant with no document; must complete profile before booking (nucleo enforces) | Google does not provide a document | n |
| Reception 2FA | Optional, same as admin and tenants: each user turns TOTP on or off in `/app/perfil/seguranca` | User decision 2026-10-28 (AD-037, amends AD-005) | y |
| CI database | postgres:17 service container; local runs use Neon `dev` via `DATABASE_URL_TEST` | Isolated, free, no shared-branch flakiness (AD-018) | n |
| Production deploy | Last phase; runs only after explicit user go-ahead | Skill blast-radius rule: deploys need explicit approval | y |
| Minimum booking advance | `calendar.min_advance_minutes = 0` | PRD §7.3.1 names the parameter without a default | n |
| Expired auth tokens/sessions retention | Kept; purge belongs to gestao's LGPD retention work | Fundacao has no job runner | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Monorepo and quality gates ⭐ MVP

**User Story**: As a developer, I want one npm-workspaces repo with strict TypeScript, lint and tests, so that every feature ships through the same gates.

**Why P1**: All later tasks depend on these commands.

**Acceptance Criteria**:

1. The root `package.json` SHALL declare workspaces `apps/web`, `apps/api` and `packages/core`, and `npm install` at the root SHALL install all three. [FND-01]
2. WHEN `npm run typecheck` runs THEN the system SHALL type-check every workspace with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled and exit 0 on a clean tree. [FND-02]
3. WHEN `npm run lint` runs THEN ESLint SHALL lint every workspace and exit non-zero on any error-level finding. [FND-03]
4. WHEN `npm test -w <workspace>` runs THEN Vitest SHALL run that workspace's tests and exit non-zero if any test fails. [FND-04]
5. WHEN `npm run build` runs THEN the system SHALL produce `apps/web/dist/index.html` and exit 0. [FND-05]
6. IF a file under `packages/core/src` imports `pg`, `drizzle-orm`, `hono`, `react`, `react-dom` or any `node:` module THEN `npm run lint` SHALL fail with a `no-restricted-imports` error. [FND-06]

**Independent Test**: Clone, `npm install`, run the four commands; add a forbidden import to core and see lint fail.

---

### P1: Money and time helpers ⭐ MVP

**User Story**: As a developer, I want shared money/time helpers in `@bravo/core`, so that browser and server compute identical values in cents and São Paulo time.

**Why P1**: Pricing, policies and display all depend on them.

**Acceptance Criteria**:

1. WHEN `formatBRL(160000)` is called THEN core SHALL return `"R$ 1.600,00"` with U+00A0 between `R$` and the digits. [FND-07]
2. WHEN `percentOfCents` is called THEN core SHALL round half up, returning 7275 for (14550, 50) and 4851 for (9701, 50). [FND-08]
3. WHEN `parseBRLToCents` receives "1.600,00", "R$ 97" or "97,5" THEN core SHALL return 160000, 9700 and 9750; IF the input is not a BRL amount THEN it SHALL return null. [FND-09]
4. WHEN `localToUtc('2026-10-27', 600)` is called THEN core SHALL return the instant `2026-10-27T13:00:00.000Z`, and `localToUtc('2026-10-27', 1440)` SHALL return `2026-10-28T03:00:00.000Z`. [FND-10]
5. WHEN `utcToLocal(new Date('2026-10-28T02:30:00Z'))` is called THEN core SHALL return `{ date: '2026-10-27', minuteOfDay: 1410, weekday: 2 }`. [FND-11]
6. The time module SHALL derive UTC offsets from the IANA zone `America/Sao_Paulo` through `Intl.DateTimeFormat` and SHALL contain no hard-coded offset string. [FND-12]
7. WHEN `formatDateTimeBR(new Date('2026-10-27T13:00:00Z'))` is called THEN core SHALL return `"27/10/2026 10:00"`. [FND-13]

**Independent Test**: `npm test -w packages/core` with the values above.

---

### P1: Document and credential validation ⭐ MVP

**User Story**: As a visitor signing up, I want my CPF or CNPJ and password checked immediately, so that I fix mistakes before submitting.

**Why P1**: PRD §7.4 requires CPF or CNPJ; coupon eligibility depends on it.

**Acceptance Criteria**:

1. WHEN `parseDocument('529.982.247-25')` is called THEN core SHALL return `{ type: 'cpf', digits: '52998224725' }`. [FND-14]
2. WHEN `parseDocument('11.222.333/0001-81')` is called THEN core SHALL return `{ type: 'cnpj', digits: '11222333000181' }`. [FND-15]
3. IF the document has a wrong check digit, all-equal digits, or a digit count other than 11 or 14 THEN `parseDocument` SHALL return null. [FND-16]
4. IF a password is shorter than 8 characters, longer than 128, or lacks a letter or a digit THEN the shared password schema SHALL reject it with the message "A senha precisa ter de 8 a 128 caracteres, com letras e números". [FND-17]

**Independent Test**: core unit tests with the sample documents and passwords.

---

### P1: Settings catalog ⭐ MVP

**User Story**: As the Administrador geral, I want every rule of §5.2, §5.4 and §5.5 stored as a typed setting with the factory default, so that nothing is hard-coded.

**Why P1**: PRD §5 "Nada é fixo no código".

**Acceptance Criteria**:

1. The settings catalog in `packages/core/src/settings/catalog.ts` SHALL define every key of `docs/architecture.md` §4 with its zod schema and the listed factory default. [FND-18]
2. IF `parseSetting(key, value)` receives a value that fails the key's schema THEN it SHALL throw `SettingValidationError` whose message contains the key. [FND-19]
3. WHEN the seed runs on an empty database THEN the `settings` table SHALL contain exactly one row per catalog key holding the factory default. [FND-20]

**Independent Test**: unit test on the catalog; integration test counting seeded rows.

---

### P1: API skeleton ⭐ MVP

**User Story**: As a developer, I want a Hono API with env parsing, a DB pool, a uniform error format and request logging, so that every endpoint behaves consistently.

**Why P1**: Every route of every feature runs on it.

**Acceptance Criteria**:

1. WHEN `GET /api/health` is called and the database answers THEN the API SHALL return 200 `{ "status": "ok", "db": "ok", "branch": <NEON_BRANCH or null> }`. [FND-21]
2. IF the health database query fails THEN the API SHALL return 503 `{ "status": "degraded", "db": "error" }`. [FND-22]
3. IF `DATABASE_URL`, `SESSION_SECRET` (≥ 32 chars), `ENCRYPTION_KEY` (base64 of 32 bytes), `APP_BASE_URL` (URL) or `EMAIL_FROM` (e-mail) is missing or invalid at startup THEN env parsing SHALL throw an error listing the offending variable names and SHALL NOT include their values. [FND-23]
4. IF a request body, query or param fails its zod schema THEN the API SHALL return 422 `{ error: { code: 'VALIDATION_FAILED', message: 'Dados inválidos', details: [{ path, message }], requestId } }`. [FND-24]
5. IF no route matches THEN the API SHALL return 404 with error code `NOT_FOUND`. [FND-25]
6. IF a handler throws an unexpected error THEN the API SHALL return 500 with code `INTERNAL`, message "Erro interno" and the requestId, and SHALL NOT include a stack trace or SQL in the body. [FND-26]
7. The API SHALL write one JSON log line per request with `requestId`, `method`, `path`, `status` and `durationMs`, SHALL return the requestId in the `X-Request-Id` header, and SHALL redact values of keys matching `pass|token|secret|authorization|cookie|code`. [FND-27]
8. WHEN the callback given to `withTransaction` throws THEN every write made through its `tx` SHALL be rolled back. [FND-28]
9. IF a mutating request (POST/PUT/PATCH/DELETE) lacks `Content-Type: application/json` THEN the API SHALL return 415 `UNSUPPORTED_MEDIA_TYPE`. [FND-29]

**Independent Test**: `app.request()` integration tests for health, 404, 422, 415, 500 and logs.

---

### P1: Base schema and migrations ⭐ MVP

**User Story**: As the clinic, I want the cross-cutting tables and the double-booking guard in Postgres, so that later features build on a consistent, safe schema.

**Why P1**: PRD §8 requires prevention of double booking in the database.

**Acceptance Criteria**:

1. WHEN `npm run db:migrate -w apps/api` runs against an empty database THEN the tables `users, sessions, auth_tokens, user_totp, consents, rate_limit_buckets, rooms, room_photos, settings, business_hours, holidays, closed_days, block_recurrences, blocks, room_occupancy, audit_log, email_outbox, integration_settings` and the extension `btree_gist` SHALL exist. [FND-30]
2. WHEN the migration command runs a second time THEN it SHALL apply no statements and exit 0. [FND-31]
3. IF a second active `room_occupancy` row for the same room overlaps an existing active row THEN Postgres SHALL reject the insert with SQLSTATE `23P01`. [FND-32]
4. WHEN two active rows of the same room touch end-to-start (`[09:00, 11:30)` and `[11:30, 12:30)`) THEN Postgres SHALL accept both. [FND-33]
5. WHILE a `room_occupancy` row has `active = false` Postgres SHALL accept an overlapping active row for the same room, and rows of different rooms SHALL never conflict. [FND-34]
6. IF an `UPDATE` or `DELETE` targets `audit_log` or `consents` THEN Postgres SHALL raise an error and leave the row unchanged. [FND-35]
7. The base schema SHALL store instants as `timestamptz`, local calendar dates as `date`, and money as integer columns suffixed `_cents`. [FND-36]

**Independent Test**: integration tests running the migrator on `DATABASE_URL_TEST` and inserting conflicting occupancy rows.

---

### P1: Seeds and admin bootstrap ⭐ MVP

**User Story**: As the Administrador geral, I want the rooms, hours, holidays and settings pre-loaded, and my first admin account created from environment variables, so that the system is usable on first access.

**Why P1**: PRD §5.1, §5.2 and the first-access flow.

**Acceptance Criteria**:

1. WHEN the seed runs THEN `rooms` SHALL contain "Sala Principal" (`principal`, ideal for Médico, Estética, Gravação de vídeos), "Sala Secundária" (`secundaria`, same tags) and "Sala Terceira" (`terceira`, Massagem, Terapia, Estética), all active, display order 1, 2, 3. [FND-37]
2. WHEN the seed runs THEN `business_hours` SHALL hold mon–fri 420–1440 (07:00–00:00) and sat, sun, holiday 540–1440 (09:00–00:00), all open. [FND-38]
3. WHEN the seed runs THEN `holidays` SHALL contain the 28 rows listed in design.md §Holiday seed (20 national, 8 SC/Itajaí), all `is_closed = false`, with only Data Magna 2027 (2027-08-15) marked `needs_review = true`. [FND-39]
4. WHEN the seed runs a second time THEN it SHALL insert no duplicate rows and SHALL NOT overwrite existing settings, business hours, rooms or holidays. [FND-40]
5. WHERE `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` are set and no admin user exists, the seed SHALL create an admin with a verified e-mail and write audit action `user.bootstrap_admin` with origin `system`. [FND-41]
6. IF an admin user already exists THEN the seed SHALL create or modify no admin account. [FND-42]

**Independent Test**: integration test runs the seed twice and inspects rows.

---

### P1: Sign up and verify e-mail ⭐ MVP

**User Story**: As a professional (Dra. Camila, Juliana, Rafael), I want to create an account with my CPF or CNPJ and confirm my e-mail, so that I can book rooms.

**Why P1**: PRD §7.4; booking requires a verified account.

**Acceptance Criteria**:

1. WHEN `POST /api/public/auth/signup` receives a valid body (name, document, email, phone, optional profession and professional registry, password, `acceptTerms: true`, `acceptPrivacy: true`) THEN the API SHALL return 201 with the user (no password hash), create a `tenant` user with a scrypt password hash, set the session cookie, record `terms` and `privacy` consents with version, IP and timestamp, and queue an `auth.verify_email` message in `email_outbox`. [FND-43]
2. IF the document fails `parseDocument` THEN the API SHALL return 422 with detail path `document` and message "CPF ou CNPJ inválido". [FND-44]
3. IF the e-mail already belongs to a user, compared case-insensitively THEN the API SHALL return 409 `EMAIL_TAKEN`. [FND-45]
4. IF the document already belongs to a user THEN the API SHALL return 409 `DOCUMENT_TAKEN`. [FND-46]
5. IF `acceptTerms` or `acceptPrivacy` is not `true` THEN the API SHALL return 422 and create no user. [FND-47]
6. WHEN `POST /api/public/auth/verify-email` receives an unused, unexpired token THEN the API SHALL set `email_verified_at`, mark the token used and return 200. [FND-48]
7. IF the verification token is unknown, used, or older than 24 hours THEN the API SHALL return 400 `INVALID_TOKEN`. [FND-49]
8. WHEN an authenticated unverified user calls `POST /api/app/auth/verify-email/resend` THEN the API SHALL queue a new verification e-mail and return 202; IF it is the fourth call within one hour THEN it SHALL return 429 `TOO_MANY_ATTEMPTS`. [FND-50]
9. The system SHALL store only the SHA-256 hash of verification and password-reset tokens. [FND-51]

**Independent Test**: integration tests through `app.request()` reading `email_outbox` for the token.

---

### P1: Log in, session and log out ⭐ MVP

**User Story**: As a registered user, I want to log in once and stay logged in on my phone, so that I reach my bookings quickly.

**Why P1**: Every authenticated feature depends on sessions.

**Acceptance Criteria**:

1. WHEN `POST /api/public/auth/login` receives the correct e-mail and password of a tenant THEN the API SHALL return 200 `{ user, mfaRequired: false }`, create a `sessions` row and set cookie `bravo_session` with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. [FND-52]
2. IF the password is wrong or the e-mail is unknown THEN the API SHALL return 401 `INVALID_CREDENTIALS` with the message "E-mail ou senha incorretos" in both cases. [FND-53]
3. IF 5 failed logins for the same e-mail happen within 15 minutes THEN the next attempt SHALL return 429 `TOO_MANY_ATTEMPTS` with a `Retry-After` header, even with the correct password. [FND-54]
4. WHEN an authenticated user calls `POST /api/app/auth/logout` THEN the API SHALL set `revoked_at` on the session, clear the cookie with `Max-Age=0` and return 204. [FND-55]
5. IF a request carries a session JWT with an invalid signature, an expired `exp`, or a revoked or expired session row THEN the API SHALL return 401 `UNAUTHENTICATED` on `/api/app/*` and `/api/admin/*`. [FND-56]
6. WHEN `GET /api/app/me` is called with a valid session THEN the API SHALL return 200 `{ id, name, email, role, emailVerified, docType, mfa: { enrolled, verified } }` and SHALL NOT include `password_hash` or TOTP data. [FND-57]
7. WHILE a session belongs to an admin or reception user its cookie `Max-Age` and session `expires_at` SHALL be 12 hours. [FND-58]
8. IF a POST/PUT/PATCH/DELETE to `/api/app/*` or `/api/admin/*` carries an `Origin` different from the origin of `APP_BASE_URL` THEN the API SHALL return 403 `CSRF_REJECTED`. [FND-59]

**Independent Test**: integration tests for login, lockout, logout, revoked-session reuse and CSRF.

---

### P1: Reset password ⭐ MVP

**User Story**: As a user who forgot my password, I want a reset link by e-mail, so that I regain access without calling the clinic.

**Why P1**: Self-service target of ≥ 85% (PRD §3).

**Acceptance Criteria**:

1. WHEN `POST /api/public/auth/password-reset/request` is called with any e-mail THEN the API SHALL return 202; WHERE the e-mail belongs to an active user it SHALL queue an `auth.password_reset` e-mail with a token valid for 60 minutes. [FND-60]
2. WHEN `POST /api/public/auth/password-reset/confirm` receives a valid token and a policy-compliant password THEN the API SHALL update the hash, revoke all of the user's sessions, mark the token used, write audit action `auth.password_reset` and return 200. [FND-61]
3. IF the reset token is unknown, used or expired THEN the API SHALL return 400 `INVALID_TOKEN` and change nothing. [FND-62]

**Independent Test**: integration tests reading the token from `email_outbox`.

---

### P1: Optional two-factor authentication ⭐ MVP

**User Story**: As any user (tenant, reception or the Administrador geral), I want to turn TOTP 2FA on or off for my own account, so that a leaked password does not expose my account when I choose the extra step.

**Why P1**: PRD §8 asked for mandatory admin 2FA; user decision 2026-10-28 (AD-037) made it optional for every role, so nobody is blocked at first login.

**Acceptance Criteria**:

1. WHILE a staff user has a confirmed TOTP and the session is not MFA-verified the API SHALL return 403 `MFA_REQUIRED` to every `/api/admin/*` request; an admin or reception user without a confirmed TOTP SHALL reach `/api/admin/*` with a password session, and no endpoint SHALL answer `MFA_ENROLLMENT_REQUIRED` (amended: user decision 2026-10-28, AD-037). [FND-63]
2. WHEN a signed-in user of any role without a confirmed TOTP calls `POST /api/app/auth/totp/enroll` THEN the API SHALL store a new encrypted, unconfirmed secret and return `{ otpauthUri }` with issuer "Bravô Clinic" and the user's e-mail as label; IF the user already has a confirmed TOTP THEN it SHALL return 409 `CONFLICT` and keep the secret (amended: user decision 2026-10-28, AD-037). [FND-64]
3. WHEN `POST /api/app/auth/totp/confirm` receives the current 6-digit code THEN the API SHALL mark TOTP confirmed, return 10 recovery codes once, mark the session MFA-verified and write audit action `auth.totp_enabled`. [FND-65]
4. WHEN a user of any role with confirmed TOTP logs in with the correct password THEN the API SHALL return 200 `{ mfaRequired: true }` and create a session that is not MFA-verified; WHILE that session is not verified `/api/admin/*` SHALL return 403 `MFA_REQUIRED` (amended: user decision 2026-10-28, AD-037). [FND-66]
5. WHEN `POST /api/app/auth/totp/verify` receives a valid code for the current step ±1 or an unused recovery code THEN the API SHALL mark the session MFA-verified, consume the recovery code if one was used, and return 200. [FND-67]
6. IF a TOTP code from an already-used time step is submitted again THEN the API SHALL return 401 `INVALID_CODE`. [FND-68]
7. IF 5 invalid codes are submitted by the same user within 15 minutes THEN the next attempt SHALL return 429 `TOO_MANY_ATTEMPTS`. [FND-69]
8. The system SHALL store TOTP secrets only as AES-256-GCM ciphertext under `ENCRYPTION_KEY`, and recovery codes only as SHA-256 hashes. [FND-70]
9. The system SHALL keep TOTP off by default for every role and SHALL let each tenant, reception or admin user turn it on from `/app/perfil/seguranca` ("Verificação em duas etapas", action "Ativar": QR code, manual key, confirmation code, recovery codes shown once, then the page in the "on" state), reachable from "Segurança" on `/app/perfil` and in the admin top bar; `/login/2fa/configurar` SHALL redirect there and no guard SHALL send a user to it (user decision 2026-10-28, AD-037). [FND-135]
10. WHEN `POST /api/app/auth/totp/disable` receives `{ code }` (a current TOTP code or an unused recovery code, under the FND-68 replay and FND-69 rate-limit rules) from an MFA-verified session of a user with confirmed TOTP THEN the API SHALL delete the `user_totp` row with its recovery codes, clear the MFA mark of the user's sessions and write audit `user.totp_disabled` in one transaction, and return 200 `{ mfa: { enrolled: false, verified: false } }`; IF the code is wrong THEN it SHALL return 401 `INVALID_CODE`; IF TOTP is not on THEN 409 `CONFLICT`; and the "Desativar" action of `/app/perfil/seguranca` SHALL call it and mirror that `mfa` in the cached session (user decision 2026-10-28, AD-037). [FND-136]
11. WHILE a user of any role has a confirmed TOTP and the session is not MFA-verified the API SHALL return 403 `MFA_REQUIRED` to every `/api/app/*` request except `GET /api/app/me`, `POST /api/app/auth/totp/verify` and `POST /api/app/auth/logout`, the Google callback SHALL redirect such a user to `/login/2fa?next=<destination>`, and the web `RequireAuth` and `RequireStaff` guards SHALL redirect such a session to `/login/2fa?next=<original path>` (user decision 2026-10-28, AD-037). [FND-137]

**Independent Test**: integration tests computing codes with `otpauth` from the enrollment URI.

---

### P1: Roles, access and audit ⭐ MVP

**User Story**: As the Administrador geral, I want each role to reach only its screens and every sensitive action recorded, so that the clinic is controlled and auditable.

**Why P1**: PRD §7.3 profiles and §8 audit log.

**Acceptance Criteria**:

1. IF an unauthenticated request reaches `/api/app/*` or `/api/admin/*` THEN the API SHALL return 401 `UNAUTHENTICATED`. [FND-71]
2. IF a tenant calls any `/api/admin/*` route THEN the API SHALL return 403 `FORBIDDEN`. [FND-72]
3. IF a reception user calls a route guarded by `requireRole('admin')` THEN the API SHALL return 403 `FORBIDDEN`. [FND-73]
4. WHEN an MFA-verified staff user calls `GET /api/admin/session` THEN the API SHALL return 200 `{ role, sections }` where admin sections are `calendario, reservas, financeiro, integracoes, cupons, servicos-extras, clientes, salas, usuarios, auditoria` in that order and reception sections are `reservas, clientes`. [FND-74]
5. WHEN `audit(tx, ctx, input)` is called inside a transaction THEN an `audit_log` row with actor id, actor role, origin, action, entity type and id, justification, before, after, IP and requestId SHALL be written, and SHALL disappear if that transaction rolls back. [FND-75]
6. WHEN `GET /api/public/config` is called THEN the API SHALL return 200 `{ googleEnabled, whatsappE164, environment }` with `environment` = `production` on the `production` branch and `development` otherwise. [FND-76]

**Independent Test**: integration tests with one user per role.

---

### P1: Transactional e-mail outbox ⭐ MVP

**User Story**: As the clinic, I want every system e-mail recorded even without an e-mail provider, so that nothing is lost and the Admin can see it.

**Why P1**: AD-008; verification and reset depend on it.

**Acceptance Criteria**:

1. WHEN a service queues an e-mail THEN `email_outbox` SHALL get a row with recipient, template, pt-BR subject, HTML and text bodies, status `pending`, in the caller's transaction. [FND-77]
2. WHERE `RESEND_API_KEY` is set, after the transaction commits the system SHALL send the message through the Resend REST API and set status `sent` with the provider message id. [FND-78]
3. IF `RESEND_API_KEY` is absent THEN the system SHALL set the row status to `not_sent` and the originating request SHALL still succeed. [FND-79]
4. IF the provider call fails or times out after 10 seconds THEN the system SHALL set status `failed`, store `last_error`, increment `attempts`, and the originating request SHALL still succeed. [FND-80]

**Independent Test**: integration test with `fetch` stubbed for the provider.

---

### P1: Design system tokens and theme ⭐ MVP

**User Story**: As a visitor, I want the Bravô look in Day and Night themes, so that the site feels like the physical clinic.

**Why P1**: PRD §8 UI guidelines; every screen uses the tokens.

**Acceptance Criteria**:

1. The Tailwind config SHALL expose every color key of the DESIGN.md front matter as a utility color whose value is `rgb(var(--c-<key>) / <alpha-value>)`. [FND-81]
2. WHILE `<html data-theme="night">` is set the CSS variables SHALL resolve to the Night column of `docs/architecture.md` §9.3, and WHILE `data-theme="day"` (or unset) they SHALL resolve to the Day column. [FND-82]
3. WHEN the user activates the theme toggle THEN the system SHALL switch `data-theme` between `day` and `night` and store the choice in `localStorage['bravo-theme']`. [FND-83]
4. WHEN no stored choice exists THEN the initial theme SHALL follow `prefers-color-scheme` (dark → night), applied by an inline script before first paint. [FND-84]
5. The Tailwind config SHALL expose the typography tokens `display-xl`, `display-xl-mobile`, `display-l`, `display-l-mobile`, `heading`, `heading-mobile`, `eyebrow`, `lead`, `body`, `small` and `caption` with the DESIGN.md size, line height, letter spacing and weight, using Josefin Sans for display/heading/eyebrow and Jost for the rest. [FND-85]
6. The `Icon` component SHALL render lucide icons with `strokeWidth` 1.5 and `aria-hidden="true"` unless a `label` prop is given, in which case it SHALL render `role="img"` with that `aria-label`. [FND-86]

**Independent Test**: unit tests on the Tailwind config, tokens.css and ThemeProvider.

---

### P1: Base UI components ⭐ MVP

**User Story**: As a developer, I want accessible primitives that follow DESIGN.md, so that every screen is consistent and WCAG 2.1 AA.

**Why P1**: PRD §8 compatibility (WCAG 2.1 AA) and UI guidelines.

**Acceptance Criteria**:

1. The `Button` SHALL support variants `primary` (bronze background, on-bronze text, 48px height, 2px radius), `secondary` (surface-raised background, 1px border, ink text) and `ghost` (transparent), and WHEN `loading` is true THEN it SHALL be disabled with `aria-busy="true"`. [FND-87]
2. The `Field` component SHALL render a visible label bound to its control by `htmlFor`/`id`, and WHEN an error is passed THEN the control SHALL get `aria-invalid="true"` and `aria-describedby` pointing to the error text. [FND-88]
3. WHEN a `Modal` opens THEN focus SHALL move inside the dialog (`role="dialog"`, `aria-modal="true"`), Tab SHALL cycle within it, and WHEN Escape is pressed THEN it SHALL close and return focus to the element that opened it. [FND-89]
4. WHEN a `Tabs` tab has focus and the user presses ArrowRight or ArrowLeft THEN the next or previous tab SHALL become selected and its panel shown, using roles `tablist`, `tab` and `tabpanel`. [FND-90]
5. The `Badge` SHALL render champagne-soft background with on-champagne text in uppercase caption style. [FND-91]
6. The interactive base components (Button, Input, Select, Textarea, Checkbox, Tabs, Modal close) SHALL show a 2px bronze focus ring with 2px offset on `:focus-visible`. [FND-92]
7. WHEN a toast is shown THEN it SHALL use `role="status"` with `aria-live="polite"` and SHALL dismiss itself after 6 seconds unless it has an action button. [FND-93]
8. The `RoomCard` SHALL render cover image (or `/room-placeholder.webp` when no photo is given), room-name chip, feature chip, tags, description, equipment checklist, "A partir de" price formatted by `formatBRL` with "/h", and a "Reservar Sala" button. [FND-94]

**Independent Test**: Testing Library unit tests per component.

---

### P1: Public layout and Home page ⭐ MVP

**User Story**: As a visitor on my phone, I want the Bravô home page with rooms, prices and policies, so that I understand the offer and can contact the clinic.

**Why P1**: The site is the main sales channel (PRD §1); MVP definition starts with discovering the room.

**Acceptance Criteria**:

1. The `Header` SHALL be fixed at the top with height 80px, show the brand lockup, the location "Praia Brava - Itajaí" from the `xl` breakpoint, the nav links Salas (`/salas`), Estrutura (`/#estrutura`), Preços & Planos (`/precos`), Serviços Extras (`/servicos-extras`) and Contato (`/contato`) from the `lg` breakpoint, and a Login button linking to `/login` (or "Minha conta" to `/app` when a session exists). [FND-95]
2. WHEN the viewport is below `lg` and the user taps the menu button THEN the header SHALL open the navigation with the same links and set `aria-expanded="true"` on the button. [FND-96]
3. The `Footer` SHALL reproduce the reference footer (brand column, Navegação, Diretrizes, Atendimento, copyright bar) with the address "Praia Brava, Itajaí – SC" and the hours "Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00". [FND-97]
4. The public layout SHALL render a floating WhatsApp link 24px from the bottom-right corner on every public page, with `target="_blank"`, `rel="noopener noreferrer"`, href `https://wa.me/<digits of clinic.whatsapp_e164>` (or `https://wa.me/` when empty) and the label "Concierge WhatsApp" visible from the `sm` breakpoint. [FND-98]
5. The Home page SHALL render, in this order, the sections Hero with quick booking widget, Arquitetura (`id="estrutura"`), Salas (`id="salas"`, three RoomCards), Simulador (`id="simulador"`), Serviços extras, Comodidade de operação, Políticas and CTA de pré-lançamento, matching the reference markup and classes. [FND-99]
6. WHEN the simulator is set to "Dia Útil Comercial" with 2 hours THEN it SHALL show total "R$ 160,00", sinal "R$ 80,00" and saldo "R$ 80,00"; with 1 hour total "R$ 97,00"; with "Noite / Fim de Semana" and 2 hours total "R$ 198,00"; with "Noite / Fim de Semana" and 1 hour total "R$ 120,00". [FND-100]
7. The Home page SHALL contain no reference to São Paulo or Jardins, and the Políticas section SHALL state that the sinal is not refundable on desistência. [FND-101]
8. WHEN the user clicks "Solicitar Orçamento" on an extra service THEN a modal titled with that service SHALL open, and WHEN its form is submitted with name and WhatsApp filled THEN the system SHALL open `https://wa.me/<number>?text=<encoded message with service, name and details>` in a new tab and close the modal. [FND-102]
9. WHEN the user clicks "Reservar Sala" on a room card or "Verificar Horários" in the hero widget THEN the page SHALL select that room in the hero widget and scroll smoothly to `#simulador`. [FND-103]
10. The built site SHALL load fonts only from Google Fonts (Josefin Sans and Jost, `display=swap`) and SHALL NOT load the Tailwind CDN or Material Symbols. [FND-104]
11. WHEN a path matches no route THEN the site SHALL render a 404 page inside the public layout with a link to `/`. [FND-105]

**Independent Test**: Testing Library tests on Home sections; manual comparison against `home-reference.png`.

---

### P1: Authentication pages ⭐ MVP

**User Story**: As a visitor or staff member, I want login, signup, verification, password reset and 2FA pages, so that I complete every auth flow in the browser.

**Why P1**: Exposes the auth API to users.

**Acceptance Criteria**:

1. WHEN the login form receives 401 THEN the page SHALL show "E-mail ou senha incorretos"; WHEN the response has `mfaRequired: true` THEN it SHALL navigate to `/login/2fa`; WHEN login succeeds THEN it SHALL navigate to the `next` query value, else `/app` for tenants and `/admin` for staff. [FND-106]
2. IF the `next` value is not a path starting with a single `/` THEN the login page SHALL ignore it and use the default destination. [FND-107]
3. WHEN the signup form is submitted with an invalid CPF/CNPJ THEN the page SHALL show "CPF ou CNPJ inválido" under the document field without calling the API, and the submit SHALL stay disabled until "Termos de uso" and "Política de privacidade" (linked to `/termos` and `/privacidade`) are checked. [FND-108]
4. WHEN signup returns 201 THEN the page SHALL navigate to `/app` and show the banner "Enviamos um link de confirmação para o seu e-mail."; WHEN it returns 409 THEN the page SHALL show the conflict message on the e-mail or document field. [FND-109]
5. WHEN `/verificar-email?token=<t>` loads THEN the page SHALL call the verify endpoint once and show "E-mail confirmado" on success or "Link inválido ou expirado" with a resend button on 400. [FND-110]
6. WHEN the forgot-password form is submitted THEN the page SHALL always show "Se o e-mail estiver cadastrado, você receberá um link em instantes."; WHEN `/redefinir-senha?token=<t>` is submitted with a valid new password THEN the page SHALL show success and link to `/login`. [FND-111]
7. WHEN "Ativar" is chosen on `/app/perfil/seguranca` THEN the page SHALL show a QR code of the otpauth URI, accept the 6-digit code, then show the 10 recovery codes once with a "Já guardei os códigos" button that returns to the page with 2FA on; WHEN `/login/2fa/configurar` is opened THEN the site SHALL redirect to `/app/perfil/seguranca` (amended: user decision 2026-10-28, AD-037). [FND-112]
8. WHEN `/login/2fa` receives a valid 6-digit code or recovery code THEN the page SHALL navigate to the `next` query value, else `/admin` for staff and `/app` for tenants, showing the eyebrow "Área restrita" only to staff; IF the API returns 401 THEN it SHALL show "Código inválido" and keep the session (amended: user decision 2026-10-28, AD-037). [FND-113]

**Independent Test**: Testing Library page tests with the API client mocked.

---

### P1: App and Admin shells with guards ⭐ MVP

**User Story**: As a tenant or staff member, I want the right shell and navigation after login, so that later features plug into a working structure.

**Why P1**: PRD §7.2 and §7.3 navigation.

**Acceptance Criteria**:

1. WHEN an unauthenticated visitor navigates to any `/app/*` or `/admin/*` path THEN the site SHALL redirect to `/login?next=<original path>`. [FND-114]
2. WHEN a tenant navigates to any `/admin/*` path THEN the site SHALL render the page "Acesso restrito" with a link to `/app`. [FND-115]
3. WHEN a staff user with TOTP enrolled whose session is not MFA-verified navigates to `/admin/*` THEN the site SHALL redirect to `/login/2fa?next=<original path>`; staff without TOTP SHALL enter `/admin/*` with a password session (amended: user decision 2026-10-28, AD-037). [FND-116]
4. The `AdminShell` SHALL list, for admin, Calendário, Gestão de Reservas, Financeiro, Integrações, Cupons, Serviços Extras, Clientes, Salas, Usuários and Log de auditoria in that order, and for reception only Gestão de Reservas and Clientes; each item SHALL open a placeholder page titled with the section name and the text "Em construção". [FND-117]
5. The `AppShell` SHALL show a bottom tab bar below `lg` and a sidebar from `lg` with Reservar, Minhas reservas, Agenda, Compras and Perfil, plus a "Sair" action that calls logout and navigates to `/`. [FND-118]

**Independent Test**: router tests with mocked sessions per role.

---

### P1: PWA and static SEO ⭐ MVP

**User Story**: As a tenant, I want to install the app on my phone, and as the clinic, I want search engines and social previews to show Bravô correctly.

**Why P1**: PRD §7.2 (installable PWA) and §7.1 (SEO local, Open Graph).

**Acceptance Criteria**:

1. The web manifest SHALL declare name "Bravô Clinic – Salas Inteligentes", short_name "Bravô", lang "pt-BR", start_url "/app", scope "/", display "standalone", background_color "#f5eee6", theme_color "#63391c", and icons 192×192, 512×512 and a 512×512 maskable icon. [FND-119]
2. The service worker SHALL precache the built assets and SHALL serve every request under `/api/` with a NetworkOnly strategy. [FND-120]
3. WHEN a new service worker version is waiting THEN the site SHALL show a toast "Nova versão disponível" with an "Atualizar" action that activates it and reloads. [FND-121]
4. The built `index.html` SHALL contain exactly one JSON-LD `LocalBusiness` block with name "Bravô Clinic – Salas Inteligentes", address (Praia Brava, Itajaí, SC, BR), `openingHoursSpecification` (Mo–Fr 07:00–23:59, Sa–Su 09:00–23:59) and `url` = `VITE_SITE_URL`. [FND-122]
5. The built `index.html` SHALL contain `<html lang="pt-BR">`, a `<title>`, a meta description, and Open Graph tags `og:type=website`, `og:title` "Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí", `og:description` "Salas clínicas e estúdios de alto padrão para alugar por hora, meio turno ou turno na Praia Brava, em Itajaí – SC. Reserve online.", `og:image` (absolute URL of the 1200×630 Bravô logo banner `og-logo.jpg`), `og:locale=pt_BR`, and matching `twitter:card=summary_large_image`, `twitter:title`, `twitter:description` and `twitter:image`. [FND-123]
6. The site SHALL serve `robots.txt` disallowing `/app` and `/admin` and `sitemap.xml` listing the public routes of §7.1. [FND-124]

**Independent Test**: unit tests over the built `index.html`, manifest and robots; Lighthouse PWA check on the deploy.

---

### P1: Delivery pipeline and first production deploy ⭐ MVP

**User Story**: As the owner (Eduardo), I want CI on every push and the site and API live on Netlify and Neon, so that every later feature deploys the same way.

**Why P1**: AD-003, AD-010, AD-014.

**Acceptance Criteria**:

1. WHEN the web build runs THEN `apps/web/dist/_redirects` SHALL contain `/api/*  <API_PROXY_ORIGIN>/:splat  200` as its first rule and `/*  /index.html  200` as its last rule. [FND-125]
2. IF `API_PROXY_ORIGIN` is missing or does not start with `https://` THEN the web build SHALL fail with the message "API_PROXY_ORIGIN must be an https URL". [FND-126]
3. The root `neon.ts` SHALL declare function slug `api` with source `apps/api/src/index.ts`, SHALL read env values only from `process.env`, and SHALL omit optional keys (`RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VAPID_*`) that are unset instead of sending empty strings. [FND-127]
4. WHEN code is pushed to `main` or a pull request targets `main` THEN GitHub Actions SHALL run `npm ci`, typecheck, lint, all workspace tests (API integration tests against a postgres:17 service) and build, and fail the workflow on any failing step. [FND-128]
5. WHEN the production deploy completes THEN `https://<site>/api/health` SHALL return 200 `{ "status": "ok", "db": "ok", "branch": "production" }`, the Home SHALL return 200 with the hero headline, and `GET /api/public/config` SHALL return 200. [FND-129]
6. The repository SHALL contain no secret values: `.env.example` lists variable names with empty values, and `.env*` files other than `.env.example` are git-ignored. [FND-130]

**Independent Test**: CI run on a PR; `node scripts/smoke.mjs https://<site>` after deploy.

---

### P2: Google login (gated by configuration)

**User Story**: As a professional, I want to log in with Google, so that I skip creating a password.

**Why P2**: PRD §8 lists it, but e-mail/password covers the MVP and credentials may not exist at launch.

**Acceptance Criteria**:

1. WHERE `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, `GET /api/public/auth/google/start` SHALL redirect (302) to Google's authorization endpoint with `state`, a PKCE S256 `code_challenge` and scopes `openid email profile`, storing state and verifier in an HttpOnly cookie valid for 10 minutes. [FND-131]
2. WHEN the callback receives a valid code and matching state THEN the API SHALL log in the user found by `google_sub` or by a verified Google e-mail (linking `google_sub`), or create a tenant with `email_verified_at` set and no document, and redirect to `/app` (or `/app/perfil?completar=1` when the user has no document). [FND-132]
3. IF the callback state is missing or does not match the cookie THEN the API SHALL return 400 `INVALID_STATE` and create no session. [FND-133]
4. WHERE Google credentials are not configured, `GET /api/public/auth/google/start` SHALL return 404 `FEATURE_DISABLED`, `/api/public/config` SHALL return `googleEnabled: false`, and the login page SHALL not render the Google button. [FND-134]

**Independent Test**: integration tests with Google token and JWKS endpoints stubbed.

---

## Edge Cases

- IF the database is asleep (scale-to-zero) THEN the first request SHALL still succeed after the cold start; health has no timeout shorter than 10 seconds. (FND-21)
- IF signup is submitted twice concurrently with the same e-mail THEN exactly one user SHALL be created and the other request SHALL get 409 `EMAIL_TAKEN` (unique index). (FND-45)
- IF the e-mail differs only by case or surrounding spaces THEN it SHALL be treated as the same e-mail. (FND-45)
- IF a staff user is demoted to tenant while logged in THEN the next `/api/admin/*` call SHALL return 403 (role read from the session row's user). (FND-72)
- IF the TOTP code is entered with spaces ("123 456") THEN the API SHALL strip spaces before verifying. (FND-67)
- IF `localStorage` is unavailable (private mode) THEN the theme toggle SHALL still switch the theme for the session without throwing. (FND-83)
- WHEN `localToUtc` receives minute 1440 THEN it SHALL return 00:00 of the next local day. (FND-10)
- IF the admin bootstrap password violates the password policy THEN the seed SHALL fail with "ADMIN_BOOTSTRAP_PASSWORD does not meet the password policy" and create nothing. (FND-41)
- IF `API_PROXY_ORIGIN` ends with `/` THEN the redirect generator SHALL strip it before appending `/:splat`. (FND-125)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Task(s) | Status |
| --- | --- | --- | --- | --- |
| FND-01 | P1: Monorepo and quality gates | Tasks | T1 | In Tasks |
| FND-02 | P1: Monorepo and quality gates | Tasks | T2 | In Tasks |
| FND-03 | P1: Monorepo and quality gates | Tasks | T3 | In Tasks |
| FND-04 | P1: Monorepo and quality gates | Tasks | T4 | In Tasks |
| FND-05 | P1: Monorepo and quality gates | Tasks | T38 | In Tasks |
| FND-06 | P1: Monorepo and quality gates | Tasks | T3 | In Tasks |
| FND-07 | P1: Money and time helpers | Tasks | T5 | In Tasks |
| FND-08 | P1: Money and time helpers | Tasks | T5 | In Tasks |
| FND-09 | P1: Money and time helpers | Tasks | T5 | In Tasks |
| FND-10 | P1: Money and time helpers | Tasks | T6 | In Tasks |
| FND-11 | P1: Money and time helpers | Tasks | T6 | In Tasks |
| FND-12 | P1: Money and time helpers | Tasks | T6 | In Tasks |
| FND-13 | P1: Money and time helpers | Tasks | T6 | In Tasks |
| FND-14 | P1: Document and credential validation | Tasks | T7 | In Tasks |
| FND-15 | P1: Document and credential validation | Tasks | T7 | In Tasks |
| FND-16 | P1: Document and credential validation | Tasks | T7 | In Tasks |
| FND-17 | P1: Document and credential validation | Tasks | T8 | In Tasks |
| FND-18 | P1: Settings catalog | Tasks | T9 | In Tasks |
| FND-19 | P1: Settings catalog | Tasks | T9 | In Tasks |
| FND-20 | P1: Settings catalog | Tasks | T23 | In Tasks |
| FND-21 | P1: API skeleton | Tasks | T16 | In Tasks |
| FND-22 | P1: API skeleton | Tasks | T16 | In Tasks |
| FND-23 | P1: API skeleton | Tasks | T12 | In Tasks |
| FND-24 | P1: API skeleton | Tasks | T14 | In Tasks |
| FND-25 | P1: API skeleton | Tasks | T14 | In Tasks |
| FND-26 | P1: API skeleton | Tasks | T14 | In Tasks |
| FND-27 | P1: API skeleton | Tasks | T13 | In Tasks |
| FND-28 | P1: API skeleton | Tasks | T15 | In Tasks |
| FND-29 | P1: API skeleton | Tasks | T14 | In Tasks |
| FND-30 | P1: Base schema and migrations | Tasks | T22 | In Tasks |
| FND-31 | P1: Base schema and migrations | Tasks | T21, T22 | In Tasks |
| FND-32 | P1: Base schema and migrations | Tasks | T22 | In Tasks |
| FND-33 | P1: Base schema and migrations | Tasks | T22 | In Tasks |
| FND-34 | P1: Base schema and migrations | Tasks | T22 | In Tasks |
| FND-35 | P1: Base schema and migrations | Tasks | T22 | In Tasks |
| FND-36 | P1: Base schema and migrations | Tasks | T18, T19, T20 | In Tasks |
| FND-37 | P1: Seeds and admin bootstrap | Tasks | T23 | In Tasks |
| FND-38 | P1: Seeds and admin bootstrap | Tasks | T23 | In Tasks |
| FND-39 | P1: Seeds and admin bootstrap | Tasks | T10, T23 | In Tasks |
| FND-40 | P1: Seeds and admin bootstrap | Tasks | T23 | In Tasks |
| FND-41 | P1: Seeds and admin bootstrap | Tasks | T23 | In Tasks |
| FND-42 | P1: Seeds and admin bootstrap | Tasks | T23 | In Tasks |
| FND-43 | P1: Sign up and verify e-mail | Tasks | T31 | In Tasks |
| FND-44 | P1: Sign up and verify e-mail | Tasks | T31 | In Tasks |
| FND-45 | P1: Sign up and verify e-mail | Tasks | T31 | In Tasks |
| FND-46 | P1: Sign up and verify e-mail | Tasks | T31 | In Tasks |
| FND-47 | P1: Sign up and verify e-mail | Tasks | T31 | In Tasks |
| FND-48 | P1: Sign up and verify e-mail | Tasks | T33 | In Tasks |
| FND-49 | P1: Sign up and verify e-mail | Tasks | T33 | In Tasks |
| FND-50 | P1: Sign up and verify e-mail | Tasks | T33 | In Tasks |
| FND-51 | P1: Sign up and verify e-mail | Tasks | T24 | In Tasks |
| FND-52 | P1: Log in, session and log out | Tasks | T27, T32 | In Tasks |
| FND-53 | P1: Log in, session and log out | Tasks | T32 | In Tasks |
| FND-54 | P1: Log in, session and log out | Tasks | T30, T32 | In Tasks |
| FND-55 | P1: Log in, session and log out | Tasks | T32 | In Tasks |
| FND-56 | P1: Log in, session and log out | Tasks | T27, T28 | In Tasks |
| FND-57 | P1: Log in, session and log out | Tasks | T32 | In Tasks |
| FND-58 | P1: Log in, session and log out | Tasks | T27 | In Tasks |
| FND-59 | P1: Log in, session and log out | Tasks | T29 | In Tasks |
| FND-60 | P1: Reset password | Tasks | T34 | In Tasks |
| FND-61 | P1: Reset password | Tasks | T34 | In Tasks |
| FND-62 | P1: Reset password | Tasks | T34 | In Tasks |
| FND-63 | P1: Optional two-factor authentication | Tasks | T28 | In Tasks |
| FND-64 | P1: Optional two-factor authentication | Tasks | T35 | In Tasks |
| FND-65 | P1: Optional two-factor authentication | Tasks | T35 | In Tasks |
| FND-66 | P1: Optional two-factor authentication | Tasks | T28, T35 | In Tasks |
| FND-67 | P1: Optional two-factor authentication | Tasks | T35 | In Tasks |
| FND-68 | P1: Optional two-factor authentication | Tasks | T35 | In Tasks |
| FND-69 | P1: Optional two-factor authentication | Tasks | T30, T35 | In Tasks |
| FND-70 | P1: Optional two-factor authentication | Tasks | T24, T35 | In Tasks |
| FND-71 | P1: Roles, access and audit | Tasks | T28 | In Tasks |
| FND-72 | P1: Roles, access and audit | Tasks | T28 | In Tasks |
| FND-73 | P1: Roles, access and audit | Tasks | T28 | In Tasks |
| FND-74 | P1: Roles, access and audit | Tasks | T11, T36 | In Tasks |
| FND-75 | P1: Roles, access and audit | Tasks | T25 | In Tasks |
| FND-76 | P1: Roles, access and audit | Tasks | T36 | In Tasks |
| FND-77 | P1: Transactional e-mail outbox | Tasks | T26 | In Tasks |
| FND-78 | P1: Transactional e-mail outbox | Tasks | T26 | In Tasks |
| FND-79 | P1: Transactional e-mail outbox | Tasks | T26 | In Tasks |
| FND-80 | P1: Transactional e-mail outbox | Tasks | T26 | In Tasks |
| FND-81 | P1: Design system tokens and theme | Tasks | T39 | In Tasks |
| FND-82 | P1: Design system tokens and theme | Tasks | T40 | In Tasks |
| FND-83 | P1: Design system tokens and theme | Tasks | T41 | In Tasks |
| FND-84 | P1: Design system tokens and theme | Tasks | T41 | In Tasks |
| FND-85 | P1: Design system tokens and theme | Tasks | T39 | In Tasks |
| FND-86 | P1: Design system tokens and theme | Tasks | T42 | In Tasks |
| FND-87 | P1: Base UI components | Tasks | T43 | In Tasks |
| FND-88 | P1: Base UI components | Tasks | T44 | In Tasks |
| FND-89 | P1: Base UI components | Tasks | T46 | In Tasks |
| FND-90 | P1: Base UI components | Tasks | T47 | In Tasks |
| FND-91 | P1: Base UI components | Tasks | T45 | In Tasks |
| FND-92 | P1: Base UI components | Tasks | T43, T44, T46, T47 | In Tasks |
| FND-93 | P1: Base UI components | Tasks | T48 | In Tasks |
| FND-94 | P1: Base UI components | Tasks | T49 | In Tasks |
| FND-95 | P1: Public layout and Home page | Tasks | T51 | In Tasks |
| FND-96 | P1: Public layout and Home page | Tasks | T51 | In Tasks |
| FND-97 | P1: Public layout and Home page | Tasks | T52 | In Tasks |
| FND-98 | P1: Public layout and Home page | Tasks | T53 | In Tasks |
| FND-99 | P1: Public layout and Home page | Tasks | T55, T56, T57, T58, T59, T60, T61 | In Tasks |
| FND-100 | P1: Public layout and Home page | Tasks | T58 | In Tasks |
| FND-101 | P1: Public layout and Home page | Tasks | T55, T56, T60, T61 | In Tasks |
| FND-102 | P1: Public layout and Home page | Tasks | T59 | In Tasks |
| FND-103 | P1: Public layout and Home page | Tasks | T55, T57, T61 | In Tasks |
| FND-104 | P1: Public layout and Home page | Tasks | T72 | In Tasks |
| FND-105 | P1: Public layout and Home page | Tasks | T54 | In Tasks |
| FND-106 | P1: Authentication pages | Tasks | T64 | In Tasks |
| FND-107 | P1: Authentication pages | Tasks | T64 | In Tasks |
| FND-108 | P1: Authentication pages | Tasks | T65 | In Tasks |
| FND-109 | P1: Authentication pages | Tasks | T65 | In Tasks |
| FND-110 | P1: Authentication pages | Tasks | T66 | In Tasks |
| FND-111 | P1: Authentication pages | Tasks | T67 | In Tasks |
| FND-112 | P1: Authentication pages | Tasks | T68 | In Tasks |
| FND-113 | P1: Authentication pages | Tasks | T68 | In Tasks |
| FND-114 | P1: App and Admin shells with guards | Tasks | T63 | In Tasks |
| FND-115 | P1: App and Admin shells with guards | Tasks | T63 | In Tasks |
| FND-116 | P1: App and Admin shells with guards | Tasks | T63 | In Tasks |
| FND-117 | P1: App and Admin shells with guards | Tasks | T70 | In Tasks |
| FND-118 | P1: App and Admin shells with guards | Tasks | T69 | In Tasks |
| FND-119 | P1: PWA and static SEO | Tasks | T71 | In Tasks |
| FND-120 | P1: PWA and static SEO | Tasks | T71 | In Tasks |
| FND-121 | P1: PWA and static SEO | Tasks | T71 | In Tasks |
| FND-122 | P1: PWA and static SEO | Tasks | T72 | In Tasks |
| FND-123 | P1: PWA and static SEO | Tasks | T72 | In Tasks |
| FND-124 | P1: PWA and static SEO | Tasks | T72 | In Tasks |
| FND-125 | P1: Delivery pipeline and first production deploy | Tasks | T73 | In Tasks |
| FND-126 | P1: Delivery pipeline and first production deploy | Tasks | T73 | In Tasks |
| FND-127 | P1: Delivery pipeline and first production deploy | Tasks | T74 | In Tasks |
| FND-128 | P1: Delivery pipeline and first production deploy | Tasks | T75 | In Tasks |
| FND-129 | P1: Delivery pipeline and first production deploy | Tasks | T76, T77, T78 | In Tasks |
| FND-130 | P1: Delivery pipeline and first production deploy | Tasks | T1 | In Tasks |
| FND-131 | P2: Google login | Tasks | T37 | In Tasks |
| FND-132 | P2: Google login | Tasks | T37 | In Tasks |
| FND-133 | P2: Google login | Tasks | T37 | In Tasks |
| FND-134 | P2: Google login | Tasks | T37, T64 | In Tasks |
| FND-135 | P1: Optional two-factor authentication | Execute | AD-037 change | Implemented |
| FND-136 | P1: Optional two-factor authentication | Execute | AD-037 change | Implemented |
| FND-137 | P1: Optional two-factor authentication | Execute | AD-037 change | Implemented |

**ID format:** `FND-NN`.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 137 total, 134 mapped to tasks, 3 added by the AD-037 change (FND-135..137, user decision 2026-10-28), 0 unmapped.

### Implicit-requirement dimensions sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | FND-14..17, FND-23, FND-24, FND-29, FND-44, FND-47, FND-108, FND-126; settings bounds FND-18/19 |
| Failure / partial-failure states | FND-22, FND-26, FND-28, FND-79, FND-80 (e-mail failure never fails the request), FND-110 |
| Idempotency / retry / duplicate handling | FND-31 (migrations), FND-40 (seeds), FND-45/46 (unique e-mail/document), FND-68 (TOTP replay). Money idempotency keys: N/A because fundacao moves no money (nucleo, `docs/architecture.md` §6.8) |
| Auth boundaries & rate limits | FND-54, FND-50, FND-69, FND-56, FND-59, FND-63, FND-66, FND-136, FND-137, FND-71..74, FND-107, FND-114..116 |
| Concurrency / ordering | FND-32..34 (exclusion constraint), concurrent signup edge case (FND-45), FND-75 (audit in same tx) |
| Data lifecycle / expiry | FND-49 (24h verify token), FND-60 (60 min reset token), FND-52/58 (session lifetimes), FND-55 (revocation), FND-61 (revoke on reset). Purge of expired rows: N/A because fundacao has no job runner (logged assumption) |
| Observability | FND-27 (request logs + requestId), FND-75 (audit log), FND-77 (outbox as delivery log), FND-21 (health) |
| External-dependency failure | FND-22 (DB down), FND-79/80 (e-mail provider absent/failing), FND-134 (Google not configured), cold start edge case |
| State-transition integrity | FND-48/49/62 (single-use tokens), FND-63..67 (session MFA state), FND-35 (append-only audit/consents). Booking/subscription machines: N/A because they ship with nucleo/receita (`docs/architecture.md` §3) |

---

## Success Criteria

- [ ] A new developer goes from clone to green `npm run typecheck && npm run lint && npm test && npm run build` in under 15 minutes.
- [ ] Production Home scores LCP ≤ 2.5 s on Lighthouse mobile (simulated 4G) and passes the Lighthouse PWA installability check.
- [ ] Home in Day and Night themes matches `docs/design/home-reference.png` section by section (visual review by Eduardo).
- [ ] Zero secret values in git history (`git log -p | grep -iE "postgres(ql)?://[^ ]*@[^ ]*neon\.tech"` returns nothing; the only DSN in the repo is the CI service container on localhost).
- [ ] Every FND requirement verified by the Verifier with file:line evidence.
