# Fundação Design

**Spec**: `.specs/features/fundacao/spec.md`
**Global blueprint**: `docs/architecture.md` (layout, full data model, API conventions, core modules, deployment, frontend). This design covers only what fundacao builds; it does not repeat the blueprint.
**Status**: Approved

---

## Architecture Overview

Approach (decided; AD-001..AD-024): one npm-workspaces repo, a pure `@bravo/core`, a Hono API exported as the Neon Function `api` and proxied by Netlify under `/api/*`, and one Vite SPA for site, PWA and Admin. Alternatives considered and rejected: Neon Auth (AD-005: in-house is testable without callback domains), a separate admin app (AD-001: one SPA), Netlify Functions for the API (AD-003: kept only as fallback).

```mermaid
graph TD
  subgraph Browser
    H[Home + PublicLayout] --> Q[TanStack Query + lib/api.ts]
    A[Auth pages] --> Q
    S[AppShell / AdminShell + guards] --> Q
  end
  Q -->|/api/* same origin| NP[Netlify _redirects proxy]
  NP --> APP[Hono createApp]
  APP --> RC[request-context: requestId + JSON log]
  RC --> CSRF[csrf for /app,/admin mutations]
  CSRF --> R1[/health]
  CSRF --> R2[/public/auth/*, /public/config]
  CSRF --> AUTH[requireAuth → requireStaff → requireRole]
  AUTH --> R3[/app/me, /app/auth/*]
  AUTH --> R4[/admin/session]
  R2 & R3 & R4 --> SVC[modules/auth/*.service.ts]
  SVC --> TX[withTransaction]
  TX --> DB[(Postgres: base schema)]
  SVC --> AUD[lib/audit.ts]
  SVC --> OUT[lib/email.ts → email_outbox]
  OUT -. after commit .-> RESEND[Resend REST]
  CORE[@bravo/core: money, time, document, auth-schemas, settings, holidays, access] --> SVC
  CORE --> H
  CORE --> A
```

Request flow for a mutation: request-context → JSON content-type check → CSRF (app/admin) → auth chain → zod validation → service in `withTransaction` (writes + `audit()` + `queueEmail()`) → commit → `dispatchEmails()` → JSON response or error envelope.

---

## Code Reuse Analysis

Greenfield: there is no application code yet. Reused inputs:

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| Design tokens (colors, typography, spacing) | `docs/design/DESIGN.md` front matter | Source for `tailwind.config.ts` and `tokens.css`; the token test parses this file |
| Reference Tailwind config + markup | `docs/design/home-reference.html` | Port each section's markup and classes verbatim into React (class strings unchanged except icons and corrected copy) |
| Reference screenshot | `docs/design/home-reference.png` | Visual acceptance check (success criterion) |
| Settings, schema, conventions | `docs/architecture.md` §4–§6 | Settings catalog keys/defaults, base DDL, error codes, auth rules |
| Neon Function patterns | neon-functions skill (`attachDatabasePool`, `parseEnv`, `neon.ts`) | `db/client.ts`, `neon.ts` |

### Integration Points

| System | Integration Method |
| --- | --- |
| Neon Postgres (`dev`, `production`) | `pg` Pool + Drizzle; migrations through `DATABASE_URL_UNPOOLED`; tests through `DATABASE_URL_TEST` |
| Neon Functions | `apps/api/src/index.ts` exports the Hono app; `neon.ts` declares slug `api` |
| Netlify | `netlify.toml` + generated `_redirects` (AD-016) |
| Resend | REST `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY` (optional) |
| Google OAuth | Authorization code + PKCE; ID token verified with `jose` against Google JWKS (optional) |
| Google Fonts | `<link>` in `index.html` |

---

## Components

### Workspace tooling

- **Purpose**: shared scripts and strict configs.
- **Location**: `/package.json`, `/tsconfig.base.json`, `/eslint.config.js`, `/.prettierrc.json`, `/.nvmrc`, `/.env.example`, `/.editorconfig`
- **Interfaces** (root scripts):
  - `typecheck`: `npm run typecheck --workspaces --if-present` (each workspace runs `tsc --noEmit -p .`)
  - `lint`: `eslint .`
  - `test`: `npm test --workspaces --if-present`
  - `build`: `npm run build --workspaces --if-present`
  - `db:migrate` / `db:seed`: forward to `apps/api`
  - `dev`: runs `apps/api` dev server and `apps/web` Vite concurrently (`npm run dev -w apps/api & npm run dev -w apps/web` via `concurrently`)
