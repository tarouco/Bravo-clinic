# Fundação Validation

## Validation verdict: FAIL

**Date**: 2026-10-26
**Spec**: `.specs/features/fundacao/spec.md` (FND-01..FND-134)
**Diff range**: `6b43446..43d4881` (fundacao commits; nucleo/receita/gestao commits merged on the same range are out of scope)
**Verifier**: independent sub-agent (author ≠ verifier), worktree branch `worktree-agent-a792d14d7542fa4f6`
**Test DB**: Neon verify branch (`DATABASE_URL_VERIFY`), plus a fresh empty database `fundacao_verify_clean` created on that branch for a clean API run

The verdict is FAIL because of a surviving mutant: nothing tests the lower bound of the password policy (FND-17). The other gaps are minor: evidence is missing or only partial for FND-36, FND-80 (timeout), FND-95 (breakpoints), FND-113 (recovery code in the UI), plus one spec-precision gap on FND-129 and one brittle test assertion (FND-31). Everything else is covered, and all gates pass on a clean database.

---

## Task Completion

78 tasks (T1–T78). Each one has every Done-when box checked except three manual checks:

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T37, T39–T76 | ✅ Done | - |
| T38 | ⚠️ Manual box open | `npm run dev -w apps/web` + local API manual check (tasks.md:1251), not verified here |
| T77 | ⚠️ Manual box open | `neonctl logs query` for request log line (tasks.md:2344), not verified here |
| T78 | ⚠️ Manual box open | Admin logs in on production with TOTP (tasks.md:2371): **pending user check**, out of Verifier scope |

---

## Spec-Anchored Acceptance Criteria

Paths are relative to the repo root. `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`.

### P1 Monorepo and quality gates

| AC | Spec-defined outcome | Evidence (`file:line` + assertion) | Result |
| -- | -------------------- | ---------------------------------- | ------ |
| FND-01 | 3 workspaces; root install | `package.json:6` workspaces `apps/web, apps/api, packages/core`; `npm install` exit 0 (verifier run) | ✅ |
| FND-02 | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes, exit 0 | `tsconfig.base.json:12-14`; each workspace `tsconfig.json` extends it; `npm run typecheck` exit 0 | ✅ |
| FND-03 | ESLint lints all, non-zero on error | `npm run lint` exit 0 on tree; in scratch, an injected forbidden import made `eslint` exit 1 (see FND-06) | ✅ |
| FND-04 | Vitest non-zero on failure | `apps/*/package.json` `"test": "vitest run"`; every killed sensor mutant below returned a non-zero `npm test -w` exit | ✅ |
| FND-05 | `apps/web/dist/index.html`, exit 0 | `API_PROXY_ORIGIN=https://example.invalid npm run build` exit 0; `apps/web/dist/index.html` present | ✅ |
| FND-06 | forbidden import in core → `no-restricted-imports` | `eslint.config.js:57-77` rule for `pg, drizzle-orm, hono, react, react-dom, node:*`; scratch check: see Sensor S-L (lint exit 1 with `no-restricted-imports`). `*.test.ts` exempt, as planned in tasks.md:242 | ✅ |

### P1 Money and time helpers

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-07 | `formatBRL(160000)` = `R$ 1.600,00` | `core/money.test.ts:29` `expect(formatBRL(160000)).toBe(\`R$${NBSP}1.600,00\`)` | ✅ |
| FND-08 | 7275 for (14550,50); 4851 for (9701,50) | `core/money.test.ts:47`, `:51` | ✅ |
| FND-09 | 160000 / 9700 / 9750; null otherwise | `core/money.test.ts:103,107,112,120-122` | ✅ |
| FND-10 | 13:00Z; minute 1440 → next day 03:00Z | `core/time.test.ts:25`, `:29` | ✅ |
| FND-11 | `{date:'2026-10-27', minuteOfDay:1410, weekday:2}` | `core/time.test.ts:39-43` `toEqual({...})` | ✅ |
| FND-12 | IANA via Intl, no hard-coded offset | `core/time.test.ts:58-59` (2018 DST offsets differ), `:69` `not.toMatch(/-03:00\|-0300/)` | ✅ |
| FND-13 | `"27/10/2026 10:00"` | `core/time.test.ts:103` | ✅ |

