# Fundação Validation

## Validation verdict: PASS

**Date**: 2026-10-26 (re-verification, iteration 2 of 3)
**Spec**: `.specs/features/fundacao/spec.md` (FND-01..FND-134)
**Diff range**: `6b43446..43d4881` (fundacao implementation) + `e06ec51..00e7cde` (iteration-1 fix commits `6c1dd87`, `b695034`, `ee1687a`, `74aa22d`, `9b9e6d6`, `54ca2b0`, `7280155`). Verified on `main` at `c89ed81` (nucleo backend merged on top; out of scope except where it touches fundacao files)
**Verifier**: independent sub-agent (author ≠ verifier), worktree branch `verify-fundacao-it2`
**Test DB**: a fresh empty database `fundacao_verify_it2`, created for this run on the Neon verify branch (`DATABASE_URL_VERIFY`). It is not the dev branch and not production.

All seven gaps from iteration 1 are closed with `file:line` evidence. All 10 sensor mutants were killed, including M1 (password minimum `>= 8` → `>= 7`), the mutant that survived in iteration 1. Every fundacao test passes.

The only red result is outside fundacao. The repo-wide `npm test` exits 1 because of one nucleo web test (`apps/web/src/pages/app/AgendaPage.test.tsx:32`, NUC-190). It fails only under full-suite load and passes when run alone (see Gate Check). FND-129 carries a documented `// SPEC_DEVIATION` (`scripts/smoke.mjs:34`). It does not block, but the spec wording should be amended.

---

## Iteration history

| Iteration | Verdict | Summary |
| --------- | ------- | ------- |
| 1 (2026-10-26, branch `worktree-agent-a792d14d7542fa4f6`) | FAIL | Mutant M1 (`>= 8` → `>= 7`) survived (FND-17). Partial evidence for FND-36, FND-80, FND-95 and FND-113, a spec-precision gap on FND-129, and a brittle migration count in the FND-31 test. 128/134 ACs fully evidenced; 11/12 mutants killed |
| 2 (this report) | PASS | Every iteration-1 gap closed (table below). 134/134 ACs evidenced; 10/10 mutants killed. FND-129 is accepted with a documented SPEC_DEVIATION |

### Iteration-1 gaps: closure evidence

| Gap | Fix commit | Evidence now | Status |
| --- | ---------- | ------------ | ------ |
| FND-17: no test rejects 7 characters (M1 survived) | `6c1dd87` | `packages/core/src/validation/auth-schemas.test.ts:40` `['7 characters long…', 'abcde12']` in the reject table, asserted at `:46-47` (`toEqual([PASSWORD_MESSAGE])`); boundary test `:61-72` (`safeParse('abcde12').success` → `false`, 8 and 128 accepted, 129 rejected). Sensor S1 below: **killed** (2 failures) | ✅ Closed |
| FND-31: migration count hard-coded to `'2'` | `b695034` | `apps/api/src/db/migrations.int.test.ts:82-99`: the expected count comes from `drizzle/meta/_journal.json`. `:98` checks that every journal `when` is applied, and `:99` that a rerun leaves the applied list unchanged (`toEqual(before)`). Passed on a fresh database that already has the 4 journal migrations (2 fundacao + 2 nucleo) | ✅ Closed |
| FND-36: `date`/`_cents` not asserted | `ee1687a` | `migrations.int.test.ts:114-135`: `holidays.date`, `closed_days.date`, `block_recurrences.valid_from/valid_until` are `toBe('date')` (`:126-129`), and every `*_cents` column is `integer`/`bigint` (`:133-134`). Instants are asserted at `:102-112`. Note: on `c89ed81` the `_cents` check is no longer vacuous, because the nucleo migration adds `_cents` columns and they pass | ✅ Closed |
| FND-80: 10 s timeout value not asserted | `74aa22d` | `apps/api/src/lib/email.int.test.ts:118-148`: `AbortSignal.timeout` is `toHaveBeenCalledWith(10_000)` (`:135`), its signal is passed to fetch (`:136`), and after the abort the row is `failed`, `attempts` is 1 and `lastError` contains "timed out" (`:145-147`). Sensor S8 (`10_000` → `20_000`): **killed** | ✅ Closed |
| FND-95: breakpoint visibility not asserted | `9b9e6d6` | `apps/web/src/components/layout/Header.test.tsx:61-73`: the location has `hidden xl:flex` and not `lg:flex` (`:64-65`), the nav has `hidden lg:flex` (`:68`), and the menu button has `lg:hidden` (`:72`). Sensor S9 (location `xl:flex` → `lg:flex`): **killed** | ✅ Closed |
| FND-113: no page test submits a recovery code | `54ca2b0` | `apps/web/src/pages/auth/TwoFactorPages.test.tsx:67-81`: typing `abcd-efgh` navigates to `/admin` (`:75`) and posts `{"code":"ABCD-EFGH"}` to `/api/app/auth/totp/verify` (`:78-80`). Sensor S4 (upper-casing removed): **killed** | ✅ Closed |
| FND-129: smoke checks `'Bravô Clinic'`, not the hero headline | `7280155` | `scripts/smoke.mjs:31-51` now asserts status 200, `<title>` containing "Bravô Clinic – Salas Inteligentes" and a parseable `LocalBusiness` JSON-LD block. `// SPEC_DEVIATION` at `scripts/smoke.mjs:34` (the hero renders client-side). The verifier also checked that the production bundle `/assets/index-CUYI1CUa.js` served by the Home contains the headline "Saúde, beleza e bem-estar em um só lugar." (source `apps/web/src/pages/public/home/HeroSection.tsx:55`; `HomePage.test.tsx:54` asserts the h1 renders) | ✅ Accepted deviation (spec wording to amend) |