- **Dependencies**: Node 24, npm 11.
- **Reuses**: none.

### `@bravo/core` (fundacao modules)

- **Purpose**: pure helpers shared by API and web.
- **Location**: `packages/core/src/`
- **Interfaces**: money and time exactly as `docs/architecture.md` §7.1–§7.2, plus:
  - `parseDocument(input: string): { type: 'cpf' | 'cnpj'; digits: string } | null` — `validation/document.ts`
  - `formatDocument(doc: { type; digits }): string` — "529.982.247-25" / "11.222.333/0001-81"
  - `passwordSchema`, `emailSchema` (trim + lower-case), `phoneSchema` (BR: `+55` + 10–11 digits, accepts masked input, outputs E.164), `signupSchema`, `loginSchema`, `passwordResetRequestSchema`, `passwordResetConfirmSchema`, `totpCodeSchema` (6 digits after stripping spaces, or a recovery code `XXXX-XXXX`) — `validation/auth-schemas.ts`
  - `settingsCatalog`, `SettingKey`, `SettingValue<K>`, `parseSetting`, `settingDefaults()`, `SettingValidationError` — `settings/catalog.ts`
  - `holidaySeed: ReadonlyArray<{ date: LocalDate; name: string; scope: 'national' | 'state' | 'municipal'; needsReview: boolean }>` — `calendar/holidays-seed.ts`
  - `Role = 'tenant' | 'reception' | 'admin'`, `AdminSection` union, `adminSectionsFor(role): AdminSection[]`, `adminSectionMeta: Record<AdminSection, { label: string; path: string }>`, `appNav: { label; path; icon }[]`, `isStaff(role)` — `access.ts`
- **Dependencies**: `zod` only.
- **Reuses**: none.

### API configuration and context