### P1 Document and credential validation

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-14 | `{type:'cpf', digits:'52998224725'}` | `core/validation/document.test.ts:6` | ✅ |
| FND-15 | `{type:'cnpj', digits:'11222333000181'}` | `core/validation/document.test.ts:10-13` | ✅ |
| FND-16 | wrong check digit / all-equal / bad length → null | `core/validation/document.test.ts:23-31` | ✅ |
| FND-17 | reject <8, >128, no letter, no digit, exact message | `core/validation/auth-schemas.test.ts:38-46` (5 chars, 129 chars, no digit, no letter); accepts 8 and 128 at `:56-57`. **No test rejects exactly 7 characters**: mutant M1 (`>= 8` → `>= 7`) SURVIVED | ❌ GAP (weak boundary) |

### P1 Settings catalog

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-18 | every arch §4 key with schema + default | `core/settings/catalog.test.ts:68` keys equal, `:72` `toEqual(expectedDefaults)` | ✅ |
| FND-19 | `SettingValidationError` naming the key | `core/settings/catalog.test.ts:113-119` | ✅ |
| FND-20 | one settings row per key | `api/db/seed.int.test.ts:23` `toHaveLength(settingKeys.length)` | ✅ |

### P1 API skeleton

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-21 | 200 `{status:'ok',db:'ok',branch}` | `api/routes/health.int.test.ts:35-36`, `:45`; cold-start edge `:60-75` (no timeout before 10 s) | ✅ |
| FND-22 | 503 `{status:'degraded',db:'error'}` | `api/routes/health.int.test.ts:56-57` | ✅ |
| FND-23 | names offending vars, no values | `api/env.test.ts:34-38`, `:41-78` per variable | ✅ |
| FND-24 | 422 VALIDATION_FAILED envelope | `api/app.int.test.ts:79-87` exact `toEqual` envelope; query `:105-108` | ✅ |
| FND-25 | 404 NOT_FOUND | `api/app.int.test.ts:142-144` | ✅ |
| FND-26 | 500 INTERNAL "Erro interno", no stack/SQL | `api/app.int.test.ts:155-166` | ✅ |
| FND-27 | one JSON log line with fields; X-Request-Id; redaction | `api/middleware/request-context.test.ts:68-79` fields; `:34-36` header; `api/lib/logger.test.ts:17-22,30-34` redaction | ✅ |
| FND-28 | rollback on throw | `api/db/client.int.test.ts:39-46` `countRows() === 0` | ✅ |
| FND-29 | 415 UNSUPPORTED_MEDIA_TYPE | `api/app.int.test.ts:247-249`, all verbs `:256-259` | ✅ |

### P1 Base schema and migrations

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-30 | 18 tables + btree_gist | `api/db/migrations.int.test.ts:73-74` | ✅ |
| FND-31 | second run applies nothing, exit 0 | `api/db/migrations.int.test.ts:86-89` count unchanged. ⚠️ `:88` hard-codes `expect(before).toBe('2')`, which fails on any database that already has later migrations. It failed on the shared verify branch (it holds 4 nucleo migrations from 2026-10-26) and passed on a fresh database and in CI | ✅ (brittle test, see Gaps) |
| FND-32 | overlap → 23P01 | `api/db/migrations.int.test.ts:110` `toBe('23P01')` | ✅ |
| FND-33 | touching ranges accepted | `api/db/migrations.int.test.ts:116-123` | ✅ |
| FND-34 | inactive row / other room do not conflict | `api/db/migrations.int.test.ts:128-136`, `:143-149` | ✅ |
| FND-35 | UPDATE/DELETE audit_log/consents raise, row unchanged | `api/db/migrations.int.test.ts:189-196`, `:203-206` | ✅ |
| FND-36 | timestamptz / date / `_cents` integers | `api/db/migrations.int.test.ts:97-101` asserts timestamptz only. Local dates are `date` in `apps/api/drizzle/0000_base.sql:86,122,131`, but that is static evidence with no test assertion. No `_cents` column exists in the base schema (vacuous) | ⚠️ partial evidence |