---

## Task Completion

78 tasks (T1–T78) plus the 7 iteration-1 fix commits. Every Done-when box is checked except three manual checks, which are **pending user/ops checks, not failures**:

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T37, T39–T76 | ✅ Done | - |
| T38 | ⏭️ Pending user check | Local `npm run dev` manual check (tasks.md T38 Done-when) |
| T77 | ⏭️ Pending ops check | `neonctl logs query` request-log line on production |
| T78 | ⏭️ Pending user check | Admin logs in on production with TOTP |

---

## Spec-Anchored Acceptance Criteria

Paths are relative to the repo root. `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`. The verifier re-read every assertion cited below at HEAD `c89ed81`. Line numbers are current for that commit; several fundacao test files shifted after iteration 1.

### P1 Monorepo and quality gates

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| FND-01 | 3 workspaces; root install | `package.json:6-10`; `npm install` exit 0 (verifier run) | ✅ |
| FND-02 | strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes; exit 0 | `tsconfig.base.json:12-14`; `npm run typecheck` exit 0 | ✅ |
| FND-03 | ESLint on every workspace, non-zero on error | `npm run lint` exit 0 on the tree; exit 1 on the forbidden-import probe (FND-06) | ✅ |
| FND-04 | Vitest exits non-zero on failure | `apps/*/package.json` `"test": "vitest run"`; each killed mutant below returned exit 1 | ✅ |
| FND-05 | `apps/web/dist/index.html`, exit 0 | `API_PROXY_ORIGIN=https://example.invalid npm run build` exit 0; `apps/web/dist/index.html` present | ✅ |
| FND-06 | forbidden import in core fails with `no-restricted-imports` | `eslint.config.js:57-80`. Verifier probe: `import 'pg'` + `node:fs` piped as `packages/core/src/money.ts` through `eslint --stdin` → exit 1 with two `no-restricted-imports` errors. No file was written | ✅ |

### P1 Money and time helpers

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-07 | `R$ 1.600,00` with NBSP | `core/money.test.ts:29` | ✅ |
| FND-08 | 7275 / 4851 half up | `core/money.test.ts:47`, `:51` | ✅ |
| FND-09 | 160000 / 9700 / 9750; null | `core/money.test.ts:103-122`; sensor S2 killed | ✅ |
| FND-10 | 13:00Z; 1440 → next day 03:00Z | `core/time.test.ts:25`, `:29` | ✅ |
| FND-11 | `{date:'2026-10-27', minuteOfDay:1410, weekday:2}` | `core/time.test.ts:39-43`; sensor S3 killed | ✅ |
| FND-12 | IANA via Intl; no hard-coded offset | `core/time.test.ts:58-59`, `:69` | ✅ |
| FND-13 | `27/10/2026 10:00` | `core/time.test.ts:103` | ✅ |