- **Purpose**: validated env, request ids, logs, errors.
- **Location**: `apps/api/src/env.ts`, `apps/api/src/middleware/request-context.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/app.ts`
- **Interfaces**:
  - `envSchema` (zod); `parseEnv(source: Record<string, string | undefined>): Env` throws `EnvError` with `variables: string[]`; `getEnv(): Env` (memoized `parseEnv(process.env)`).
  - `Env = { DATABASE_URL; DATABASE_URL_UNPOOLED?; NEON_BRANCH?; SESSION_SECRET; ENCRYPTION_KEY; APP_BASE_URL; EMAIL_FROM; RESEND_API_KEY?; GOOGLE_CLIENT_ID?; GOOGLE_CLIENT_SECRET?; NODE_ENV }`
  - `requestContext(): MiddlewareHandler` sets `c.var.requestId`, `c.var.ctx: RequestContext`, header `X-Request-Id`, logs on completion.
  - `logger.info|warn|error(msg: string, fields?: Record<string, unknown>)` → one JSON line to stdout; `redact(value)` replaces values of keys matching `/pass|token|secret|authorization|cookie|code/i` with `"[redacted]"`.
  - `class AppError extends Error { status; code; details? }`; helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooManyRequests(retryAfterSeconds)`; `onError(err, c)`; `notFoundHandler(c)`.
  - `requireJson(): MiddlewareHandler` → 415 on mutating requests without `application/json` (skips `/webhooks/*` and `/jobs/*`, which validate their own bodies).
  - `createApp(deps?: Partial<AppDeps>): Hono<AppEnv>`; `AppDeps = { db; now: () => Date; fetch: typeof fetch; env: Env }` (injectable for tests).
- **Dependencies**: `hono`, `zod`.
- **Reuses**: error envelope and codes from `docs/architecture.md` §6.2.

### Database access

- **Purpose**: pool, transactions, schema, migrations, seeds.
- **Location**: `apps/api/src/db/client.ts`, `apps/api/src/db/schema/{identity,calendar,platform,index}.ts`, `apps/api/drizzle/`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/seed.ts`, `apps/api/test/`
- **Interfaces**:
  - `createDb(url: string): { pool: Pool; db: Db }` (Pool `max: 5`, `attachDatabasePool(pool)`); default instance from `getEnv().DATABASE_URL`.
  - `withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T>`.
  - `runMigrations(url: string): Promise<void>` (drizzle `migrate()` over a dedicated `pg.Client`); CLI `tsx src/db/migrate.ts` uses `DATABASE_URL_UNPOOLED ?? DATABASE_URL`.
  - `runSeed(db: Db, opts: { adminBootstrap?: { email; password; name } }): Promise<SeedReport>`; `SeedReport = { settingsInserted; roomsInserted; holidaysInserted; businessHoursInserted; adminCreated: boolean }`; CLI `tsx src/db/seed.ts`.
  - Test harness: `test/global-setup.ts` (requires `DATABASE_URL_TEST`, runs `runMigrations` once), `test/setup.ts` (`beforeEach` → `truncateAll()` = `TRUNCATE` every table in schema `public` `RESTART IDENTITY CASCADE`), `test/factories.ts` (`createUser({ role?, email?, password?, verified?, totp? })`, `loginAs(app, user)` → cookie header, `currentTotp(secret)`).
- **Dependencies**: `pg`, `drizzle-orm`, `drizzle-kit`, `@neon/functions`, `tsx`.
- **Reuses**: DDL of `docs/architecture.md` §5.2.

### Security libraries

- **Purpose**: hashing, tokens, encryption, sessions, TOTP, rate limits, CSRF, audit.
- **Location**: `apps/api/src/lib/crypto.ts`, `apps/api/src/auth/session.ts`, `apps/api/src/auth/totp.ts`, `apps/api/src/middleware/{auth,csrf,rate-limit}.ts`, `apps/api/src/lib/audit.ts`
- **Interfaces**:
  - `hashPassword(pw): Promise<string>` (scrypt N=16384, r=8, p=1, 16-byte salt, 64-byte key, format `scrypt$16384$8$1$<saltB64>$<hashB64>`); `verifyPassword(pw, stored): Promise<boolean>` (`timingSafeEqual`).
  - `randomToken(bytes = 32): string` (base64url); `sha256Hex(s): string`.
  - `encryptSecret(plaintext: string, keyB64: string): string` / `decryptSecret(ciphertext: string, keyB64: string): string` (AES-256-GCM, 12-byte IV, output `base64(iv|tag|ct)`).
  - `SESSION_COOKIE = 'bravo_session'`; `issueSession(tx, user, opts: { mfaVerified: boolean; ip?; userAgent? }): Promise<{ token: string; maxAgeSeconds: number; sessionId: string }>`; `verifySessionToken(token): Promise<SessionClaims | null>`; `resolveSession(db, claims): Promise<AuthContext | null>`; `markSessionMfaVerified(tx, sessionId)`; `revokeSession(tx, id)`; `revokeAllSessions(tx, userId)`; `setSessionCookie(c, token, maxAge)`; `clearSessionCookie(c)`.
  - `generateTotpSecret(): string` (base32, 20 bytes); `otpauthUri(secret, email): string`; `verifyTotp(secret, code, lastUsedStep: bigint | null, now: Date): { ok: true; step: bigint } | { ok: false }` (SHA1, 6 digits, 30 s, window 1); `generateRecoveryCodes(): string[]` (10 × `XXXX-XXXX`, alphabet without 0/O/1/I).
  - `requireAuth`, `requireMfaIfEnrolled` (AD-037: `/app/*` allow-list `GET /app/me`, `POST /app/auth/totp/verify`, `POST /app/auth/logout` while a TOTP user's session is not verified), `requireStaff`, `requireRole(role: 'admin')` (Hono middleware; `c.var.auth: AuthContext = { userId; role; sessionId; mfaVerified; totpConfirmed }`).
  - `csrf(appBaseUrl: string): MiddlewareHandler`.
  - `consumeRateLimit(db, key: string, opts: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>`; `peekRateLimit(...)` (read count without increment, used to block login after failures); keys hash e-mails (`sha256Hex(email)`), never store raw e-mail.
  - `audit(tx, ctx, input)` per `docs/architecture.md` §6.5.
- **Dependencies**: `node:crypto`, `jose`, `otpauth`.
- **Reuses**: conventions of `docs/architecture.md` §6.4.

### E-mail outbox

- **Purpose**: always-recorded transactional e-mail (AD-008).
- **Location**: `apps/api/src/lib/email.ts`, `apps/api/src/emails/templates/{layout,verify-email,password-reset}.ts`
- **Interfaces**:
  - `queueEmail(tx, msg: { to: string; template: string; subject: string; html: string; text: string; dedupeKey?: string }): Promise<string>` (returns outbox id).
  - `dispatchEmails(db, ids: string[], deps: { env: Env; fetch: typeof fetch }): Promise<void>` — after commit; no key → `not_sent`; 2xx → `sent` + `provider_message_id`; error/timeout (10 s `AbortSignal.timeout`) → `failed`, `attempts + 1`, `last_error` (≤ 500 chars, no headers).
  - Templates: `verifyEmailTemplate({ name, link })`, `passwordResetTemplate({ name, link })` → `{ subject, html, text }` in pt-BR, brand colors inline (e-mail clients ignore CSS vars). Links: `${APP_BASE_URL}/verificar-email?token=...`, `${APP_BASE_URL}/redefinir-senha?token=...`.
- **Dependencies**: `fetch`.
- **Reuses**: `email_outbox` table.

### Auth services and routes

- **Purpose**: signup, login, logout, me, e-mail verification, password reset, TOTP, admin session, public config, Google.
- **Location**: `apps/api/src/modules/auth/*.service.ts` + `apps/api/src/routes/public/auth/*.ts`, `apps/api/src/routes/app/{me,auth}.ts`, `apps/api/src/routes/admin/session.ts`, `apps/api/src/routes/public/config.ts`
- **Interfaces** (public paths; native paths drop `/api`):
  - `POST /api/public/auth/signup` body `signupSchema` → 201 `{ user }` + cookie.
  - `POST /api/public/auth/login` body `loginSchema` → 200 `{ user, mfaRequired }` + cookie.
  - `POST /api/public/auth/verify-email` `{ token }` → 200 `{ verified: true }`.
  - `POST /api/public/auth/password-reset/request` `{ email }` → 202 `{}`.
  - `POST /api/public/auth/password-reset/confirm` `{ token, password }` → 200 `{}`.
  - `GET /api/public/auth/google/start` → 302; `GET /api/public/auth/google/callback?code&state` → 302 to `/app` or `/app/perfil?completar=1`.
  - `GET /api/public/config` → `{ googleEnabled, whatsappE164, environment }`.
  - `GET /api/app/me` → user payload of FND-57.
  - `POST /api/app/auth/logout` → 204.
  - `POST /api/app/auth/verify-email/resend` → 202.
  - `POST /api/app/auth/totp/enroll` (any role, opt-in, AD-037) → `{ otpauthUri }`; `POST /api/app/auth/totp/disable` `{ code }` → `{ mfa: { enrolled: false, verified: false } }` (FND-136); `POST /api/app/auth/totp/confirm` `{ code }` → `{ recoveryCodes: string[] }`; `POST /api/app/auth/totp/verify` `{ code }` → `{ ok: true }`.
  - `GET /api/admin/session` → `{ role, sections }`.
- **Dependencies**: security libraries, outbox, `@bravo/core` schemas.
- **Reuses**: middleware chain.

### Web foundation

- **Purpose**: SPA scaffold, design tokens, theme, data layer, guards.
- **Location**: `apps/web/` (`vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/router.tsx`, `src/styles/{tokens,index}.css`, `src/theme/`, `src/lib/{api,query-client}.ts`, `src/features/auth/`, `src/features/config/useClinicConfig.ts`)
- **Interfaces**:
  - Vite dev: port 5173, proxy `/api` → `http://localhost:8787` with `rewrite: p => p.replace(/^\/api/, '')`.
  - `ThemeProvider`, `useTheme(): { theme: 'day' | 'night'; setTheme(t); toggle() }`; storage key `bravo-theme`; inline no-flash script in `index.html`.
  - `api.get/post/put/patch/delete<T>(path: string, body?: unknown, opts?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<T>`; `class ApiError { status; code; message; details; requestId }`.
  - `queryClient` (retry 1 except 4xx; `refetchOnWindowFocus: false` for public queries).
  - `useSession(): { session: Session | null; isLoading: boolean }` (query `['session']` → `GET /api/app/me`, 401 → `null`); `useLogin()`, `useLogout()`, `useSignup()`, `useVerifyEmail()`, `useRequestPasswordReset()`, `useConfirmPasswordReset()`, `useTotpEnroll()`, `useTotpConfirm()`, `useTotpVerify()`.
  - `useClinicConfig()` → `['public','config']`, `staleTime` 5 min; fallback `{ googleEnabled: false, whatsappE164: '' }` while loading or on error.
  - Guards: `<RequireAuth>`, `<RequireStaff>`, `<RequireSection section>`; `safeNextPath(next: string | null): string | null` (accepts only `^/(?!/)`).
- **Dependencies**: react 18.3, react-router-dom 6.30, @tanstack/react-query 5, react-hook-form, @hookform/resolvers, lucide-react, qrcode, vite-plugin-pwa, tailwindcss 3.4.
- **Reuses**: `@bravo/core` schemas, formatters and `access.ts`.

### UI components and layouts

- **Purpose**: design-system primitives, public layout, shells, Home.
- **Location**: `apps/web/src/components/ui/*`, `apps/web/src/components/layout/*`, `apps/web/src/pages/public/home/*`, `apps/web/src/pages/auth/*`, `apps/web/src/pages/{app,admin}/*`
- **Interfaces** (props):
  - `Button({ variant?: 'primary'|'secondary'|'ghost'|'link'; size?: 'md'|'sm'; loading?; iconLeft?; iconRight?; asChild? } & ButtonHTMLAttributes)`
  - `Field({ label; htmlFor; help?; error?; children })`, `Input`, `Select`, `Textarea`, `Checkbox({ label })`, `PasswordInput` (show/hide), `DocumentInput` (mask CPF up to 11 digits, CNPJ at 14), `PhoneInput` (mask `(47) 99999-0000`)
  - `Card({ variant?: 'raised'|'stone'|'walnut'; media? })`, `Badge({ tone?: 'champagne'|'neutral' })`
  - `Modal({ open; onClose; title; children; initialFocusRef? })`, `Tabs({ items: { id; label; panel }[]; value?; onChange? })`
  - `ToastProvider`, `useToast(): { show({ message; action?: { label; onClick } }) }`, `Alert({ tone: 'info'|'error'|'success'; children })`, `Spinner`, `ComingSoon({ title })`
  - `Icon({ as: LucideIcon; label?; className? })`, `BrandLockup({ size?: 'header'|'footer' })`, `EyebrowLockup({ text })`
  - `RoomCard({ name; featureLabel; featureIcon; tags: string[]; description; equipment: string[]; fromPriceCents; imageUrl?; imageAlt; onReserve })`
  - `Header`, `Footer`, `WhatsAppButton`, `PublicLayout` (`<Outlet/>`), `AppShell`, `AdminShell`, `NotFoundPage`, `ForbiddenPage`
  - Home: `HeroSection({ selectedRoom; onRoomChange; onCheck })`, `ArchitectureSection`, `RoomsSection({ onReserve(roomSlug) })`, `PricingSimulatorSection`, `ExtrasSection` (+ `QuoteModal`), `HomeStaticSections` (Comodidade, Políticas, CTA), `HomePage` (holds `selectedRoom` state, scroll to `#simulador`)
- **Dependencies**: Tailwind tokens, `@bravo/core` money.
- **Reuses**: reference markup.

### Delivery

- **Purpose**: build, proxy, function config, CI, deploy.
- **Location**: `netlify.toml`, `apps/web/scripts/write-redirects.mjs`, `neon.ts`, `.github/workflows/ci.yml`, `scripts/smoke.mjs`
- **Interfaces**:
  - `buildRedirects(origin: string | undefined): string` (exported for tests; CLI writes `dist/_redirects`).
  - `neon.ts` per `docs/architecture.md` §8.
  - CI job `ci`: `ubuntu-latest`, Node 24, service `postgres:17` (`POSTGRES_PASSWORD=postgres`, health-checked), env `DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/postgres`, steps `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run build` (with `API_PROXY_ORIGIN=https://example.invalid` and `VITE_SITE_URL=https://example.invalid` for the build only).
  - `node scripts/smoke.mjs <siteUrl>` exits 0 only if `/api/health` → 200 `status ok`, `/` → 200 containing "Saúde, beleza e bem-estar em um só lugar.", `/api/public/config` → 200.

---

## Data Models

The base tables and their columns are fixed in `docs/architecture.md` §5.2 and implemented as Drizzle tables in three files:

- `schema/identity.ts`: `users`, `sessions`, `authTokens`, `userTotp`, `consents`, `rateLimitBuckets`
- `schema/calendar.ts`: `rooms`, `roomPhotos`, `settings`, `businessHours`, `holidays`, `closedDays`, `blockRecurrences`, `blocks`, `roomOccupancy` (`period` as a `customType` mapping to `tstzrange`)
- `schema/platform.ts`: `auditLog`, `emailOutbox`, `integrationSettings`

Custom migration `0001_base_constraints.sql` (hand-written, registered with `drizzle-kit generate --custom --name=base_constraints`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_no_overlap
  EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (active);
ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_period_shape
  CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period));
CREATE INDEX room_occupancy_period_active_idx ON room_occupancy USING gist (period) WHERE active;
CREATE UNIQUE INDEX closed_days_uq ON closed_days (date, coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append_only_table: % on %', TG_OP, TG_TABLE_NAME; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON consents FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
```
`TRUNCATE` is not blocked by row triggers, so the test harness can still reset tables.

### Room seed

| slug | name | ideal_for | equipment | description |
| --- | --- | --- | --- | --- |
| `principal` | Sala Principal | Médico, Estética, Gravação de vídeos | Maca motorizada de 4 motores com controle; Mesa executiva em pedra e poltronas para consulta; Pontos de luz difusa e suporte para smartphones e câmeras; Pia de assepsia cirúrgica integrada na marcenaria | reference card text |
| `secundaria` | Sala Secundária | Médico, Estética, Gravação de vídeos | Maca reclinável hidráulica ultra-conforto; Bancada e armários para insumos e descartáveis; Isolamento acústico com painéis de madeira ripada; Foco de luz articulado com temperatura neutra | reference card text |
| `terceira` | Sala Terceira | Massagem, Terapia, Estética | Maca de massagem ergonômica com aquecimento opcional; Sistema de som surround com conectividade Bluetooth; Luz indireta regulável (zero ofuscamento ocular); Toalheiro térmico e higienização hospitalar prévia | reference card text |

### Holiday seed (28 rows, `source = 'seed'`, `is_closed = false`)

| Date | Name | Scope | needs_review |
| --- | --- | --- | --- |
| 2026-01-01 | Confraternização Universal | national | false |
| 2026-04-03 | Paixão de Cristo | national | false |
| 2026-04-21 | Tiradentes | national | false |
| 2026-05-01 | Dia do Trabalho | national | false |
| 2026-06-04 | Corpus Christi | municipal | false |
| 2026-06-15 | Aniversário de Itajaí | municipal | false |
| 2026-08-16 | Dia do Estado de Santa Catarina (Data Magna) | state | false |
| 2026-09-07 | Independência do Brasil | national | false |
| 2026-10-12 | Nossa Senhora Aparecida | national | false |
| 2026-11-02 | Finados | national | false |
| 2026-11-15 | Proclamação da República | national | false |
| 2026-11-20 | Dia Nacional de Zumbi e da Consciência Negra | national | false |
| 2026-12-08 | Nossa Senhora da Imaculada Conceição (padroeira) | municipal | false |
| 2026-12-25 | Natal | national | false |
| 2027-01-01 | Confraternização Universal | national | false |
| 2027-03-26 | Paixão de Cristo | national | false |
| 2027-04-21 | Tiradentes | national | false |
| 2027-05-01 | Dia do Trabalho | national | false |
| 2027-05-27 | Corpus Christi | municipal | false |
| 2027-06-15 | Aniversário de Itajaí | municipal | false |
| 2027-08-15 | Dia do Estado de Santa Catarina (Data Magna) | state | true |
| 2027-09-07 | Independência do Brasil | national | false |
| 2027-10-12 | Nossa Senhora Aparecida | national | false |
| 2027-11-02 | Finados | national | false |
| 2027-11-15 | Proclamação da República | national | false |
| 2027-11-20 | Dia Nacional de Zumbi e da Consciência Negra | national | false |
| 2027-12-08 | Nossa Senhora da Imaculada Conceição (padroeira) | municipal | false |
| 2027-12-25 | Natal | national | false |

### Home content corrections (reference → shipped copy)

| Section | Reference text | Shipped text |
| --- | --- | --- |
| Hero lead | "...estúdios clínicos nos Jardins..." | "...estúdios clínicos na Praia Brava, em Itajaí..." |
| Hero widget option | "Turno Completo (5h30)" | "Turno Completo (5h)" |
| Arquitetura stat | "07h-00h · Amplitude horária de segunda a domingo" | "07h-00h · Abertos todos os dias, inclusive feriados" |
| Arquitetura image alt | "...in Jardins Sao Paulo" | "...na Praia Brava, Itajaí" |
| Simulador table header | "Dia Útil — Comercial (07:00 às 18:30)" | "Dia Útil — Comercial (07:00 às 19:00)" |
| Simulador table row | "Turno completo comercial (5h30)" | "Turno completo comercial (5h)" |
| Simulador weekend header | "Sábados, Domingos & Feriados (09:00 às 18:30)" | "Sábados, Domingos & Feriados (09:00 às 19:00)" |
| Extras chip (Filmagem) | "Exclusivo Salas 1 & 2" | "Disponível em qualquer sala" |
| Extras (Marketing) | "...nos Jardins e Grande São Paulo..." | "...na Praia Brava, Itajaí e região..." |
| Comodidade (Endereço) | "Na Rua XXX, 123 Praia Brava - Itajaí..." | "Na Praia Brava, em Itajaí – SC, com fácil estacionamento." |
| Políticas (Sinal) | "O sinal é reembolsável ... 7 dias antes" | "Cobrado no ato da reserva para garantir o horário. O sinal não é reembolsável em caso de desistência." |
| CTA lead | "...custos imobiliários nos Jardins." | "...custos imobiliários na Praia Brava." |
| Footer address | "Alameda Gabriel Monteiro da Silva, 1420 • Jardins, São Paulo - SP" | "Praia Brava, Itajaí – SC" |
| Footer hours | "07:00 às 00:00 (Seg a Dom)" | "Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00" |
| Policies section heading class `font-display-l text-heading` | kept | kept |
| `px- space-sm` typo in reference caption | fixed to `px-space-sm` | |

All other copy and every class string stay as in the reference. Simulator logic (1h → R$ 97 or R$ 120; ≥ 2h → R$ 80 or R$ 99; 50% sinal) is ported as a static function over the factory defaults and formatted with `formatBRL`; nucleo replaces it with `@bravo/core` pricing.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| Invalid env at boot | `parseEnv` throws `EnvError(variables)`; function fails to start | Operator sees variable names in Neon logs; no values |
| DB unreachable / cold start | Health returns 503 `degraded`; other routes 500 `INTERNAL` with requestId | Web shows Alert "Não foi possível conectar. Tente novamente." |
| zod validation failure | 422 `VALIDATION_FAILED` with `details[]` | Field-level messages in forms |
| Unique violation (e-mail/document) | Service maps `23505` on `users_email_uq` / `users_doc_uq` to 409 `EMAIL_TAKEN` / `DOCUMENT_TAKEN` | Message under the field |
| Occupancy overlap | `23P01` → 409 `SLOT_TAKEN` (mapping ships now; first used by nucleo) | "Este horário acabou de ser reservado." |
| Wrong credentials / lockout | 401 `INVALID_CREDENTIALS`; 429 + `Retry-After` | Generic message; lockout message with minutes |
| Invalid/expired token | 400 `INVALID_TOKEN` | Page offers resend / new reset |
| Second factor pending (user has TOTP on, session not verified) | 403 `MFA_REQUIRED` on `/admin/*` and on `/app/*` outside the allow-list (AD-037) | Guard redirects to `/login/2fa?next=` |
| CSRF origin mismatch | 403 `CSRF_REJECTED` | Generic error toast (only attackers hit it) |
| E-mail provider down | Outbox row `failed`; request succeeds | User can resend verification |
| Google not configured / state mismatch | 404 `FEATURE_DISABLED` / 400 `INVALID_STATE` | Button hidden / login page shows "Não foi possível entrar com o Google." |
| Unexpected exception | 500 `INTERNAL`, logged with requestId and stack (stack only in logs) | "Erro interno" + requestId for support |
| API unreachable from web | `ApiError` with `code: 'NETWORK'` | Alert with retry button |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| --- | --- | --- | --- |
| Neon's default bundler must resolve the workspace package `@bravo/core`, which exports TypeScript source | `neon.ts` (T74), `packages/core/package.json` (T4) | Function deploy fails | T17 adds `npm run bundle -w apps/api` (esbuild, same entry) to prove bundling locally; if `neon deploy` fails in T77, switch `neon.ts` to `bundler: 'none'` with the esbuild output in `apps/api/dist` |
| Integration tests truncate every table on the Neon `dev` branch | `apps/api/test/setup.ts` (T21) | Any manual data on `dev` is wiped | `dev` is test-only (AD-004/AD-018); harness refuses to run when `DATABASE_URL_TEST` equals `DATABASE_URL` or contains the production branch id |
| Parallel test files on one DB race on truncation | `apps/api/vitest.config.ts` (T12) | Flaky tests | `fileParallelism: false`, single fork |
| Netlify proxy cuts long responses (~26 s) | `_redirects` (T73) | Long streams (future MCP) break | All fundacao routes are short; gestao gives MCP clients the native function URL (noted in architecture §6.1 for gestao) |
| `Secure` cookie during local dev on `http://localhost` | `auth/session.ts` (T27) | Cookie not stored in some browsers | Chrome/Firefox/Safari accept Secure cookies on localhost; dev runs through Vite proxy on localhost |
| Rate-limit and session rows grow without purge | `rate_limit_buckets`, `sessions` | Slow table growth on free tier | Fixed windows keep ≤ 1 row per key/window; purge job is a logged follow-up in gestao |
| scrypt cost on cold function | `lib/crypto.ts` (T24) | ~50 ms per login | Accepted; N=16384 keeps memory at 16 MiB |
| Reference markup relies on Tailwind defaults (`shadow-xl`, `rounded-2xl`, `bg-gradient-to-b`) | `tailwind.config.ts` (T39) | Visual drift if defaults are replaced | Extend (not replace) theme except `borderRadius`, which copies the reference values |
| lucide icon names differ between versions | Home sections (T55–T60) | Build error | Mapping in architecture §9.4; worker verifies exports and substitutes the closest icon |
| WhatsApp prefilled message carries user-typed name/details in the URL | `QuoteModal` (T59) | Data leaves the site to WhatsApp | It is the user's explicit action to message the clinic; nothing is sent to other hosts; gestao replaces it with the API |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Session revocation | JWT carries `sid`; each authenticated request loads the session row | Logout and password reset must revoke immediately; one PK lookup is cheap (AD-021) |
| Login lockout counter | Failed attempts counted in `rate_limit_buckets` keyed by sha256(e-mail); checked before verifying the password | Blocks brute force even with the right password (FND-54) without storing e-mails |
| TOTP for reception | Optional for every role, same flow as admin and tenants (user decision 2026-10-28) | AD-037 (amends AD-005) |
| Recovery codes | 10 codes, SHA-256 hashed in `user_totp.recovery_code_hashes` | Lockout recovery without support tickets |
| Home simulator | Static port of the reference logic over factory defaults | Spec allows static Home; nucleo wires the real engine |
| Quote modal | WhatsApp hand-off | No persistence before gestao; honest UX |
| Test DB in CI | postgres:17 service container | AD-018 |
| Theme attribute | `data-theme="day" \| "night"` on `<html>` | AD-002; matches CSS variable blocks |
| Shared form schemas | zod schemas in `@bravo/core` | One validation for web and API (AD-024) |