### P1 Seeds and admin bootstrap

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-37 | 3 rooms, tags, active, order | `api/db/seed.int.test.ts:32-36` | ✅ |
| FND-38 | mon–fri 420–1440, sat/sun/holiday 540–1440 open | `api/db/seed.int.test.ts:46-55` | ✅ |
| FND-39 | 28 rows, 20+8, none closed, only 2027-08-15 review | `api/db/seed.int.test.ts:63-67`; `core/calendar/holidays-seed.test.ts:18-27` | ✅ |
| FND-40 | no duplicates, no overwrite | `api/db/seed.int.test.ts:79-99` (report all zero; edited setting/room kept) | ✅ |
| FND-41 | bootstrap admin verified + audit `user.bootstrap_admin` origin system | `api/db/seed.int.test.ts:108-120`; policy edge `:146-151` | ✅ |
| FND-42 | existing admin → no create/modify | `api/db/seed.int.test.ts:131-132`, `:141-142` `rows toEqual [existing]` | ✅ |

### P1 Sign up and verify e-mail

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-43 | 201, tenant, scrypt, cookie, consents, outbox | `api/routes/public/auth/signup.int.test.ts:57-118` | ✅ |
| FND-44 | 422, path `document`, "CPF ou CNPJ inválido" | `signup.int.test.ts:154-159` | ✅ |
| FND-45 | 409 EMAIL_TAKEN case-insensitive (+ spaces, concurrency) | `signup.int.test.ts:187-189`, concurrent `:212-215` | ✅ |
| FND-46 | 409 DOCUMENT_TAKEN | `signup.int.test.ts:201-203` | ✅ |
| FND-47 | 422 and no user | `signup.int.test.ts:169-173` | ✅ |
| FND-48 | set verified, mark used, 200 | `api/routes/public/auth/verify-email.int.test.ts:68-74` | ✅ |
| FND-49 | unknown/used/>24 h → 400 INVALID_TOKEN | `verify-email.int.test.ts:87-88`, `:96-97`, `:105-107` | ✅ |
| FND-50 | resend 202; 4th within 1 h → 429 | `verify-email.int.test.ts:123-133`, `:147-148` | ✅ |
| FND-51 | SHA-256 hashes only | `signup.int.test.ts:103,118`; `password-reset.int.test.ts:92`; `api/lib/crypto.test.ts:71` | ✅ |

### P1 Log in, session and log out

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-52 | 200 `{user, mfaRequired:false}`, cookie attrs, Max-Age 2592000 | `api/routes/public/auth/login.int.test.ts:54-78`; `api/auth/session.int.test.ts:66-71` | ✅ |
| FND-53 | 401 INVALID_CREDENTIALS, same message both | `login.int.test.ts:96-101` | ✅ |
| FND-54 | 6th → 429 + Retry-After even with right password | `login.int.test.ts:121-132`; `api/middleware/rate-limit.int.test.ts:25-27` | ✅ |
| FND-55 | revoked_at set, Max-Age=0, 204 | `api/routes/app/me.int.test.ts:72-82` | ✅ |
| FND-56 | bad sig / exp / revoked / expired row → 401 | `api/auth/session.int.test.ts:123,135,143,154`; `api/middleware/auth.int.test.ts:62` | ✅ |
| FND-57 | exact keys, no hash/TOTP | `me.int.test.ts:29-40`, `:60` | ✅ |
| FND-58 | staff Max-Age/expires_at 12 h | `session.int.test.ts:80-83`; `login.int.test.ts:188` `toBe('43200')` | ✅ |
| FND-59 | foreign Origin → 403 CSRF_REJECTED | `api/middleware/csrf.int.test.ts:52`, `/admin` all verbs `:82-85` | ✅ |

### P1 Reset password

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-60 | always 202; active user → e-mail, 60 min token | `api/routes/public/auth/password-reset.int.test.ts:68-70`, `:78-97`, `:106-107` | ✅ |
| FND-61 | update hash, revoke all, mark used, audit, 200 | `password-reset.int.test.ts:129-148` | ✅ |
| FND-62 | unknown/used/expired → 400, nothing changed | `password-reset.int.test.ts:161-163`, `:172-175`, `:187-189` | ✅ |