### P1 Document and credential validation

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-14 | cpf digits | `core/validation/document.test.ts:6` | ✅ |
| FND-15 | cnpj digits | `core/validation/document.test.ts:10-13` | ✅ |
| FND-16 | bad check digit / all-equal / length → null | `core/validation/document.test.ts:23-31` | ✅ |
| FND-17 | reject <8, >128, no letter, no digit; exact message | `core/validation/auth-schemas.test.ts:38-48` (including 7 chars at `:40`), `:61-72`; sensor S1 killed | ✅ |

### P1 Settings catalog

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-18 | every arch §4 key, schema + default | `core/settings/catalog.test.ts:68`, `:72` | ✅ |
| FND-19 | `SettingValidationError` naming the key | `core/settings/catalog.test.ts:113-119` | ✅ |
| FND-20 | one settings row per key | `api/db/seed.int.test.ts:23` | ✅ |

### P1 API skeleton

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-21 | 200 `{status, db, branch}`; cold start | `api/routes/health.int.test.ts:35-36`, `:45`, `:60-75` | ✅ |
| FND-22 | 503 degraded | `api/routes/health.int.test.ts:56-57` | ✅ |
| FND-23 | names vars, no values | `api/env.test.ts:34-78` | ✅ |
| FND-24 | 422 envelope | `api/app.int.test.ts:79-87`, `:105-108` | ✅ |
| FND-25 | 404 NOT_FOUND | `api/app.int.test.ts:142-144` | ✅ |
| FND-26 | 500 INTERNAL "Erro interno", no stack/SQL | `api/app.int.test.ts:150-166` (`code: 'INTERNAL'`, `message: 'Erro interno'`, `not.toContain('stack')`) | ✅ |
| FND-27 | JSON log line, X-Request-Id, redaction | `api/middleware/request-context.test.ts:34-36`, `:68-79`; `api/lib/logger.test.ts:17-34` | ✅ |
| FND-28 | rollback on throw | `api/db/client.int.test.ts:39-46` | ✅ |
| FND-29 | 415 on non-JSON mutation | `api/app.int.test.ts:247-259` | ✅ |

### P1 Base schema and migrations

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-30 | 18 tables + btree_gist | `api/db/migrations.int.test.ts:66-76` | ✅ |
| FND-31 | rerun applies nothing, exit 0 | `api/db/migrations.int.test.ts:78-100` (journal-derived, `toEqual(before)` at `:99`) | ✅ |
| FND-32 | overlap → 23P01 | `api/db/migrations.int.test.ts:143` `toBe('23P01')` | ✅ |
| FND-33 | touching ranges accepted | `api/db/migrations.int.test.ts:146-157` | ✅ |
| FND-34 | inactive row and other rooms do not conflict | `api/db/migrations.int.test.ts:159-183` | ✅ |
| FND-35 | UPDATE/DELETE audit_log/consents raise, row unchanged | `api/db/migrations.int.test.ts:214-229`, `:232-240` | ✅ |
| FND-36 | timestamptz / date / `_cents` integer | `api/db/migrations.int.test.ts:102-112`, `:114-135` | ✅ |

### P1 Seeds and admin bootstrap

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-37 | 3 rooms, tags, active, order | `api/db/seed.int.test.ts:32-36` | ✅ |
| FND-38 | business hours | `api/db/seed.int.test.ts:46-55` | ✅ |
| FND-39 | 28 holidays, only 2027-08-15 needs review | `api/db/seed.int.test.ts:63-67`; `core/calendar/holidays-seed.test.ts:18-27` | ✅ |
| FND-40 | idempotent, no overwrite | `api/db/seed.int.test.ts:79-99`. Nucleo's additive category seed (`api/db/seed.ts`) leaves these assertions green | ✅ |
| FND-41 | bootstrap admin + audit `user.bootstrap_admin`/`system`; policy edge | `api/db/seed.int.test.ts:108-120`, `:145-152` | ✅ |
| FND-42 | existing admin untouched | `api/db/seed.int.test.ts:131-142` | ✅ |

### P1 Sign up and verify e-mail

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-43 | 201, tenant, scrypt, cookie, consents, outbox | `api/routes/public/auth/signup.int.test.ts:57-118` | ✅ |
| FND-44 | 422 `document` "CPF ou CNPJ inválido" | `signup.int.test.ts:154-159` | ✅ |
| FND-45 | 409 EMAIL_TAKEN case/space-insensitive, concurrent | `signup.int.test.ts:187-189`, `:212-215` | ✅ |
| FND-46 | 409 DOCUMENT_TAKEN | `signup.int.test.ts:201-203` | ✅ |
| FND-47 | 422, no user | `signup.int.test.ts:169-173` | ✅ |
| FND-48 | verified, token used, 200 | `api/routes/public/auth/verify-email.int.test.ts:68-74` | ✅ |
| FND-49 | unknown/used/>24 h → 400 INVALID_TOKEN | `verify-email.int.test.ts:87-107`; sensor S5 (TTL 24 h → 48 h) killed | ✅ |
| FND-50 | resend 202; 4th in 1 h → 429 | `verify-email.int.test.ts:123-148`; sensor S7 (limit 3 → 4) killed | ✅ |
| FND-51 | SHA-256 token hashes only | `signup.int.test.ts:103,118`; `password-reset.int.test.ts:92`; `api/lib/crypto.test.ts:71` | ✅ |

### P1 Log in, session and log out

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-52 | 200 `{user, mfaRequired:false}`, cookie attributes, Max-Age 2592000 | `api/routes/public/auth/login.int.test.ts:54-78`; `api/auth/session.int.test.ts:60-71` | ✅ |
| FND-53 | 401 same message both cases | `login.int.test.ts:96-101` | ✅ |
| FND-54 | 6th → 429 + Retry-After | `login.int.test.ts:118-132`; `api/middleware/rate-limit.int.test.ts:25-27` | ✅ |
| FND-55 | revoked_at, Max-Age=0, 204 | `api/routes/app/me.int.test.ts:72-82` | ✅ |
| FND-56 | bad sig / exp / revoked / expired → 401 | `api/auth/session.int.test.ts:123-154`; `api/middleware/auth.int.test.ts:62` | ✅ |
| FND-57 | exact keys, no hash/TOTP | `me.int.test.ts:29-40`, `:60` | ✅ |
| FND-58 | staff 12 h | `session.int.test.ts:80-83`; `login.int.test.ts:188`; sensor S10 killed (2 failures) | ✅ |
| FND-59 | foreign Origin → 403 CSRF_REJECTED | `api/middleware/csrf.int.test.ts:52`, `:70`, `:82-85` | ✅ |

### P1 Reset password

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-60 | always 202; 60 min token | `api/routes/public/auth/password-reset.int.test.ts:68-107` | ✅ |
| FND-61 | hash, revoke all, used, audit, 200 | `password-reset.int.test.ts:129-148`; sensor S6 (revocation removed) killed | ✅ |
| FND-62 | invalid → 400, nothing changed | `password-reset.int.test.ts:161-189` | ✅ |

### P1 Staff two-factor authentication

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-63 | 403 MFA_ENROLLMENT_REQUIRED | `api/middleware/auth.int.test.ts:80`, `:88` | ✅ |
| FND-64 | encrypted unconfirmed secret; issuer/label | `api/routes/app/auth/totp.int.test.ts:72-83`; `api/auth/totp.test.ts:40-44` | ✅ |
| FND-65 | 10 codes, verified session, audit | `totp.int.test.ts:127-150` | ✅ |
| FND-66 | `{mfaRequired:true}`, 403 MFA_REQUIRED | `login.int.test.ts:183-190`; `totp.int.test.ts:189-193`; `auth.int.test.ts:96` | ✅ |
| FND-67 | ±1 step or recovery code; spaces stripped | `api/auth/totp.test.ts:55-58`; `totp.int.test.ts:199-247` | ✅ |
| FND-68 | replay → 401 INVALID_CODE | `totp.test.ts:64-65`; `totp.int.test.ts:157`, `:224` | ✅ |
| FND-69 | 5 invalid → 429 | `totp.int.test.ts:266-267` | ✅ |
| FND-70 | AES-256-GCM; SHA-256 recovery hashes | `api/lib/crypto.test.ts:47-65`; `totp.int.test.ts:82-83`, `:136-139` | ✅ |