### P1 Staff two-factor authentication

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-63 | no confirmed TOTP → 403 MFA_ENROLLMENT_REQUIRED | `api/middleware/auth.int.test.ts:80`, `:88` | ✅ |
| FND-64 | encrypted unconfirmed secret; issuer/label | `api/routes/app/auth/totp.int.test.ts:72-83`; `api/auth/totp.test.ts:40-44` | ✅ |
| FND-65 | 10 codes once, session verified, audit `auth.totp_enabled` | `totp.int.test.ts:127-150` | ✅ |
| FND-66 | `{mfaRequired:true}`, unverified session, 403 MFA_REQUIRED | `login.int.test.ts:183-190`; `totp.int.test.ts:189-193`; `auth.int.test.ts:96` | ✅ |
| FND-67 | current ±1 or recovery code → verified, 200; spaces stripped | `api/auth/totp.test.ts:55-58`; `totp.int.test.ts:199-203`, `:222,226`, recovery `:240-247` | ✅ |
| FND-68 | replayed step → 401 INVALID_CODE | `totp.test.ts:64-65`; `totp.int.test.ts:223-224`, `:156-157` | ✅ |
| FND-69 | 5 invalid → 6th 429 | `totp.int.test.ts:266-267` | ✅ |
| FND-70 | AES-256-GCM ciphertext; SHA-256 recovery hashes | `api/lib/crypto.test.ts:47-65` (tamper/wrong key throws); `totp.int.test.ts:82-83`, `:136-139` | ✅ |

### P1 Roles, access and audit

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-71 | unauth → 401 UNAUTHENTICATED | `api/middleware/auth.int.test.ts:38-39` | ✅ |
| FND-72 | tenant on /admin → 403 FORBIDDEN (+ demotion edge) | `auth.int.test.ts:72`, `:144` | ✅ |
| FND-73 | reception on requireRole('admin') → 403 | `auth.int.test.ts:123` | ✅ |
| FND-74 | `{role, sections}` exact order | `api/routes/admin/session.int.test.ts:29-43`, `:54`; `core/access.test.ts:5-21` | ✅ |
| FND-75 | audit row fields; vanishes on rollback | `api/lib/audit.int.test.ts:38-50`, `:69` | ✅ |
| FND-76 | `{googleEnabled, whatsappE164, environment}` | `api/routes/public/config.int.test.ts:57-61`, `:48-50` | ✅ |

### P1 Transactional e-mail outbox

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-77 | pending row in caller tx | `api/lib/email.int.test.ts:42-50`, rollback `:61` | ✅ |
| FND-78 | Resend → `sent` + provider id | `email.int.test.ts:75-87` | ✅ |
| FND-79 | no key → `not_sent`, request succeeds | `email.int.test.ts:100-101`; `signup.int.test.ts:114` | ✅ |
| FND-80 | fail/timeout 10 s → failed, last_error, attempts++; request succeeds | `email.int.test.ts:113-115`, `:129-131`; `signup.int.test.ts:143-146`. The 10-second timeout is only implied: `email.int.test.ts:84` asserts `signal` is an `AbortSignal`, and the value lives at `apps/api/src/lib/email.ts:8,64` | ⚠️ partial (timeout value unasserted) |

### P1 Design system tokens and theme

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-81 | `rgb(var(--c-<key>) / <alpha-value>)` per DESIGN.md color | `web/styles/tailwind-config.test.ts:64` | ✅ |
| FND-82 | Night/Day columns of arch §9.3 | `web/styles/tokens.test.ts:71-76`, `:88` | ✅ |
| FND-83 | toggle flips + `localStorage['bravo-theme']`; storage-unavailable edge | `web/theme/ThemeProvider.test.tsx:46-54`, `:65-67` | ✅ |
| FND-84 | prefers-color-scheme default, inline script before paint | `ThemeProvider.test.tsx:75`, `:113-117`, `:130-143` | ✅ |
| FND-85 | typography tokens + fonts | `tailwind-config.test.ts:70-102`, `:116-125` | ✅ |
| FND-86 | strokeWidth 1.5, aria-hidden / role=img + label | `web/components/ui/Icon.test.tsx:12-15`, `:20-24` | ✅ |