### P1 Roles, access and audit

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-71 | 401 UNAUTHENTICATED | `api/middleware/auth.int.test.ts:38-39` | ✅ |
| FND-72 | tenant → 403 FORBIDDEN; demotion | `auth.int.test.ts:72`, `:144` | ✅ |
| FND-73 | reception on `requireRole('admin')` → 403 | `auth.int.test.ts:123` | ✅ |
| FND-74 | `{role, sections}` ordered | `api/routes/admin/session.int.test.ts:29-54`; `core/access.test.ts:5-21` | ✅ |
| FND-75 | audit row fields; rollback | `api/lib/audit.int.test.ts:38-50`, `:69` | ✅ |
| FND-76 | `{googleEnabled, whatsappE164, environment}` | `api/routes/public/config.int.test.ts:48-61` | ✅ |

### P1 Transactional e-mail outbox

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-77 | pending row in caller tx | `api/lib/email.int.test.ts:42-61` | ✅ |
| FND-78 | `sent` + provider id | `email.int.test.ts:75-87` | ✅ |
| FND-79 | `not_sent`, request succeeds | `email.int.test.ts:100-101`; `signup.int.test.ts:114` | ✅ |
| FND-80 | failure/timeout after 10 s → failed, last_error, attempts++ | `email.int.test.ts:113-115`, `:118-148`, `:161`; `signup.int.test.ts:143-146`; sensor S8 killed | ✅ |

### P1 Design system tokens and theme

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-81 | `rgb(var(--c-<key>) / <alpha-value>)` | `web/styles/tailwind-config.test.ts:63-64` | ✅ |
| FND-82 | Day/Night columns | `web/styles/tokens.test.ts:71-76` | ✅ |
| FND-83 | toggle + `localStorage['bravo-theme']`; no-storage edge | `web/theme/ThemeProvider.test.tsx:46-54`, `:65-67` | ✅ |
| FND-84 | prefers-color-scheme; inline script | `ThemeProvider.test.tsx:75`, `:113-143` | ✅ |
| FND-85 | typography tokens + fonts | `web/styles/tailwind-config.test.ts:70-125` | ✅ |
| FND-86 | stroke 1.5, aria-hidden / role=img | `web/components/ui/Icon.test.tsx:12-15`, `:20-24` | ✅ |

### P1 Base UI components

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-87 | variants; loading disabled + aria-busy | `web/components/ui/Button.test.tsx:11`, `:17-22`, `:27`, `:57-58` | ✅ |
| FND-88 | label binding; aria-invalid/describedby | `web/components/ui/form/form.test.tsx:19-31` | ✅ |
| FND-89 | focus in, Tab cycle, Escape + focus restore | `web/components/ui/Modal.test.tsx:39-42`, `:68-75`, `:84-86` | ✅ |
| FND-90 | ArrowRight/Left, roles | `web/components/ui/Tabs.test.tsx:15-25`, `:41-43`, `:50-55` | ✅ |
| FND-91 | champagne-soft / on-champagne / uppercase caption | `web/components/ui/Card.test.tsx:52-57` | ✅ |
| FND-92 | 2px bronze ring + 2px offset | `Button.test.tsx:75-79`; `form.test.tsx:44,83,91,101`; `Tabs.test.tsx:90`; Modal close is a `Button` | ✅ |
| FND-93 | role=status, polite, 6 s unless action | `web/components/ui/Toast.test.tsx:35-47`, `:50-62` | ✅ |
| FND-94 | RoomCard content, placeholder, price "/h" | `web/components/ui/RoomCard.test.tsx:20-25`, `:31-35`, `:40-42`, `:53` | ✅ |

### P1 Public layout and Home page

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-95 | fixed 80px, links, xl location, lg nav, Login/Minha conta | `web/components/layout/Header.test.tsx:44-58`, `:61-73`, `:77-78`, `:83`, `:90`; sensor S9 killed | ✅ |
| FND-96 | menu, aria-expanded=true | `Header.test.tsx:97-109` | ✅ |
| FND-97 | footer columns, address, hours | `web/components/layout/Footer.test.tsx:30-40` | ✅ |
| FND-98 | floating WhatsApp, 24px, target/rel/href, sm label | `web/components/layout/WhatsAppButton.test.tsx:19-21`, `:27-29`, `:36-37`, `:44-45` | ✅ |
| FND-99 | section order + ids | `web/pages/public/home/HomePage.test.tsx:50-68` | ✅ |
| FND-100 | 160/80/80; 97; 198; 120 | `web/pages/public/home/PricingSimulatorSection.test.tsx:69-71`, `:91`, `:109`, `:118` | ✅ |
| FND-101 | no São Paulo/Jardins; sinal not refundable | `HomePage.test.tsx:74`; `HomeStaticSections.test.tsx:47-49` | ✅ |
| FND-102 | titled modal; wa.me text in new tab; closes | `web/pages/public/home/ExtrasSection.test.tsx:45-48`, `:62-75` | ✅ |
| FND-103 | select room + smooth scroll to #simulador | `HomePage.test.tsx:86-89`, `:98-100` | ✅ |
| FND-104 | Google Fonts only | `web/seo/static-seo.test.ts:93-98` | ✅ |
| FND-105 | 404 in public layout | `web/components/layout/PublicLayout.test.tsx:52-59` | ✅ |

### P1 Authentication pages

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-106 | 401 message; mfaRequired; next/default | `web/pages/auth/LoginPage.test.tsx:74`, `:102`, `:124`, `:134`, `:154` | ✅ |
| FND-107 | unsafe next ignored | `LoginPage.test.tsx:144`; `web/features/auth/hooks.test.tsx:47-51` | ✅ |
| FND-108 | invalid doc message, no API call; submit gated; legal links | `web/pages/auth/SignupPage.test.tsx:75-77`, `:85-93` | ✅ |
| FND-109 | 201 → /app banner; 409 field messages | `SignupPage.test.tsx:125-127` (banner rendered by the `/app` route), `:151`, `:164` | ✅ |
| FND-110 | verify once; success / 400 + resend | `web/pages/auth/VerifyEmailPage.test.tsx:64-67`, `:79-84` | ✅ |
| FND-111 | neutral forgot message; reset success + /login | `web/pages/auth/password/password-pages.test.tsx:36-40`, `:73-74` | ✅ |
| FND-112 | QR, code, 10 codes, "Já guardei" → /admin | `web/pages/auth/TwoFactorPages.test.tsx:149-168` | ✅ |
| FND-113 | code or recovery code → /admin; 401 → "Código inválido" | `TwoFactorPages.test.tsx:61`, `:75-80`, `:91`; sensor S4 killed | ✅ |

### P1 App and Admin shells with guards

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-114 | `/login?next=` | `web/router.test.tsx:86`, `:93` | ✅ |
| FND-115 | "Acesso restrito" + /app | `router.test.tsx:100-105` | ✅ |
| FND-116 | /login/2fa or /configurar | `router.test.tsx:112`, `:119` | ✅ |
| FND-117 | admin 10 / reception 2; placeholder | `web/components/layout/AdminShell.test.tsx:96-107`, `:116`, `:130-131`; `core/access.test.ts:37-48` | ✅ |
| FND-118 | tab bar <lg, sidebar ≥lg, 5 items, Sair | `web/components/layout/AppShell.test.tsx:77-92`, `:122-125` | ✅ |

### P1 PWA and static SEO

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-119 | manifest fields + icons | `web/pwa/pwa-config.test.ts:24-55` | ✅ |
| FND-120 | precache + `/api/` NetworkOnly | `pwa-config.test.ts:66-86` | ✅ |
| FND-121 | toast + Atualizar | `web/pwa/PwaUpdatePrompt.test.tsx:39-40`, `:50-51` | ✅ |
| FND-122 | one LocalBusiness block, url = VITE_SITE_URL | `web/seo/static-seo.test.ts:64-85`, `:103-111`; built `apps/web/dist/index.html`: 1 ld+json block | ✅ |
| FND-123 | lang, title, description, OG tags, 1200×630 image | `static-seo.test.ts:39-60` | ✅ |
| FND-124 | robots + sitemap | `static-seo.test.ts:116-138` | ✅ |