### P1 Base UI components

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-87 | variants + loading disabled/aria-busy | `web/components/ui/Button.test.tsx:11,17-22,27,57-58`; h-12 = 48px, `rounded-control` = 2px (`tailwind-config.test.ts:135`) | ✅ |
| FND-88 | label htmlFor/id; aria-invalid + describedby | `web/components/ui/form/form.test.tsx:19-20`, `:29-31` | ✅ |
| FND-89 | focus inside, Tab cycles, Escape closes + restores focus | `web/components/ui/Modal.test.tsx:39-42`, `:68-75`, `:84-86` | ✅ |
| FND-90 | Arrow keys select next/prev, roles | `web/components/ui/Tabs.test.tsx:15-25`, `:41-43`, `:50-55` | ✅ |
| FND-91 | champagne-soft, on-champagne, uppercase caption | `web/components/ui/Card.test.tsx:52-57` | ✅ |
| FND-92 | 2px bronze ring + 2px offset on focus-visible | `Button.test.tsx:75-79`; `form.test.tsx:44,83,91,101`; `Tabs.test.tsx:90`. Modal close is a `Button` (`apps/web/src/components/ui/Modal.tsx:34`), so it is covered indirectly | ✅ |
| FND-93 | role=status, aria-live polite, 6 s dismiss unless action | `web/components/ui/Toast.test.tsx:35-47`, `:58-62` | ✅ |
| FND-94 | RoomCard content + placeholder + formatBRL "/h" | `web/components/ui/RoomCard.test.tsx:20-25,31,40-42,53,61` | ✅ |

### P1 Public layout and Home page

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-95 | fixed 80px header, links, location from `xl`, nav from `lg`, Login/Minha conta | `web/components/layout/Header.test.tsx:44-58`, `:63-64`, `:69-77`. The breakpoint visibility (`hidden xl:flex`, `hidden lg:flex` at `apps/web/src/components/layout/Header.tsx:35,41`) has no assertion | ⚠️ partial |
| FND-96 | menu opens, aria-expanded=true | `Header.test.tsx:83-95` | ✅ |
| FND-97 | footer columns, address, hours | `web/components/layout/Footer.test.tsx:30-40` | ✅ |
| FND-98 | floating WhatsApp, 24px, target/rel/href, label from sm | `web/components/layout/WhatsAppButton.test.tsx:19-21,27-29,36-37,44-45`; every page `PublicLayout.test.tsx:65,70` | ✅ |
| FND-99 | section order + ids | `web/pages/public/home/HomePage.test.tsx:50-67` | ✅ |
| FND-100 | 160/80/80; 97; 198; 120 | `web/pages/public/home/PricingSimulatorSection.test.tsx:69-71,91,109,118`; `web/features/home/simulator.test.ts:9-32` | ✅ |
| FND-101 | no São Paulo/Jardins; sinal not refundable | `HomePage.test.tsx:74`; `HomeStaticSections.test.tsx:47-48` | ✅ |
| FND-102 | modal titled; submit opens wa.me with text in new tab, closes | `web/pages/public/home/ExtrasSection.test.tsx:45-48`, `:62-75` | ✅ |
| FND-103 | select room + smooth scroll to #simulador | `HomePage.test.tsx:86-89`, `:98-100` | ✅ |
| FND-104 | Google Fonts only, no Tailwind CDN / Material Symbols | `web/seo/static-seo.test.ts:93-98` | ✅ |
| FND-105 | 404 in public layout with link to `/` | `web/components/layout/PublicLayout.test.tsx:52-59` | ✅ |

### P1 Authentication pages

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-106 | 401 message; mfaRequired → /login/2fa; next / default | `web/pages/auth/LoginPage.test.tsx:74,102,124,134,154` | ✅ |
| FND-107 | unsafe next ignored | `LoginPage.test.tsx:144`; `web/features/auth/hooks.test.tsx:47-51` | ✅ |
| FND-108 | invalid doc message, no API call; submit disabled until both checked; links | `web/pages/auth/SignupPage.test.tsx:76-77`, `:85-93` | ✅ |
| FND-109 | 201 → /app + banner; 409 field messages | `SignupPage.test.tsx:107-108`, `:133`, `:146` | ✅ |
| FND-110 | verify once; success / 400 + resend | `web/pages/auth/VerifyEmailPage.test.tsx:64-67`, `:79-83` | ✅ |
| FND-111 | neutral forgot message; reset success + /login link | `web/pages/auth/password/password-pages.test.tsx:36-43`, `:73-74` | ✅ |
| FND-112 | QR, code, 10 codes, "Já guardei" → /admin | `web/pages/auth/TwoFactorPages.test.tsx:133-152` | ✅ |
| FND-113 | 6-digit or recovery code → /admin; 401 → "Código inválido" | `TwoFactorPages.test.tsx:61`, `:75`. A recovery code is only accepted at schema level (`core/validation/auth-schemas.test.ts:93`); no page test submits one | ⚠️ partial |