### P1 Delivery pipeline and first production deploy

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-125 | `_redirects` first/last rule; strip `/` | `apps/web/scripts/write-redirects.test.mjs:14-26`; built `apps/web/dist/_redirects` = `/api/*  https://example.invalid/:splat  200` then `/*  /index.html  200` | ✅ |
| FND-126 | non-https → message | `write-redirects.test.mjs:30-46` | ✅ |
| FND-127 | slug, source, process.env, optional keys omitted | `api/neon.test.ts:36-68` | ✅ |
| FND-128 | CI: npm ci, typecheck, lint, test (postgres:17), build | `.github/workflows/ci.yml:24`, `:42-46` | ✅ |
| FND-129 | prod health `branch:production`; Home 200 with hero headline; config 200 | `node scripts/smoke.mjs https://bravo-clinic.netlify.app` → 3/3 ok, exit 0 (verifier run). `curl /api/health` = `{"status":"ok","db":"ok","branch":"production"}`. Home: `scripts/smoke.mjs:31-51` + `// SPEC_DEVIATION` `:34`; headline present in the served production bundle (verifier check) | ✅ (accepted SPEC_DEVIATION) |
| FND-130 | no secrets; `.env*` ignored | `.env.example` names only; `.gitignore:3-5` | ✅ |

### P2 Google login

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| FND-131 | 302, state, S256, scopes, 10 min cookie | `api/routes/public/auth/google.int.test.ts:115-138` | ✅ |
| FND-132 | sub / verified e-mail / create; redirect | `google.int.test.ts:146-210` | ✅ |
| FND-133 | 400 INVALID_STATE, no session | `google.int.test.ts:251-265` | ✅ |
| FND-134 | 404 FEATURE_DISABLED; googleEnabled false; no button | `google.int.test.ts:107-108`; `config.int.test.ts:30`; `web/pages/auth/LoginPage.test.tsx:187` | ✅ |

**Status**: ✅ 134/134 ACs evidenced; 0 gaps. FND-129 is accepted with a documented SPEC_DEVIATION, and its spec wording should be amended to "the Home returns 200 with its title and LocalBusiness JSON-LD".

---

## Edge Cases

- [x] Cold start ≥ 10 s (`api/routes/health.int.test.ts:60-75`)
- [x] Concurrent signup with the same e-mail (`signup.int.test.ts:206-215`)
- [x] E-mail case and spaces (`signup.int.test.ts:178-189`)
- [x] Staff demoted mid-session (`auth.int.test.ts:136-145`)
- [x] TOTP "123 456" (`totp.int.test.ts:214-222`)
- [x] localStorage unavailable (`ThemeProvider.test.tsx:57-68`)
- [x] `localToUtc` minute 1440 (`core/time.test.ts:28-30`)
- [x] Bootstrap password policy failure (`seed.int.test.ts:145-152`)
- [x] Trailing `/` on API_PROXY_ORIGIN (`write-redirects.test.mjs:12-26`)

---

## Discrimination Sensor

Expanded tier (auth/security and money/time). Each mutation ran in a scratch `git worktree` (`verify-fundacao-it2-scratch`, detached at `c89ed81`, with its own `npm install`). A script backed up the file, mutated it, ran the targeted Vitest files, and then restored it byte for byte. API mutants ran against `fundacao_verify_it2`. The scratch worktree was removed afterwards.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| S1 (rerun of iteration-1 M1) | `packages/core/src/validation/auth-schemas.ts:10` | password minimum `>= 8` → `>= 7` (FND-17) | ✅ Killed (2 failed) |
| S2 | `packages/core/src/money.ts:30` | fraction `padEnd` → `padStart` ("97,5" → 9705) (FND-09) | ✅ Killed (1 failed) |
| S3 | `packages/core/src/time.ts:127` | ISO weekday off by one (FND-11) | ✅ Killed (5 failed) |
| S4 | `packages/core/src/validation/auth-schemas.ts:44` | recovery code no longer upper-cased (FND-113) | ✅ Killed (web page test) |
| S5 | `apps/api/src/modules/auth/auth-tokens.ts:10` | verify token TTL 24 h → 48 h (FND-49) | ✅ Killed (1 failed) |
| S6 | `apps/api/src/modules/auth/password-reset.service.ts:73` | reset no longer revokes sessions (FND-61) | ✅ Killed (1 failed) |
| S7 | `apps/api/src/modules/auth/email-verification.service.ts:15` | resend limit 3 → 4 (FND-50) | ✅ Killed (1 failed) |
| S8 | `apps/api/src/lib/email.ts:8` | e-mail timeout 10 000 → 20 000 ms (FND-80) | ✅ Killed (1 failed) |
| S9 | `apps/web/src/components/layout/Header.tsx:35` | location `hidden xl:flex` → `hidden lg:flex` (FND-95) | ✅ Killed (1 failed) |
| S10 | `apps/api/src/auth/session.ts:11` | staff session 12 h → 30 days (FND-58) | ✅ Killed (2 failed) |

**Sensor depth**: P0-expanded (10 manual mutations)
**Result**: 10/10 killed - PASS ✅
**Isolation**: the real worktree's `git status --porcelain` was empty before the sensor and again after the scratch worktree was removed. The only later change is this report.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / surgical changes / no scope creep | ✅ The fix commits change tests and `scripts/smoke.mjs` only; no production code changed |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ Exact values asserted (7-char reject, `10_000`, `date`, breakpoint classes, `ABCD-EFGH`); FND-129 documented deviation |
| Per-layer Coverage Expectation met | ✅ |
| Every test maps to a spec requirement | ✅ New tests carry FND tags |
| Documented guidelines followed: tasks.md Test Coverage Matrix | ✅ |
| Test robustness | ✅ The FND-31 count is journal-derived and passes with nucleo migrations present |

---

## Gate Check

- **Gate command**: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`, plus `node scripts/smoke.mjs https://bravo-clinic.netlify.app`
- **typecheck**: exit 0 · **lint**: exit 0 · **build**: exit 0 · **smoke**: exit 0 (3/3 ok)
- **test**:

  | Workspace | Result |
  | --------- | ------ |
  | core | 1191/1191 passed (32 files) |
  | api | 317/317 passed (35 files, fresh `fundacao_verify_it2`) |
  | web | 534/535 passed |

  `npm test` exited **1** because of the single web failure, `apps/web/src/pages/app/AgendaPage.test.tsx:32` (NUC-190, a nucleo test outside fundacao's diff surface). Its `findByRole(/17:30 Sala Principal/)` times out at the default 1 s while the page still shows "Carregando agenda". The failure reproduced on a second full web run, and the file passes 3/3 when run alone, so it fails only under full-suite load. **Route to nucleo.** All fundacao tests pass.
- **Fundacao test delta vs iteration 1**: +6 (core +2, api +2, web +2). No test was deleted or weakened; the FND-31 assertion was generalised from `toBe('2')` to the journal check
- **Skipped tests**: none

---

## Fix Plans

No fundacao fixes required. Two follow-ups are recommended outside the fundacao code:

1. **Spec wording, FND-129 (Minor)**: amend `spec.md` FND-129 from "with the hero headline" to "with its `<title>` and LocalBusiness JSON-LD", matching `scripts/smoke.mjs:31-51`, then drop the `SPEC_DEVIATION` marker.
2. **Nucleo flaky test, NUC-190 (Major for the repo gate, out of fundacao scope)**: in `apps/web/src/pages/app/AgendaPage.test.tsx:32`, wait for the loading status to disappear, or give the first `findByRole` a timeout that tolerates full-suite load. Done when `npm test -w apps/web` passes on a full run.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| FND-17 | ❌ Needs Fix (test) | ✅ Verified |
| FND-31, FND-36, FND-80, FND-95, FND-113 | ⚠️ partial / brittle | ✅ Verified |
| FND-129 | ⚠️ spec-precision gap | ✅ Verified (documented SPEC_DEVIATION; spec wording to amend) |
| All other FND-01..FND-134 | ✅ Verified | ✅ Verified |

`spec.md` traceability statuses were not edited here: this run commits only `validation.md`.

---

## Summary

**Overall**: ✅ Ready (fundacao). Pending user/ops checks: admin TOTP login on production (T78), local dev check (T38), production request-log line (T77).

**Spec-anchored check**: 134/134 ACs matched; 0 spec-precision gaps open (FND-129 deviation documented)
**Sensor**: 10/10 mutations killed, including the iteration-1 survivor
**Gate**:

- typecheck, lint, build and smoke exit 0
- core 1191/1191 and api 317/317 pass
- web 534/535: the one failure is the out-of-scope nucleo NUC-190 flake, routed to nucleo

**Next steps**:

- Amend the FND-129 wording in the spec.
- Fix the NUC-190 test flake in nucleo.
- The user runs the three manual checks.