### P1 App and Admin shells with guards

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-114 | redirect to `/login?next=` | `web/router.test.tsx:86`, `:93` | ✅ |
| FND-115 | tenant → "Acesso restrito" with /app link | `router.test.tsx:100-105` | ✅ |
| FND-116 | unverified staff → /login/2fa or /configurar | `router.test.tsx:112`, `:119` | ✅ |
| FND-117 | admin 10 items / reception 2; placeholder "Em construção" | `web/components/layout/AdminShell.test.tsx:96-97,116,130-131`; `core/access.test.ts:37-48` | ✅ |
| FND-118 | tab bar <lg, sidebar ≥lg, 5 items, Sair | `web/components/layout/AppShell.test.tsx:77-92`, `:122-125` | ✅ |

### P1 PWA and static SEO

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-119 | manifest fields + icons | `web/pwa/pwa-config.test.ts:24-46`, sizes `:50-55` | ✅ |
| FND-120 | precache + `/api/` NetworkOnly | `pwa-config.test.ts:67-70`, `:76-85` | ✅ |
| FND-121 | toast "Nova versão disponível" + "Atualizar" | `web/pwa/PwaUpdatePrompt.test.tsx:39-40`, `:50` | ✅ |
| FND-122 | one LocalBusiness block, address, hours, url = VITE_SITE_URL | `web/seo/static-seo.test.ts:65-85`, `:104-111`; built `apps/web/dist/index.html` checked by verifier: 1 ld+json block, `"url": "https://bravo-clinic.netlify.app"` | ✅ |
| FND-123 | lang, title, description, OG tags, 1200×630 absolute image | `static-seo.test.ts:39-60`; built `og:image` = `https://bravo-clinic.netlify.app/og-image.jpg` | ✅ |
| FND-124 | robots disallow /app, /admin; sitemap | `static-seo.test.ts:118-138` | ✅ |

### P1 Delivery pipeline and first production deploy

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-125 | `_redirects` first `/api/*` proxy, last SPA fallback; strip `/` | `apps/web/scripts/write-redirects.test.mjs:14`, `:19-20`, `:25-26`; built `apps/web/dist/_redirects` = 2 rules as specified | ✅ |
| FND-126 | missing/non-https → "API_PROXY_ORIGIN must be an https URL" | `write-redirects.test.mjs:30-36`, CLI `:45-46` | ✅ |
| FND-127 | slug `api`, source, env from process.env, optional keys omitted | `api/neon.test.ts:36`, `:41-46`, `:52`, `:61-68` | ✅ |
| FND-128 | CI on push/PR to main: npm ci, typecheck, lint, test (postgres:17), build | `.github/workflows/ci.yml:3-7,24,42-46`; GitHub run 40263908870 on `43d4881`: success (web 58, api 26, core 32 test files passed) | ✅ |
| FND-129 | prod health 200 `branch:production`, Home 200 with hero headline, config 200 | `node scripts/smoke.mjs https://bravo-clinic.netlify.app` → all 3 ok (verifier run 2026-10-26); `curl /api/health` = `{"status":"ok","db":"ok","branch":"production"}`. ⚠️ `scripts/smoke.mjs:33` checks `body.includes('Bravô Clinic')`, not the hero headline (the headline is rendered client-side). Admin TOTP login on production: pending user check | ⚠️ spec-precision gap |
| FND-130 | `.env.example` names only; `.env*` ignored | `.env.example` has no non-empty values (verifier grep); `.gitignore:3-5`; `git check-ignore` ignores `.env`, `.env.local`, `.env.production`; history grep for real Neon DSNs is empty | ✅ |

### P2 Google login

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-131 | 302, state, S256, scopes, 10 min HttpOnly cookie | `api/routes/public/auth/google.int.test.ts:115-138` | ✅ |
| FND-132 | login by sub / verified e-mail / create; redirect | `google.int.test.ts:146-166`, `:192-197`, `:206-210` | ✅ |
| FND-133 | bad/missing state → 400 INVALID_STATE, no session | `google.int.test.ts:251-257`, `:263-265` | ✅ |
| FND-134 | 404 FEATURE_DISABLED; googleEnabled false; no button | `google.int.test.ts:107-108`; `config.int.test.ts:30`; `web/pages/auth/LoginPage.test.tsx:187` | ✅ |

**Status**: ❌ 1 AC gap (FND-17), ⚠️ 4 partial-evidence ACs (FND-36, FND-80, FND-95, FND-113), ⚠️ 1 spec-precision gap (FND-129). 128/134 fully evidenced.

---

## Edge Cases

- [x] Cold start: health waits up to 10 s (`api/routes/health.int.test.ts:60-75`)
- [x] Concurrent signup with the same e-mail: one 201 and one 409 (`signup.int.test.ts:206-215`)
- [x] E-mail case and spaces (`signup.int.test.ts:178-189`; `login.int.test.ts:52`)
- [x] Staff demoted mid-session → 403 (`auth.int.test.ts:136-145`)
- [x] TOTP "123 456" (`totp.int.test.ts:214-222`)
- [x] localStorage unavailable (`ThemeProvider.test.tsx:57-68`)
- [x] `localToUtc` minute 1440 (`core/time.test.ts:28-30`)
- [x] Bootstrap password policy failure message (`seed.int.test.ts:145-152`)
- [x] Trailing `/` on API_PROXY_ORIGIN (`write-redirects.test.mjs:12-26`)

---

## Discrimination Sensor

Expanded tier (auth/security feature): 12 behavior-level mutations plus one lint check. Each one ran in a scratch copy of HEAD (`git archive` extracted to the scratchpad, with its own `npm install`). API mutants ran against the fresh `fundacao_verify_clean` database; M12 ran against its own fresh database. The real worktree was never mutated.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `packages/core/src/validation/auth-schemas.ts:10` | password min length `>= 8` → `>= 7` (FND-17) | ❌ Survived (core validation 179/179 pass; re-run repo-wide in scratch: core 1189/1189, web `src/pages/auth` 31/31, api signup/password-reset/seed 27/27 all pass) |
| M2 | `packages/core/src/money.ts:52` | half-up rounding → floor division (FND-08) | ✅ Killed (3 failed) |
| M3 | `packages/core/src/time.ts:101` | São Paulo offset applied with the wrong sign (FND-10) | ✅ Killed (6 failed) |
| M4 | `packages/core/src/validation/document.ts:20` | CPF/CNPJ check digit `11 - rest` → `10 - rest` (FND-14..16) | ✅ Killed (5 failed) |
| M5 | `apps/api/src/auth/session.ts:124` | session lookup ignores `revoked_at` (FND-55/56) | ✅ Killed (4 failed) |
| M6 | `apps/api/src/auth/session.ts:125` | session lookup ignores `expires_at` (FND-56) | ✅ Killed (1 failed) |
| M7 | `apps/api/src/middleware/auth.ts:30` | MFA_REQUIRED gate on /admin skipped (FND-66) | ✅ Killed (4 failed) |
| M8 | `apps/api/src/middleware/auth.ts:27` | MFA_ENROLLMENT_REQUIRED gate skipped (FND-63) | ✅ Killed (2 failed) |
| M9 | `apps/api/src/middleware/csrf.ts:27` | CSRF rejects only a missing origin, accepts a foreign one (FND-59) | ✅ Killed (3 failed) |
| M10 | `apps/api/src/modules/auth/login.service.ts:15` | login lockout limit 5 → 6 (FND-54) | ✅ Killed (1 failed) |
| M11 | `apps/api/src/auth/totp.ts:54` | TOTP replay `step <= last` → `step < last` (FND-68) | ✅ Killed (1 failed) |
| M12 | `apps/api/drizzle/0001_base_constraints.sql:4` | exclusion constraint without `WHERE (active)` (FND-34) | ✅ Killed (1 failed; run on fresh DB `fundacao_verify_m12`) |
| S-L | `packages/core/src/index.ts` | added `import 'pg'` + `import 'node:fs'` (FND-06) | ✅ Rejected: `eslint` exit 1, two `no-restricted-imports` errors (`pg`, `node:fs`) |

**Sensor depth**: P0-expanded (≥5 manual mutations, auth/security)
**Outcome**: 11/12 mutants killed; M1 survived, which gives Fix 1
**Isolation**: the real worktree's `git status --porcelain` baseline before the sensor was empty. After the sensor its only entry is this report (`?? .specs/features/fundacao/validation.md`), and no source file changed.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / surgical changes / no scope creep | ✅ (spot-checked core money/time/document, api auth/csrf/session/totp) |
| Matches patterns | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ FND-17 lower bound, FND-80 timeout, FND-129 hero headline |
| Per-layer Coverage Expectation met | ⚠️ FND-36 date/`_cents` not asserted by a test |
| Every test maps to a spec requirement | ✅ (tests carry FND tags or map to Done-when/edge cases) |
| Documented guidelines followed: tasks.md Test Coverage Matrix (tasks.md:30-36) | ✅ |
| Test robustness | ⚠️ `api/db/migrations.int.test.ts:88` hard-codes the applied migration count `'2'` |

---

## Gate Check

- **Gate command**: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- **typecheck**: exit 0 · **lint**: exit 0 · **build**: exit 0 (`apps/web/dist/index.html`, `_redirects`, `sw.js`, manifest produced)
- **test**: core 1189/1189 passed (32 files), web 463/463 passed (58 files). API on the shared verify branch: 200/201, with 1 failure at `api/db/migrations.int.test.ts:88` (`expected '4' to be '2'`). That failure comes from the environment: the verify branch already holds 4 drizzle migrations (two later nucleo migrations applied 2026-10-26T03:23Z). The same HEAD run against a fresh empty database (`fundacao_verify_clean`) passed **201/201**, and CI on `43d4881` (fresh postgres:17) passed.
- **Totals on a clean database**: 1853 passed, 0 failed, 0 skipped
- **Skipped tests**: none

---

## Fix Plans

### Fix 1: Password policy lower bound is untested (Major, sensor M1)

- **Root cause**: `passwordSchema` tests reject 5 characters and accept 8, but never reject exactly 7.
- **Fix task**: in `packages/core/src/validation/auth-schemas.test.ts:38-46`, add `['7 characters long', 'abcdef1']` to the reject table, asserting `PASSWORD_MESSAGE`.
- **Done when**: mutant `v.length >= 7` makes `npm test -w packages/core` fail.

### Fix 2: Migration idempotency test hard-codes the migration count (Minor)

- **Root cause**: `apps/api/src/db/migrations.int.test.ts:88` `expect(before).toBe('2')` breaks on any database with later migrations, and will break as soon as nucleo adds `0002_*`.
- **Fix task**: derive the expected count from `apps/api/drizzle/meta/_journal.json` entries (or assert `>= 2` with the unchanged-count check kept).
- **Done when**: the test passes on a database that already has later migrations.

### Fix 3: Partial evidence (Minor)

- FND-36: assert that every column named `date` / `valid_from` / `valid_until` in `information_schema.columns` is `date`, and that every `*_cents` column is `integer`/`bigint` (`migrations.int.test.ts:92`).
- FND-80: add a fake-timer test proving that a hung provider call is aborted at 10 000 ms and the row is marked `failed` (`email.int.test.ts`).
- FND-95: assert `hidden xl:flex` on the location element and `hidden lg:flex` on the nav (`Header.test.tsx`).
- FND-113: add a `/login/2fa` page test submitting `ABCD-EFGH` and navigating to `/admin` (`TwoFactorPages.test.tsx`).
- FND-129: make `scripts/smoke.mjs` assert something the static HTML can prove, or amend the spec wording (the hero headline renders client-side).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| FND-17 | In Tasks | ❌ Needs Fix (test) |
| FND-36, FND-80, FND-95, FND-113, FND-129 | In Tasks | ⚠️ Verified with partial evidence |
| FND-31 | In Tasks | ✅ Verified (brittle test, Fix 2) |
| All other FND-01..FND-134 | In Tasks | ✅ Verified |

---

## Summary

**Overall**: ❌ Not Ready. The implementation behaves correctly; one discrimination gap in the tests must be closed first.

**Spec-anchored check**: 128/134 ACs fully matched, 1 gap (FND-17), 4 partial, 1 spec-precision gap (FND-129)
**Sensor**: 12 mutations injected, 11 killed, 1 survived (M1); lint purity check S-L rejected as required
**Gate**: typecheck/lint/build exit 0; 1853/1853 tests pass on a clean database (1 environmental failure on the shared verify branch)

**What works**: every gate, money/time/document helpers, the full auth stack (sessions, CSRF, lockout, TOTP, MFA gates), DB constraints, the seeds, the web design system/Home/auth pages/shells, PWA/SEO, CI and the production smoke check.

**Next steps**: route Fix 1 (required) and Fixes 2–3 (recommended) to an implementer, then re-verify.
