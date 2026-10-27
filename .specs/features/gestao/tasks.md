# Gestão Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/gestao/design.md`
**Spec**: `.specs/features/gestao/spec.md`
**Blueprint**: `docs/architecture.md`
**Status**: Draft

Worker rules specific to this feature:

- Preconditions: `fundacao`, `nucleo` and `receita` are merged on `main`. Before Phase 1, grep each R-item of design §Required from nucleo/receita under the name and producer task it cites; if one is missing or renamed, STOP and report it (do not re-implement the producer's part).
- Before installing any package run `npm view <pkg>@<line> version` and pin the newest patch of the line in `docs/architecture.md` §1 / design §Integration Points.
- Never print secret values. `.env` holds `DATABASE_URL_TEST` (Neon `dev`); read it only through config loaders.
- Phase 12 tasks T49 and T50 deploy to production: they run only after the user gives an explicit go-ahead in chat for that phase (skill blast-radius rule).

---

## Test Coverage Matrix

> Generated from project guidelines and spec - confirm before Execute. Guidelines found: `.specs/STATE.md` AD-010 (Vitest everywhere; core unit; API integration against Neon `dev`), AD-018 (postgres:17 in CI, serial API test files), AD-029 (Playwright e2e, axe, Lighthouse CI), `.specs/features/fundacao/tasks.md` matrix (same layers and commands). Strong defaults applied on top.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `packages/core` (finance engine, catalogs, schemas, URL helpers) | unit | All branches; 1:1 to spec ACs; every design worked example asserted to the cent | `packages/core/src/**/*.test.ts` | `npm test -w packages/core` |
| `apps/api` pure libs (storage validation, ics serializer, push sender, templates, xlsx renderer) | unit | All branches; 1:1 to the ACs they implement; fakes for S3 and web-push | `apps/api/src/**/*.test.ts` | `npm test -w apps/api` |
| `apps/api` routes, services, jobs, MCP server | integration (`app.request()` + real Postgres) | Every route: happy path + each listed edge case + each documented error code/status and role (tenant, reception, admin); persisted rows and audit rows asserted | `apps/api/src/**/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` migration constraints | integration | Each new constraint/index: accepted + rejected case with SQLSTATE | `apps/api/src/db/*.int.test.ts` | `npm test -w apps/api` |
| `apps/web` components, hooks, pages with logic | unit (Testing Library + jsdom, mocked `fetch`) | Every AC of the screen: rendered text/roles, interactions, loading/empty/error states | `apps/web/src/**/*.test.tsx` | `npm test -w apps/web` |
| `apps/web` config (redirect generator, SW push handler, analytics loader) | unit | Every rule/branch named by the AC | `apps/web/src/**/*.test.ts`, `apps/web/scripts/*.test.mjs` | `npm test -w apps/web` |
| End-to-end journeys and accessibility | e2e (Playwright, Chromium mobile + desktop) | Full journey steps of GES-140/141; axe zero WCAG 2.1 A/AA violations on the GES-142 pages | `apps/web/e2e/*.spec.ts` | `npm run e2e -w apps/web` |
| Performance budgets | e2e (Lighthouse CI) | GES-143 assertions | `apps/web/lighthouserc.cjs` | `npm run lhci -w apps/web` |
| Deploy config (`neon.ts`) | unit | Buckets and triggers asserted by value | `neon.test.ts` | `npm test -w apps/api` |
| Operational steps (migrate, deploy) | none | - (verified by the smoke check of T50) | - | build gate only |
| Production release | e2e smoke | GES-144 checks | `scripts/smoke.mjs` | `node scripts/smoke.mjs <siteUrl>` |

## Gate Check Commands

> Same commands as fundacao plus the e2e/quality gates introduced by nucleo (Playwright) and this feature (Lighthouse CI) - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test -w <workspace touched>` (`npm test -w packages/core`, `npm test -w apps/api` or `npm test -w apps/web`) |
| Full | After tasks with integration tests | `npm run typecheck && npm test -w apps/api` |
| E2E | After tasks with Playwright specs | `npm run typecheck && npm run e2e -w apps/web` |
| Quality | After the Lighthouse task | `npm run lhci -w apps/web` |
| Build | After phase completion, config tasks and operational steps | `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build` |

---

## Parallel lanes

Two lanes run at the same time in separate git worktrees, each executing its phases in order; integration and hardening run after both lanes merge.

| Lane | Worktree branch | Phases | Tasks | Scope |
| --- | --- | --- | --- | --- |
| A (backend) | `gestao/api` | 1 → 2 → 3 → 4 → 5 → 6 | T1–T27 (27) | `packages/core`, `apps/api` |
| B (frontend) | `gestao/web` | 7 → 8 → 9 → 10 | T28–T42 (15) | `apps/web` |
| Integration | `main` after A and B merge | 11 → 12 | T43–T50 (8) | cross-cutting, e2e, release |

Cross-lane dependencies:

| From | To | Why | How |
| --- | --- | --- | --- |
| T1 (lane A, core schemas, `toPhotoUrl`, settings key) | T28 and every lane B task | Web forms use the shared zod schemas (AD-024) | Lane B starts after T1 is merged to `main` (rebase `gestao/web` on it); T1 is the only lane A task lane B waits for |
| T2 (lane A, core finance types) | T29 | Page types reuse `Totals`/`FinanceSummary` | Lane B may declare the types locally per design §Data Models and switch to the core import at T43-time rebase |
| Lane A HTTP contracts (design §Components routes) | Lane B pages | Pages call those routes | Lane B tests mock `fetch` with the documented payloads; no runtime dependency until Phase 11 |
| Lanes A + B merged | Phase 11 | Bridge, sweep and e2e need both | Merge `gestao/api` first, then rebase and merge `gestao/web`; run the Build gate on `main` before T43 |
| T36 (`/media/*` redirect) + T22 (photo URLs) | T48 | Lighthouse measures real room photos | Phase 12 runs after Phase 11 on `main` |

---

## Execution Plan

Phases are ordered; within a lane they run sequentially and tasks within a phase run in order. Lane A (Phases 1–6) and lane B (Phases 7–10) run in parallel worktrees; Phases 11–12 run after both merge. `[P]` marks a task with no dependency inside its phase.

### Phase 1: Core contracts and data layer (lane A)

```
T1 → T3
T2 [P]
```

### Phase 2: Platform services (lane A)

```
T5 → T6
T4 [P]
T7 [P]
T8 [P]
T9 [P]
```

### Phase 3: Integrações API (lane A)

```
T13 → T14
T10 [P]
T11 [P]
T12 [P]
```

### Phase 4: Financeiro API (lane A)

```
T15 → T16
T15 → T18
T17 → T18
T18 → T19
```

### Phase 5: Admin operations API (lane A)

```
T20 → T21
T22 [P]
T23 [P]
T24 [P]
```

### Phase 6: Compliance and operations API (lane A)

```
T25 [P]
T26 [P]
T27 [P]
```

### Phase 7: Admin UI primitives and Financeiro (lane B)

```
T28 → T29
T28 → T30
```

### Phase 8: Admin Integrações UI (lane B)

```
T31 [P]
T32 [P]
T33 [P]
```

### Phase 9: Admin operations UI (lane B)

```
T34 [P]
T35 [P]
T36 [P]
T37 [P]
```

### Phase 10: Public and tenant UI (lane B)

```
T38 [P]
T39 [P]
T40 [P]
T41 [P]
T42 [P]
```

### Phase 11: Integration (after lanes merge)

```
T45 → T46
T43 [P]
T44 [P]
```

### Phase 12: Hardening and production release (explicit go-ahead for T49–T50)

```
T47 → T49
T48 → T49
T49 → T50
```

---

## Task Breakdown

### Phase 1: Core contracts and data layer (lane A)

#### T1: Add gestao core contracts

**What**: Notification catalog (design §Notification catalog), all gestao zod input schemas with pt-BR messages (design §Core: gestao contracts), `toPhotoUrl`, and settings key `usage.limits` with defaults.
**Where**: `packages/core/src/validation/gestao-schemas.ts` (+ `packages/core/src/notifications/`, `packages/core/src/media/`)
**Depends on**: None
**Reuses**: `phoneSchema`, `emailSchema`, `settingsCatalog`, `time.ts`
**Requirement**: GES-25, GES-85, GES-108, GES-137

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `financeQuerySchema` rejects `to < from` and a 732-day range, accepts 731 days
- [x] Tests assert `extraServiceInputSchema` rejects `saleMode: 'online'` with null price on path `referencePriceCents`
- [x] Tests assert `quoteRequestInputSchema` bounds (name 2..120, description 10..2000, desiredOn ≤ today + 365 with injected today) and that `website` is accepted as an optional string
- [x] Tests assert `toPhotoUrl('rooms/r1/u1', 'small') === '/media/rooms/r1/u1-small.webp'`
- [x] Tests assert every staff toggle key of `notifications.events` maps to one `staff.*` catalog entry and `settingDefaults()['usage.limits'].emailsPerMonth === 3000`
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 14 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add gestao schemas, notification catalog and media url helper`

---

#### T2: Implement finance engine [P]

**What**: `recognize`, `spreadOverDays`, `splitExtras`, `chargeCategory`, `buckets`, `summarize`, `previousRange`, `compare`, `buildDre`, `nextOccurrences` per design §Core: finance engine.
**Where**: `packages/core/src/finance/` (`recognition.ts`, `report.ts`)
**Depends on**: None
**Reuses**: `money.ts` (`mulDivRoundHalfUp`), `time.ts`
**Requirement**: GES-01, GES-02, GES-03, GES-04, GES-05, GES-06, GES-07, GES-08, GES-09, GES-10, GES-22, GES-23, GES-24, GES-30, GES-31, GES-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every row of design §Core: finance engine worked examples is a test asserting exact cents per month in both regimes
- [x] Tests assert `spreadOverDays(616000, '2026-11-02', '2026-12-02')` has 30 entries, the first 10 equal 20534, the rest 20533, sum 616000
- [x] Tests assert chargeback and refund go to line 3 with the original category; credit charges add to gross and line 2
- [x] Tests assert ISO-week buckets start on Monday and edge buckets are clipped; quarters start Jan/Apr/Jul/Oct
- [x] Tests assert `compare` returns `deltaPercent: null` when previous is 0 and rounds to one decimal
- [x] Tests assert `buildDre` row order/labels of GES-31, "Outras receitas" only when non-zero, line 5 = 1+2+3+4 and line 7 = 5+6 per column
- [x] Tests assert `nextOccurrences` clamps Jan 31 monthly to Feb 28/29 and returns nothing when recurrence is `none`
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 30 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add cash and accrual revenue recognition and DRE matrix`

---

#### T3: Add gestao schema, migration and seeds

**What**: Drizzle tables of §5.5 with design refinements, generated migration `<n>_gestao` plus custom constraints (partial unique indexes, checks, `charges(approved_at)` partial index), seeds (expense categories, extra services, `usage.limits`).
**Where**: `apps/api/src/db/schema/gestao.ts` (+ `apps/api/drizzle/`, `apps/api/src/db/seed.ts`)
**Depends on**: T1
**Reuses**: fundacao migration/seed patterns, `test/` harness
**Requirement**: GES-14, GES-42, GES-105

**Tools**:

- MCP: `Neon` (read-only: `describe_table_schema` on `dev` after migrating)
- Skill: `neon-postgres`

**Done when**:

- [x] Integration test asserts all §5.5 tables exist after `runMigrations`
- [x] Tests assert a second active clinic feed insert fails with 23505 and succeeds after revoking the first
- [x] Tests assert duplicate `(recurrence_parent_id, date)` child fails with 23505; scope/user/room checks reject mismatches (23514)
- [x] Tests assert seeding twice yields 14 expense categories in PRD order, 3 extra services in `quote` mode, and keeps an edited row unchanged
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add gestao tables, constraints and seeds`

---

### Phase 2: Platform services (lane A)

#### T4: Implement object storage library [P]

**What**: `Storage` interface, `createS3Storage`, `memoryStorage`, `readBinaryBody` with size and magic-byte checks, `requireJson` exemption for the binary routes, error codes `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` (415 already exists), `STORAGE_UNAVAILABLE`.
**Where**: `apps/api/src/lib/storage.ts`
**Depends on**: None
**Reuses**: `AppError`, `AppDeps` injection
**Requirement**: GES-17, GES-106

**Tools**:

- MCP: NONE
- Skill: `neon-object-storage`

**Done when**:

- [x] Tests assert PDF/JPEG/PNG/WebP magic bytes accepted, a `.exe` labelled `application/pdf` rejected with 415, 5 MiB + 1 byte rejected with 413
- [x] Tests assert `createS3Storage` builds the client with `forcePathStyle: true` and presign uses the requested expiry (S3 client mocked)
- [x] Tests assert `memoryStorage` put/head/delete/totalBytes behave like the interface
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add object storage client and binary upload validation`

---

#### T5: Implement notifications service and push sender

**What**: `emit`, `afterCommit`, `sendPush` (web-push, VAPID from env, pruning) per design §Notifications service; staff fan-out with toggles and dedupe keys.
**Where**: `apps/api/src/modules/notifications/notifications.service.ts` (+ `apps/api/src/lib/push.ts`)
**Depends on**: None
**Reuses**: `queueEmail`, `dispatchEmails`, notification catalog (T1), `parseSetting`
**Requirement**: GES-67, GES-68, GES-78, GES-79, GES-80, GES-81

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test asserts a staff event with toggle on queues one row per active recipient with dedupe key `staff:<event>:<entityId>:<recipientId>`; a repeat emit queues none
- [x] Test asserts toggle off queues nothing; rolled-back transaction leaves no rows and sends no push
- [x] Test asserts tenant event sends one push per subscription (web-push stubbed) with payload ≤ 3 KB containing title/body/url/tag
- [x] Tests assert 410 deletes the subscription, 500 increments `failure_count`, the 5th failure deletes it, success resets it and sets `last_success_at`
- [x] Test asserts no VAPID env → no push call and `emit` still resolves
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 9 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add notification emit with staff fan-out and web push`

---

#### T6: Add push subscription routes and VAPID public key

**What**: `POST/DELETE /app/push/subscriptions` and `vapidPublicKey` in `GET /public/config`.
**Where**: `apps/api/src/routes/app/push.ts`
**Depends on**: T5
**Reuses**: `pushSubscriptionSchema` (T1), `requireAuth`
**Requirement**: GES-75, GES-76, GES-77

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert 201 upsert, reassignment of an endpoint from user A to user B, 204 delete, 422 for `http://` endpoint or non-base64url keys, 401 without session
- [x] Tests assert `vapidPublicKey` is `null` without env and equals the env value when set
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add web push subscription endpoints`

---

#### T7: Add gestao e-mail templates [P]

**What**: pt-BR templates `staff.*` (7 toggled events + `payment_issue` + holiday review + invite), `quote.received`, `privacy.account_deleted`, `subscription.card_reregister`, `system.test`, on fundacao's layout.
**Where**: `apps/api/src/emails/templates/gestao.ts`
**Depends on**: None
**Reuses**: `emails/templates/layout.ts` (fundacao)
**Requirement**: GES-73

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests iterate every gestao-owned catalog template and assert non-empty subject/html/text, absolute links on `APP_BASE_URL`, and no emoji (regex `\p{Extended_Pictographic}`)
- [x] Tests assert `staff.new_booking` contains customer first name, room, local date/time and booking code; `staff.invite` contains the set-password link
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add gestao notification e-mail templates`

---

#### T8: Harden the RFC 5545 serializer [P]

**What**: `icsEvent`, `icsCalendar` with CRLF, 75-octet UTF-8-safe folding, TEXT escaping, UTC times, METHOD (`PUBLISH`/`REQUEST`/`CANCEL`), STATUS; re-implement nucleo's `buildIcs({ method, events[], organizerEmail? })` on top of them with the same signature so nucleo and receita call sites keep working.
**Where**: `apps/api/src/lib/ics.ts`
**Depends on**: None
**Reuses**: nucleo `lib/ics.ts` (R4)
**Requirement**: GES-47, GES-48

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert every line ends with CRLF and no unfolded line exceeds 75 octets, including a summary with "ô" crossing the boundary
- [x] Tests assert `,`, `;`, `\` and newline are escaped; `DTSTART:20261027T130000Z` for 10:00 local on 2026-10-27
- [x] Tests assert `METHOD:CANCEL` output carries `STATUS:CANCELLED` and the same UID with the given SEQUENCE
- [x] Existing nucleo ics tests still pass unchanged
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 7 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(api): harden RFC 5545 serializer for feeds`

---

#### T9: Add e-mail retry and retention jobs [P]

**What**: Jobs `email-retry` (every 5 min) and `retention` (weekly) registered in the jobs registry.
**Where**: `apps/api/src/jobs/maintenance.ts`
**Depends on**: None
**Reuses**: `dispatchEmails`, `registerJob`/`runJob` (R9)
**Requirement**: GES-72, GES-129

**Tools**:

- MCP: NONE
- Skill: `neon-functions`

**Done when**:

- [x] Tests assert retry picks `failed` with attempts < 5 within 48 h and `pending` older than 5 min, skips attempts = 5 and fresh pending rows
- [x] Tests assert retention deletes only rows past each threshold (sessions/tokens 30 days, buckets 2 days, expired idempotency keys), blanks bodies of 181-day-old outbox rows and keeps 179-day ones; `job_runs.stats` has the counts
- [x] Tests assert both job routes reject requests without a valid trigger delivery
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add e-mail retry and data retention jobs`

---

### Phase 3: Integrações API (lane A)

#### T10: Implement calendar feeds and per-booking .ics [P]

**What**: Feed token issue/revoke/list (clinic, room, user), public `GET /ics/:token.ics` with windows, statuses and rate limit; switch nucleo's existing `GET /app/bookings/:id/ics` (nucleo T21) to `METHOD:PUBLISH` / `METHOD:CANCEL` (GES-50).
**Where**: `apps/api/src/modules/ics/ics-feed.service.ts` (+ `apps/api/src/routes/ics.ts`)
**Depends on**: T8
**Reuses**: `randomToken`, `sha256Hex`, `consumeRateLimit`, `audit`
**Requirement**: GES-42, GES-43, GES-44, GES-45, GES-46, GES-48, GES-49, GES-50, GES-51, GES-52

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert issue returns the URL once, DB holds hash + prefix only, regenerate revokes the previous one, audit rows written
- [x] Tests assert clinic feed includes each listed status and active blocks, excludes cancelled/expired bookings, cleanup and amounts; room scope filters; window edges (today − 90 / + 180) included/excluded
- [x] Tests assert personal feed contains only the owner's allowed statuses and summary "Bravô Clinic · <sala>"
- [x] Test asserts after a reschedule (nucleo service) the feed has the same UID, new DTSTART and SEQUENCE + 1; after cancel the event is gone
- [x] Tests assert per-booking `.ics` PUBLISH/CANCEL, 404 for another user's booking, 404 for unknown/revoked token, 429 on the 61st request in an hour
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add clinic, room and personal ICS feeds`

---

#### T11: Implement gateway configuration [P]

**What**: Gateway listing, credentials save (encrypted, hint), test connection (10 s timeout), activation with preconditions, card re-register e-mails, `productionWarning`; built on nucleo's `listGatewayAdapters`, `resolveGateway` and `PaymentGateway.verifyCredentials` (R5, nucleo T15/T16).
**Where**: `apps/api/src/modules/integrations/gateway-config.service.ts` (+ `apps/api/src/routes/admin/integrations-gateway.ts`)
**Depends on**: None
**Reuses**: gateway registry (R5), `encryptSecret`, `emit` (T5), `audit`
**Requirement**: GES-35, GES-36, GES-37, GES-38, GES-39, GES-40, GES-41

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert listing never contains a secret value and shows `webhookUrl` per provider
- [x] Tests assert saved secrets decrypt to the input, hint is `••••` + last 4, empty field keeps the stored secret, audit `after` has no secret
- [x] Tests assert test connection `{ ok: true }` for sandbox, `{ ok: false }` for a 401 and for a timeout from stubbed Mercado Pago `fetch`
- [x] Tests assert activation of an unconfigured provider → 422; valid activation updates `payment.active_gateway`, leaves existing charges' provider, queues one re-register e-mail per affected subscription (none on repeat)
- [x] Tests assert reception → 403 on every route
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add payment gateway configuration endpoints`

---

#### T12: Implement notification admin endpoints [P]

**What**: Recipients CRUD, event toggles, test e-mail (rate limited), outbox listing, provider status.
**Where**: `apps/api/src/routes/admin/integrations-notifications.ts`
**Depends on**: None
**Reuses**: `queueEmail`, `dispatchEmails`, `system.test` template (T7), `consumeRateLimit`
**Requirement**: GES-65, GES-66, GES-70, GES-71, GES-74

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert add/duplicate (409)/11th recipient (422)/toggle/remove, all audited
- [x] Tests assert unknown event key → 422 and stored toggles round-trip
- [x] Tests assert test e-mail returns per-recipient status with Resend stubbed, `not_sent` without key, 429 on the 6th call in an hour
- [x] Tests assert outbox list filters by status, excludes `html`, covers 30 days only
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 9 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add notification recipients, toggles and outbox endpoints`

---

#### T13: Implement MCP tokens and transport

**What**: Token service and admin routes, `/mcp` mount with enabled check, bearer auth, per-token rate limit, `last_used_at`, stateless streamable HTTP server with the `defineTool` wrapper (scope, confirm, audit, error mapping) and an empty registry hook.
**Where**: `apps/api/src/mcp/server.ts` (+ `apps/api/src/modules/mcp/`, `apps/api/src/routes/mcp.ts`)
**Depends on**: None
**Reuses**: `randomToken`, `sha256Hex`, `consumeRateLimit`, `audit`, `@modelcontextprotocol/sdk`, `@hono/mcp`
**Requirement**: GES-53, GES-54, GES-55, GES-56, GES-60, GES-61, GES-63, GES-64, GES-120

**Tools**:

- MCP: NONE
- Skill: `neon-functions`

**Done when**:

- [x] Tests assert token format `^bmcp_[A-Za-z0-9_-]{43}$`, only hash stored, list without raw token, revoke audited
- [x] Tests assert `/mcp` 404 when disabled; 401 for missing, unknown, revoked, expired token and for an owner demoted to reception
- [x] Test asserts the request over `mcp.rate_limit_per_minute` gets 429 with `Retry-After`
- [x] Test with a dummy tool through the SDK client asserts one `audit_log` row origin `mcp`, action `mcp.<tool>`
- [x] Tests assert `GET /admin/integrations/mcp` server URL uses `API_FUNCTION_URL` and sets the warning when unset; reception → 403 on token creation
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add MCP server transport with scoped revocable tokens`

---

#### T14: Register MCP tool catalog

**What**: Registry plus every nucleo/receita tool of design §MCP tool catalog bound to the service named in its Service column, with previews for destructive tools, and a catalog test that compares `tools/list` with the design table. Gestao-backed tools are registered by the tasks that build their services (T15, T17, T18, T19, T21, T22, T23, T24) through `defineTool`; each of those tasks adds its tools to the catalog test.
**Where**: `apps/api/src/mcp/tools/index.ts`
**Depends on**: T13
**Reuses**: services of R10, core schemas
**Requirement**: GES-57, GES-58, GES-59, GES-61, GES-62

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test asserts `tools/list` with a read token returns exactly the read tools registered so far, and with read_write all of them
- [x] Tests assert a read token calling `booking_create` gets tool error `FORBIDDEN` with no booking row
- [x] Tests assert `booking_cancel` without `confirm` returns `CONFIRMATION_REQUIRED` + preview and leaves status unchanged; with `confirm: true` cancels and writes the service audit with origin `mcp`
- [x] Tests assert invalid args return `VALIDATION_FAILED` with pt-BR messages; `agenda_list` and `pre_reservation_create` happy paths
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): expose admin operations as MCP tools`

---

### Phase 4: Financeiro API (lane A)

#### T15: Implement expenses, categories and attachments

**What**: Expense category CRUD, expense CRUD with soft delete, attachment upload/replace/download/delete in `expense-attachments`; MCP tools `expenses_list`, `expense_create`, `expense_delete`.
**Where**: `apps/api/src/modules/finance/expenses.service.ts` (+ `apps/api/src/routes/admin/finance-expenses.ts`)
**Depends on**: None
**Reuses**: `readBinaryBody`, `Storage` (T4), schemas (T1), `defineTool` (T13)
**Requirement**: GES-11, GES-12, GES-13, GES-16, GES-17, GES-18, GES-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert create 201 + audit, inactive category 422 on `categoryId`, edit/delete audited with before/after, deleted rows excluded from list
- [x] Tests assert attachment upload stores object + name + content type, replace deletes the old object after commit, 413/415 paths, GET responds 302 to a URL with 300 s expiry
- [x] Tests assert category duplicate name (case-insensitive) → 409, deactivate keeps old expenses listed
- [x] Tests assert tenant/reception → 403
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 12 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add expenses with categories and attachments`

---

#### T16: Add recurring expenses job

**What**: Daily `recurring-expenses` job materializing children with `nextOccurrences`.
**Where**: `apps/api/src/jobs/recurring-expenses.ts`
**Depends on**: T15
**Reuses**: `nextOccurrences` (T2), `registerJob` (R9)
**Requirement**: GES-14, GES-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests (injected `now`) assert monthly parent 2026-01-31 creates 2026-02-28 and 2026-03-31 children by 2026-03-31, quarterly and yearly cadence, no future-dated child
- [x] Tests assert a re-run creates no duplicates and a parent switched to `none` stops generating while old children remain
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add recurring expense materialization job`

---

#### T17: Implement manual receipts

**What**: Manual receipt create/list/delete with justification; MCP tool `manual_receipt_create`.
**Where**: `apps/api/src/modules/finance/receipts.service.ts`
**Depends on**: None
**Reuses**: schemas (T1), `audit`, `defineTool`
**Requirement**: GES-20, GES-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert create 201 + audit, invalid method/amount 422, delete without justification 422, with justification soft-deleted + audit containing it
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add manual receipts`

---

#### T18: Implement finance summary endpoint

**What**: `loadFacts` and `GET /admin/finance/summary`; MCP tool `finance_summary`.
**Where**: `apps/api/src/modules/finance/finance-report.service.ts`
**Depends on**: T15, T17
**Reuses**: core finance (T2), nucleo/receita tables (R1–R3)
**Requirement**: GES-22, GES-24, GES-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Integration test seeds a booking with deposit + balance across months, a refund, a fixed-schedule period, extra hours, a manual receipt, expenses, and asserts Caixa and Competência buckets equal the design worked examples
- [ ] Tests assert previous-range totals and deltas, empty range zeros with `null` percents, 422 for > 731 days, 403 for reception
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add finance summary by regime and period`

---

#### T19: Implement DRE xlsx export

**What**: `renderDreXlsx` with exceljs and `GET /admin/finance/dre.xlsx`; MCP tool `finance_dre` (matrix JSON).
**Where**: `apps/api/src/modules/finance/dre-xlsx.ts`
**Depends on**: T18
**Reuses**: `buildDre` (T2), `loadFacts` (T18)
**Requirement**: GES-29, GES-30, GES-31, GES-32, GES-33, GES-34

**Tools**:

- MCP: NONE
- Skill: `xlsx`

**Done when**:

- [ ] Test downloads the file, checks content type and file name, parses it with exceljs and asserts month column labels (`nov/2026`), the 7 line labels in order, numeric cells, negative deductions, BRL format
- [ ] Test asserts the `Total` column equals `summary.totals` for the same query in both regimes
- [ ] Test asserts header rows (regime, period, timestamp) and a mid-month `from` producing a partial first month
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add DRE spreadsheet export`

---

### Phase 5: Admin operations API (lane A)

#### T20: Implement extra services and checkout add-on

**What**: Extra service admin CRUD, public catalog, and the nucleo `CheckoutStep` `extras` (order 300, R6) registered in `apps/api/src/extensions/index.ts`: `apply` prices `request.addons.extras` into `draft.extras` + `draft.extensions.extras`, `persist` writes `booking_extra_items`.
**Where**: `apps/api/src/modules/extras/extra-services.service.ts` (+ `apps/api/src/modules/extras/extras-step.ts`, `apps/api/src/extensions/index.ts`)
**Depends on**: None
**Reuses**: schemas (T1), nucleo `CheckoutStep` registry (R6)
**Requirement**: GES-84, GES-85, GES-86, GES-88, GES-89

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert CRUD with audit, online-without-price 422, public list returns active only in display order
- [ ] Test runs nucleo checkout with `addons.extras` for a 2 h booking and an hourly online service (8000/h × 2) and asserts total + 16000, deposit split on the new total, two frozen `booking_extra_items` fields
- [ ] Tests assert inactive/quote-mode service and quantity 3 for a 2 h booking → 422; project quantity ≠ 1 → 422
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 8 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add extra services catalog and checkout add-on`

---

#### T21: Implement quote requests funnel

**What**: Public create (rate limit, honeypot, booking ownership), tenant list, admin list/update with guarded transitions, `new_quote_request` emit and `quote.received`; MCP tools `quotes_list`, `quote_update_status`.
**Where**: `apps/api/src/modules/extras/quote-requests.service.ts`
**Depends on**: T20
**Reuses**: `emit` (T5), `consumeRateLimit`, `defineTool`
**Requirement**: GES-90, GES-91, GES-92, GES-93, GES-94, GES-95, GES-96, GES-97

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert anonymous 201, session-linked 201 with `user_id`, foreign booking 422, 6th request/hour/IP 429, honeypot 202 with zero rows
- [ ] Tests assert staff e-mails queued per recipient and `quote.received` only when e-mail given
- [ ] Tests assert each valid transition, `won → contacted` 409, concurrent double move → one 200 and one 409, notes saved + audited
- [ ] Tests assert tenant list returns only own requests
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add quote request funnel`

---

#### T22: Implement rooms admin and photos [P]

**What**: Room CRUD with inactivation guard, photo variant uploads to `room-photos` (WebP only, immutable cache), registration by upload id, alt/cover/order/delete, max 12; `rooms_list` tool; photo URLs through a `RoomMediaPort` (`toPhotoUrl(key, 'large')`) registered in `apps/api/src/extensions/index.ts` (R13).
**Where**: `apps/api/src/modules/rooms/rooms-admin.service.ts` (+ `apps/api/src/routes/admin/rooms.ts`)
**Depends on**: None
**Reuses**: `Storage`, `readBinaryBody` (T4), `toPhotoUrl` (T1), R13
**Requirement**: GES-103, GES-104, GES-105, GES-106, GES-107, GES-108

**Tools**:

- MCP: NONE
- Skill: `neon-object-storage`

**Done when**:
- [ ] Tests assert room create/edit validation and audit, slug uniqueness 409
- [ ] Tests assert inactivation with a future confirmed booking and with an active fixed-schedule subscription → 409 with codes/ids; without them → 200
- [ ] Tests assert variant upload stores `Cache-Control: public, max-age=31536000, immutable`, non-WebP 415, 13th photo 422, registration with a missing variant 422
- [ ] Tests assert single cover after switching, reorder, delete removes both objects after commit, public rooms endpoint returns `/media/...-large.webp` URLs
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add room administration with photo uploads`

---

#### T23: Implement Clientes service [P]

**What**: Customer search, detail aggregate (R12), bookings pagination, notes (admin + reception), profile edit (admin), MCP tools `customers_search`, `customer_get`, `customer_notes_update`.
**Where**: `apps/api/src/modules/customers/customers.service.ts`
**Depends on**: None
**Reuses**: receita `getCustomerSubscriptions`, `getCustomerBalances`, `listCouponUsesByUser` (R12, receita T26), nucleo `searchCustomers`, `labels.ts`
**Requirement**: GES-99, GES-100, GES-101, GES-102

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tests assert search by name, e-mail, document digits and phone digits, excludes staff and deleted users, cursor pagination
- [ ] Test asserts detail sections (bookings, subscriptions with balance, lots, credits, coupon uses, consents, quotes) from factory data
- [ ] Tests assert reception can read and save notes (audited) but gets 403 on profile edit; admin edit audited
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 8 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add customer profiles for staff`

---

#### T24: Implement staff users and audit log query [P]

**What**: Staff list/invite/promote/role change/disable/enable with session revocation, self and last-admin guards, 2FA reset; `GET /admin/audit` with filters and cursor; MCP tool `audit_list`.
**Where**: `apps/api/src/modules/users/staff-users.service.ts` (+ `apps/api/src/routes/admin/audit.ts`)
**Depends on**: None
**Reuses**: password-reset token flow (fundacao), `revokeAllSessions`, `staff.invite` (T7)
**Requirement**: GES-110, GES-111, GES-112, GES-113, GES-114, GES-115

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tests assert invite creates passwordless user + 72 h token + e-mail; tenant promotion changes role; staff e-mail 409
- [ ] Tests assert role change/disable revoke target sessions (next request 401), self-target 422, last active admin 409 `LAST_ADMIN`
- [ ] Test asserts 2FA reset deletes `user_totp`, revokes sessions, requires justification
- [ ] Tests assert audit filters (actor, origin `mcp`, action prefix, date range), newest first, page size ≤ 100, reception 403
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add staff user management and audit log query`

---

### Phase 6: Compliance and operations API (lane A)

#### T25: Implement LGPD export and anonymization [P]

**What**: Data export, consent list, tenant deletion with blockers and re-authentication, admin anonymization with justification, effects of design §LGPD anonymization.
**Where**: `apps/api/src/modules/privacy/privacy.service.ts` (+ `apps/api/src/routes/app/privacy.ts`)
**Depends on**: None
**Reuses**: `verifyPassword`, `revokeAllSessions`, receita read functions (R12), consents (R14)
**Requirement**: GES-121, GES-122, GES-123, GES-124, GES-125, GES-126, GES-127

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Test asserts export sections present and a recursive scan finds no `password_hash`, `secret`, `token_hash`, `external_card_id` keys; 4th export in 24 h → 429
- [ ] Tests assert future booking / active subscription / pending charge each produce 409 `HAS_ACTIVE_COMMITMENTS` with the item and no change
- [ ] Test asserts wrong password 401; successful deletion sets every listed column, keeps bookings/charges/consents/audit, revokes sessions, clears cookie, queues `privacy.account_deleted`, rewrites older outbox rows
- [ ] Tests assert admin anonymize requires justification, reception 403, personal feed of the deleted user 404
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add LGPD data export and account anonymization`

---

#### T26: Add holiday reminder and import jobs [P]

**What**: Jobs `holiday-reminder` (daily) and `import-holidays` (weekly, BrasilAPI through nucleo `importNationalHolidays(db, year, deps, { renameExisting: false })`) per design.
**Where**: `apps/api/src/jobs/holidays.ts`
**Depends on**: None
**Reuses**: `registerJob` (R9), nucleo `importNationalHolidays`, `staff.holiday_review` (T7), `calendar.holiday_review_reminder` setting
**Requirement**: GES-130, GES-131, GES-132

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tests (injected `now`) assert e-mails to every active admin on local 2026-10-01 only once (re-run → none), nothing on 2026-10-02
- [ ] Tests assert import inserts a new national date with `source = 'brasilapi'`, skips a date that already has a seeded national holiday, never changes `is_closed`
- [ ] Tests assert 500/timeout/invalid JSON for one year leaves its rows unchanged, processes the other year, records the error in `job_runs`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add holiday review reminder and BrasilAPI import jobs`

---

#### T27: Implement free-tier usage endpoint [P]

**What**: `GET /admin/usage` with DB size, largest tables, bucket bytes, e-mail counts, limits from `usage.limits`, warnings at 80 %.
**Where**: `apps/api/src/modules/usage/usage.service.ts`
**Depends on**: None
**Reuses**: `Storage.totalBytes` (T4), settings
**Requirement**: GES-137, GES-138, GES-139

**Tools**:

- MCP: NONE
- Skill: `neon-postgres`

**Done when**:
- [ ] Tests assert response shape of design `UsageReport`, `db.bytes > 0`, 10 largest tables sorted by size
- [ ] Test asserts a limit set below current usage flags `warning: true` at ≥ 80 %
- [ ] Test asserts storage failure returns `storage.buckets: null` with `storageError` and the other figures; reception 403
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 4 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add free-tier usage report`

---

### Phase 7: Admin UI primitives and Financeiro (lane B)

#### T28: Add gestao UI primitives

**What**: `StatTile`, `EvolutionChart` (SVG + sr-only table), `FileUpload`, `CopyField`, `TokenList` per design §Web: Admin screens.
**Where**: `apps/web/src/components/ui/` (`StatTile.tsx`, `EvolutionChart.tsx`, `FileUpload.tsx`, `CopyField.tsx`, `TokenList.tsx`)
**Depends on**: T1
**Reuses**: `Button`, `Icon`, `useToast`, `formatBRL`
**Requirement**: GES-27

**Tools**:

- MCP: NONE
- Skill: `impeccable`

**Done when**:
- [x] Tests assert StatTile renders "R$ 1.600,00" and "+12,5%" / "—" for null delta
- [x] Tests assert EvolutionChart renders one group per bucket, a legend, and a table with the same numbers accessible by role
- [x] Tests assert FileUpload rejects a file over `maxBytes` with "Arquivo maior que 5 MB" before calling `onFile`; CopyField copies and shows "Copiado"; TokenList revoke opens a confirm modal
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 10 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add finance and integration UI primitives`

---

#### T29: Build Financeiro overview page

**What**: `/admin/financeiro` Visão geral tab: regime, grouping and range controls in URL params, stat tiles with deltas, chart, breakdown tables, "Exportar DRE (.xlsx)" link with the same params.
**Where**: `apps/web/src/pages/admin/finance/FinanceOverviewPage.tsx`
**Depends on**: T28
**Reuses**: `useQuery`, `api`, design `FinanceSummary`
**Requirement**: GES-26, GES-27, GES-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert defaults (Caixa, month, last 6 months) in the request URL
- [x] Tests assert switching to Competência/quarter updates URL params, refetches, and the export link carries `regime=accrual`
- [x] Tests assert loading skeleton, empty state, and API error alert with retry
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add Financeiro overview with regime and period comparison`

---

#### T30: Build expenses and manual receipts tabs

**What**: Despesas tab (list, filters, form with recurrence, attachment upload/view, category management drawer) and Recebimentos manuais tab (list, form, delete with justification).
**Where**: `apps/web/src/pages/admin/finance/ExpensesTab.tsx` (+ `apps/web/src/pages/admin/finance/ReceiptsTab.tsx`)
**Depends on**: T28
**Reuses**: core schemas (T1), `FileUpload`, `Table`, `Modal`
**Requirement**: GES-11, GES-16, GES-19, GES-20, GES-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert expense form validation messages from core schema, successful submit calls POST then PUT attachment, server 422 maps onto fields
- [x] Tests assert delete receipt requires justification text before enabling confirm
- [x] Tests assert category drawer rename/reorder/deactivate calls
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add expenses and manual receipts management`

---

### Phase 8: Admin Integrações UI (lane B)

#### T31: Build Integrações payments tab [P]

**What**: `/admin/integracoes` shell with tabs and the Pagamentos tab: provider cards, credential form with masked hints, environment, webhook URL `CopyField`, "Testar conexão", activate, production warning banner.
**Where**: `apps/web/src/pages/admin/integrations/PaymentsTab.tsx`
**Depends on**: None
**Reuses**: `CopyField`, `Tabs`, `Alert`
**Requirement**: GES-35, GES-36, GES-37, GES-38, GES-41

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert secret inputs are empty with placeholder hint `••••a1b2` and an empty submit sends empty secret strings
- [x] Tests assert test result `ok: false` shows the message in an error alert; activate disabled for unconfigured provider
- [x] Test asserts the banner "Pagamentos em modo de teste" when `productionWarning` is true
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add payment gateway integration tab`

---

#### T32: Build Integrações calendar and e-mail tabs [P]

**What**: Calendário tab (clinic feed and per-room feeds: generate, copy once, revoke, Google "Do URL" instructions) and E-mails tab (recipients, event toggles, test e-mail, outbox table, provider status).
**Where**: `apps/web/src/pages/admin/integrations/CalendarTab.tsx` (+ `apps/web/src/pages/admin/integrations/EmailsTab.tsx`)
**Depends on**: None
**Reuses**: `CopyField`, `Table`, `Checkbox`
**Requirement**: GES-42, GES-65, GES-66, GES-70, GES-71, GES-74

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert the URL is shown only right after generation with "Copie agora: o link não será exibido de novo"
- [x] Tests assert regenerate asks for confirmation; revoke updates the list
- [x] Tests assert toggles list the 7 events in pt-BR, test e-mail renders per-recipient status, missing provider message renders
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add calendar feed and notification e-mail tabs`

---

#### T33: Build Integrações MCP and usage tabs [P]

**What**: MCP tab (enable switch, server URL with warning, tool catalog table with scope/destructive badges, token creation modal showing raw token once, `TokenList`) and Consumo tab (usage bars with warnings, largest tables).
**Where**: `apps/web/src/pages/admin/integrations/McpTab.tsx` (+ `apps/web/src/pages/admin/integrations/UsageTab.tsx`)
**Depends on**: None
**Reuses**: `TokenList`, `CopyField`, `StatTile`
**Requirement**: GES-53, GES-54, GES-63, GES-137, GES-138

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert token modal validates name, shows the raw token once and clears it on close
- [x] Tests assert tool table renders scope "Leitura"/"Leitura e escrita" and destructive badge "Requer confirmação"
- [x] Tests assert usage item ≥ 80 % renders the warning style and text "Perto do limite", storage error message renders
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add MCP and free-tier usage tabs`

---

### Phase 9: Admin operations UI (lane B)

#### T34: Build Serviços Extras admin [P]

**What**: `/admin/servicos-extras` with Serviços tab (CRUD form, sale mode, status, order) and Pedidos tab (funnel columns with "Mover para" menu, detail drawer with contact, linked booking, notes).
**Where**: `apps/web/src/pages/admin/extras/ExtrasAdminPage.tsx`
**Depends on**: None
**Reuses**: core schemas, `labels.ts` quote statuses, `Drawer`
**Requirement**: GES-84, GES-85, GES-96

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert online-without-price error message on the price field
- [x] Tests assert funnel renders 5 columns with counts, "Mover para" offers only valid next statuses, 409 shows "O pedido mudou de status. Atualize a página."
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add extra services admin with quote funnel`

---

#### T35: Build Clientes list and profile [P]

**What**: `/admin/clientes` search list and `/admin/clientes/:id` with sections of GES-100, notes editor, admin-only profile edit and anonymize action hidden for reception.
**Where**: `apps/web/src/pages/admin/customers/CustomerDetailPage.tsx` (+ `apps/web/src/pages/admin/customers/CustomersPage.tsx`)
**Depends on**: None
**Reuses**: `Table`, `StatusBadge`, `useSession` role
**Requirement**: GES-99, GES-100, GES-101, GES-102

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert debounced search request with `q`, empty state, pagination "Carregar mais"
- [x] Tests assert detail renders bookings, balances, credits, coupons, consents sections from a fixture
- [x] Tests assert reception sees notes editor but not "Editar cadastro" nor "Excluir dados (LGPD)"
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add customer list and profile for staff`

---

#### T36: Build Salas admin and media proxy rule [P]

**What**: `/admin/salas` list + `/admin/salas/:id` form (tags, equipment, order, status with commitments modal) and photo manager (`prepareRoomPhoto` WebP large/small, upload progress, alt text, cover, reorder, delete); `/media/*` rule in `buildRedirects` when `STORAGE_PUBLIC_ORIGIN` is set.
**Where**: `apps/web/src/pages/admin/rooms/RoomEditPage.tsx` (+ `apps/web/src/features/admin-rooms/`, `apps/web/scripts/write-redirects.mjs`)
**Depends on**: None
**Reuses**: `FileUpload`, `buildRedirects` (fundacao)
**Requirement**: GES-103, GES-104, GES-108, GES-109

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert `prepareRoomPhoto` with a fake canvas returns two WebP blobs with longest sides 1600 and 800 for a 4000×3000 input
- [x] Tests assert upload calls two PUTs then POST registration, progress shown, alt text required
- [x] Test asserts 409 commitments modal lists booking codes
- [x] Tests assert `buildRedirects` emits `/media/*  https://x/room-photos/:splat  200` before the SPA fallback when set, omits it when unset, strips trailing slash, rejects `http://`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add room administration with photo uploads`

---

#### T37: Build Usuários and Auditoria pages [P]

**What**: `/admin/usuarios` (list with 2FA status, invite/promote modal, role/status actions with confirmation, 2FA reset with justification) and `/admin/auditoria` (filters, table, detail drawer with before/after JSON).
**Where**: `apps/web/src/pages/admin/users/UsersPage.tsx` (+ `apps/web/src/pages/admin/audit/AuditPage.tsx`)
**Depends on**: None
**Reuses**: `Table`, `Drawer`, `Select`
**Requirement**: GES-110, GES-111, GES-113, GES-116

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert own row has role/status actions disabled; `LAST_ADMIN` error shows its pt-BR message
- [x] Tests assert audit filters write URL params and the drawer shows origin label "MCP" and justification
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add staff users and audit log pages`

---

### Phase 10: Public and tenant UI (lane B)

#### T38: Build public extras page and quote forms [P]

**What**: `/servicos-extras`, shared `QuoteRequestForm` (honeypot hidden from users and assistive tech), Home `QuoteModal` posting to the API with WhatsApp as secondary, `/app/orcamentos` list.
**Where**: `apps/web/src/features/extras/QuoteRequestForm.tsx` (+ `apps/web/src/pages/public/ExtrasPage.tsx`, `apps/web/src/pages/app/QuotesPage.tsx`)
**Depends on**: None
**Reuses**: core `quoteRequestInputSchema`, `formatBRL`, Home `QuoteModal` (fundacao)
**Requirement**: GES-87, GES-97, GES-98

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert prices "R$ 80,00/h", "Sob consulta"; form validation; success message "Pedido enviado. Retornaremos em breve."; 429 message
- [x] Test asserts logged-in tenant sees an optional "Reserva vinculada" select with their upcoming bookings
- [x] Test asserts Home modal no longer opens WhatsApp on submit and still shows the WhatsApp link
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add extra services page and quote request forms`

---

#### T39: Build checkout extras add-on picker [P]

**What**: `ExtrasAddonPicker` registered in nucleo's slot `checkout.summary.extras` (props `{ draft, onChange(addons) }`): online services, quantity stepper bounded by booking hours, line totals, value passed as `addons.extras`.
**Where**: `apps/web/src/features/extras/ExtrasAddonPicker.tsx`
**Depends on**: None
**Reuses**: nucleo `checkout.summary.extras` slot (R6), `formatBRL`
**Requirement**: GES-88

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert picker hidden when no online service, stepper max = ceil(minutes / 60) for hourly and fixed 1 for project, `onChange` payload shape
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add extra services picker to checkout`

---

#### T40: Build push notification settings and SW handler [P]

**What**: `/app/perfil/notificacoes` with `usePushSubscription`, explanations for unsupported/denied/iOS-not-installed; `public/push-sw.js` (`push`, `notificationclick`) imported through `workbox.importScripts`.
**Where**: `apps/web/src/pages/app/NotificationSettingsPage.tsx` (+ `apps/web/public/push-sw.js`, `apps/web/vite.config.ts`)
**Depends on**: None
**Reuses**: `useClinicConfig` (`vapidPublicKey`), `api`
**Requirement**: GES-82, GES-83

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests (mocked `Notification`, `PushManager`) assert enable flow posts the subscription and disable deletes it
- [x] Tests assert each of the three explanation texts and no button when `vapidPublicKey` is null
- [x] Tests load `push-sw.js` in a fake SW scope and assert `showNotification(title, { body, icon, data.url })` and `clients.openWindow(url)` when no window is open
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add web push opt-in and service worker handler`

---

#### T41: Build privacy page and calendar sync [P]

**What**: `/app/perfil/privacidade` (consents, export download, deletion modal with password or `EXCLUIR`, blockers list) and `CalendarSyncCard` (personal feed generate/copy/regenerate with Google/Outlook steps) on `/app/agenda`; the booking-detail "Baixar .ics" link stays nucleo's (T41).
**Where**: `apps/web/src/pages/app/PrivacyPage.tsx` (+ `apps/web/src/features/calendar-sync/CalendarSyncCard.tsx`)
**Depends on**: None
**Reuses**: `Modal`, `CopyField`, nucleo booking detail page
**Requirement**: GES-45, GES-50, GES-128

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tests assert consent labels/versions/dates, export triggers a download of the API URL
- [x] Tests assert deletion modal requires password (or `EXCLUIR` for Google-only), shows 409 blockers list, logs out on success
- [x] Tests assert feed card shows URL once after generation and nucleo's booking-detail "Baixar .ics" link still targets `/api/app/bookings/<id>/ics`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add privacy self-service and calendar sync`

---

#### T42: Add analytics funnel module [P]

**What**: Replace the loader of nucleo's `lib/analytics.ts` (nucleo T29; `track(event, props)` signature and nucleo event names kept, `VITE_ANALYTICS_PROVIDER` supersedes the `VITE_GA4_ID`-only gate): provider loader after `load`, cookieless, property whitelist, admin suppression, `usePageViews`, new `track()` calls (`subscription_purchased`, `quote_requested`, `signup_completed`) at the R16 points, CSP hosts in `netlify.toml`.
**Where**: `apps/web/src/lib/analytics.ts`
**Depends on**: None
**Reuses**: nucleo/receita pages (R16)
**Requirement**: GES-133, GES-134, GES-135, GES-136

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tests assert no script element and no-op `track` when the env var is unset
- [ ] Tests assert script injected only after `load`, PostHog init with `persistence: 'memory'`, GA4 config with `client_storage: 'none'`
- [ ] Tests assert non-whitelisted props (`email`, `name`) are dropped and `/admin` paths send nothing
- [ ] Tests assert each funnel point component calls `track` with the event name once
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 9 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add cookieless funnel analytics`

---

### Phase 11: Integration (after lanes merge)

#### T43: Bridge nucleo and receita notifications [P]

**What**: Rewire nucleo `bookingMailer` and receita `revenueMailer` (R7) to `notifications.emit` (tenant e-mails unchanged + push) and implement nucleo's `NotificationPort` with `emit` (R8: `notifyStaff(event, { entityId })` → own transaction + `afterCommit`), registered in `apps/api/src/extensions/index.ts`; `payment_issue` sent without toggle.
**Where**: `apps/api/src/modules/notifications/staff-port.ts` (+ `apps/api/src/extensions/index.ts`, `apps/api/src/modules/booking/booking-mailer.ts`, `apps/api/src/modules/subscriptions/revenue-mailer.ts`)
**Depends on**: None
**Reuses**: `emit` (T5), nucleo/receita services
**Requirement**: GES-69

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Tests assert each of the 7 staff events is emitted exactly once by its trigger (confirm, webhook approval, cancel by tenant/clinic/nonpayment, expire job, first subscription payment, renewal failure, quote) and `payment_issue` reaches recipients even with all toggles off
- [ ] Test asserts a booking confirmation still queues nucleo's `booking.confirmed` e-mail with `.ics` and now also sends a push (web-push stubbed)
- [ ] All pre-existing nucleo/receita tests pass unchanged
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 9 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): route booking and subscription notifications through emit`

---

#### T44: Enforce reception restrictions end-to-end [P]

**What**: Route-table sweep test with `RECEPTION_ALLOWLIST` (the nucleo, receita, gestao and fundacao paths listed in design §Reception allowlist), guard fixes on any misclassified route, and web guard test for reception navigation.
**Where**: `apps/api/src/routes/admin/access-sweep.int.test.ts` (+ guard fixes, `apps/web/src/router.test.tsx`)
**Depends on**: None
**Reuses**: Hono route list (`app.routes`), `access.ts`
**Requirement**: GES-117, GES-118, GES-119, GES-120

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Sweep calls every `/admin/*` route as reception: allowlisted ones do not return 403, all others return 403 `FORBIDDEN`; an unclassified route fails the test
- [ ] Web test asserts reception visiting `/admin/financeiro`, `/admin/integracoes`, `/admin/reservas/politicas` renders the 403 page and the nav lists only Gestão de Reservas and Clientes
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api && npm test -w apps/web`
- [ ] Test count: ≥ 3 new tests pass (sweep parametrized over all routes)

**Tests**: integration
**Gate**: full

**Commit**: `test(api): sweep admin routes for reception restrictions`

---

#### T45: Add MVP journey e2e

**What**: Playwright spec of GES-140 on a 390×844 viewport, with helpers reading `email_outbox` via `pg` (`DATABASE_URL_TEST`) and parsing `.ics` attachments.
**Where**: `apps/web/e2e/mvp-journey.spec.ts` (+ `apps/web/e2e/helpers/`)
**Depends on**: None
**Reuses**: nucleo Playwright config and sandbox page (R15)
**Requirement**: GES-140, GES-49

**Tools**:

- MCP: NONE
- Skill: `run`

**Done when**:
- [ ] Spec passes locally and in CI: room → slot → signup → policy → sandbox approve → "Confirmada" → outbox `.ics` UID = `ics_uid` → reschedule → new `.ics` same UID, SEQUENCE + 1 → personal feed shows the new DTSTART
- [ ] CI workflow runs `npm run e2e -w apps/web` after unit tests (postgres:17 service)
- [ ] Gate check passes: `npm run typecheck && npm run e2e -w apps/web`
- [ ] Test count: ≥ 1 e2e spec (1 test, ≥ 10 assertions) passes

**Tests**: e2e
**Gate**: e2e

**Commit**: `test(web): add MVP booking journey end-to-end test`

---

#### T46: Add admin configuration e2e

**What**: Playwright spec of GES-141 (TOTP login computed with `otpauth`, price edit, expense with PDF, DRE download parsed with exceljs, clinic ICS link fetch, MCP token + `tools/list` via HTTP, revoke).
**Where**: `apps/web/e2e/admin-config.spec.ts`
**Depends on**: T45
**Reuses**: e2e helpers (T45), R17
**Requirement**: GES-141

**Tools**:

- MCP: NONE
- Skill: `run`

**Done when**:
- [ ] Spec passes locally and in CI with every step of GES-141 asserted
- [ ] Gate check passes: `npm run typecheck && npm run e2e -w apps/web`
- [ ] Test count: ≥ 1 e2e spec passes

**Tests**: e2e
**Gate**: e2e

**Commit**: `test(web): add admin configuration end-to-end test`

---

### Phase 12: Hardening and production release (explicit go-ahead for T49–T50)

#### T47: Add accessibility suite and fix violations

**What**: `@axe-core/playwright` spec over the GES-142 pages in Day and Night, plus keyboard checks on Admin tabs/drawers; fix every violation found (contrast, labels, focus order).
**Where**: `apps/web/e2e/a11y.spec.ts`
**Depends on**: None
**Reuses**: e2e helpers (T45)
**Requirement**: GES-142

**Tools**:

- MCP: NONE
- Skill: `impeccable`

**Done when**:
- [ ] Spec reports zero violations tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` on all 13 pages × 2 themes
- [ ] Fixes listed in the commit body with file paths; no axe rule disabled
- [ ] Gate check passes: `npm run typecheck && npm run e2e -w apps/web`
- [ ] Test count: ≥ 26 axe checks pass

**Tests**: e2e
**Gate**: e2e

**Commit**: `fix(web): reach WCAG 2.1 AA on key pages`

---

#### T48: Add Lighthouse CI budgets and fix regressions

**What**: `lighthouserc.cjs` + `npm run lhci -w apps/web` (mobile preset on `/`, `/salas`, `/salas/principal`, 3 runs median) with GES-143 assertions; fix LCP/CLS issues (image `fetchpriority`, `srcset` large/small, font preload, lazy Admin chunks).
**Where**: `apps/web/lighthouserc.cjs`
**Depends on**: None
**Reuses**: `toPhotoUrl` variants, `/media/*` rule
**Requirement**: GES-143

**Tools**:

- MCP: NONE
- Skill: `netlify-image-cdn`

**Done when**:
- [ ] `npm run lhci -w apps/web` passes LCP ≤ 2500 ms, CLS ≤ 0.1, accessibility ≥ 0.95 on the three URLs with and without the analytics env set
- [ ] If `/media/*` caching misses the budget, the Netlify Image CDN fallback of design Risks is applied and recorded as an AD amendment
- [ ] Gate check passes: `npm run lhci -w apps/web`
- [ ] Test count: 3 URLs × 3 assertions pass

**Tests**: e2e
**Gate**: quality

**Commit**: `perf(web): enforce Lighthouse budgets on public pages`

---

#### T49: Release gestao backend to production

**What**: With the user's go-ahead: add buckets (`room-photos` public_read, `expense-attachments`) and gestao triggers (`email-retry` `*/5 * * * *`, `retention` `0 8 * * 0`, `recurring-expenses` `0 9 * * *`, `holiday-reminder` `0 11 * * *`, `import-holidays` `0 7 * * 1`) plus optional env `API_FUNCTION_URL`, `VAPID_*` to `neon.ts` with a unit test; apply the gestao migration and seed to `production`; `npx neonctl@latest deploy` the function; record `API_FUNCTION_URL` and the storage endpoint.
**Where**: `neon.ts`
**Depends on**: T47, T48
**Reuses**: fundacao T76/T77 procedure, `neon.ts`
**Requirement**: GES-144

**Tools**:

- MCP: `Neon` (read-only verification: `get_database_tables`, `list_functions`, `list_storage_buckets`)
- Skill: `neon-functions`, `neon-object-storage`

**Done when**:
- [ ] User approved this phase in chat
- [ ] Unit test asserts `neon.ts` declares both buckets with the right access and all five gestao triggers with their paths and schedules
- [ ] Neon `production` has the §5.5 tables, seeds, both buckets; `curl <invocation_url>/health` returns ok; trigger list shows the gestao jobs
- [ ] No connection string, key or token appears in output or files
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: unit
**Gate**: build

**Commit**: `chore(ops): declare gestao buckets and triggers and release backend`

---

#### T50: Release site and run the extended smoke check

**What**: With the user's go-ahead: set Netlify env (`STORAGE_PUBLIC_ORIGIN`, analytics vars if chosen), deploy `bravo-clinic` to production, extend `scripts/smoke.mjs` with the gestao checks of design §Hardening, run it, update `.specs/STATE.md` Handoff.
**Where**: `scripts/smoke.mjs`
**Depends on**: T49
**Reuses**: fundacao T78 procedure
**Requirement**: GES-144

**Tools**:

- MCP: NONE
- Skill: `netlify-deploy`

**Done when**:
- [ ] User approved this phase in chat
- [ ] `node scripts/smoke.mjs https://bravo-clinic.netlify.app` exits 0 including extras list, `/servicos-extras`, ICS 404 and MCP 401/404 checks
- [ ] Admin opens Integrações on production and sees the MCP server URL and the payments tab (manual check by the user)
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: e2e
**Gate**: build

**Commit**: `chore(ops): release gestao to production with extended smoke check`

---

## Phase Execution Map

```
Lane A (worktree gestao/api):  Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 ─┐
Lane B (worktree gestao/web):  (after T1 merged) Phase 7 → Phase 8 → Phase 9 → Phase 10 ───┤
                                                                                       merge
Main:                                                              Phase 11 → Phase 12
```

Batch packing (~7 tasks, whole phases): lane A — A1 = P1 + P2 (9, one tight seam: core + platform), A2 = P3 (5), A3 = P4 (5), A4 = P5 + P6 (8); lane B — B1 = P7 + P8 (6), B2 = P9 (4), B3 = P10 (5); main — M1 = P11 (4), M2 = P12 (4, T49–T50 operator-approved). Model tier: A1, A3, A4 high-reasoning (finance, privacy, notifications); A2 high-reasoning (MCP security); B1–B3 and M1–M2 implementation tier, except T47/T48 fixes (mid tier).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Add gestao core contracts | 3 small modules, one concern (shared contracts) | ⚠️ OK (cohesive) |
| T2: Implement finance engine | 2 files, one concern (finance math) | ⚠️ OK (cohesive) |
| T3: Add gestao schema, migration and seeds | schema + generated SQL + seed rows, one concern | ⚠️ OK (cohesive) |
| T4: Implement object storage library | 1 file | ✅ Granular |
| T5: Implement notifications service and push sender | service + its sender | ⚠️ OK (cohesive) |
| T6: Add push subscription routes and VAPID public key | 1 route file | ✅ Granular |
| T7: Add gestao e-mail templates | 1 file | ✅ Granular |
| T8: Harden the RFC 5545 serializer | 1 file | ✅ Granular |
| T9: Add e-mail retry and retention jobs | 1 file | ✅ Granular |
| T10: Implement calendar feeds and per-booking .ics | service + its routes | ⚠️ OK (cohesive) |
| T11: Implement gateway configuration | service + its routes | ⚠️ OK (cohesive) |
| T12: Implement notification admin endpoints | 1 route file | ✅ Granular |
| T13: Implement MCP tokens and transport | token service + transport, one concern (MCP auth) | ⚠️ OK (cohesive) |
| T14: Register MCP tool catalog | 1 registry folder | ✅ Granular |
| T15: Implement expenses, categories and attachments | service + its routes | ⚠️ OK (cohesive) |
| T16: Add recurring expenses job | 1 file | ✅ Granular |
| T17: Implement manual receipts | 1 file | ✅ Granular |
| T18: Implement finance summary endpoint | 1 file | ✅ Granular |
| T19: Implement DRE xlsx export | 1 file | ✅ Granular |
| T20: Implement extra services and checkout add-on | service + its add-on | ⚠️ OK (cohesive) |
| T21: Implement quote requests funnel | 1 file | ✅ Granular |
| T22: Implement rooms admin and photos | service + its routes | ⚠️ OK (cohesive) |
| T23: Implement Clientes service | 1 file | ✅ Granular |
| T24: Implement staff users and audit log query | service + audit route, one concern (governance) | ⚠️ OK (cohesive) |
| T25: Implement LGPD export and anonymization | service + its routes | ⚠️ OK (cohesive) |
| T26: Add holiday reminder and import jobs | 1 file | ✅ Granular |
| T27: Implement free-tier usage endpoint | 1 file | ✅ Granular |
| T28: Add gestao UI primitives | 5 small components, one concern | ⚠️ OK (cohesive) |
| T29: Build Financeiro overview page | 1 page | ✅ Granular |
| T30: Build expenses and manual receipts tabs | 2 tabs of one page | ⚠️ OK (cohesive) |
| T31: Build Integrações payments tab | 1 tab | ✅ Granular |
| T32: Build Integrações calendar and e-mail tabs | 2 tabs | ⚠️ OK (cohesive) |
| T33: Build Integrações MCP and usage tabs | 2 tabs | ⚠️ OK (cohesive) |
| T34: Build Serviços Extras admin | 1 page | ✅ Granular |
| T35: Build Clientes list and profile | list + detail | ⚠️ OK (cohesive) |
| T36: Build Salas admin and media proxy rule | page + photo helper + redirect rule | ⚠️ OK (cohesive) |
| T37: Build Usuários and Auditoria pages | 2 pages, governance | ⚠️ OK (cohesive) |
| T38: Build public extras page and quote forms | form + 2 pages using it | ⚠️ OK (cohesive) |
| T39: Build checkout extras add-on picker | 1 component | ✅ Granular |
| T40: Build push notification settings and SW handler | page + SW script + config line | ⚠️ OK (cohesive) |
| T41: Build privacy page and calendar sync | page + card | ⚠️ OK (cohesive) |
| T42: Add analytics funnel module | 1 module + call sites | ⚠️ OK (cohesive) |
| T43: Bridge nucleo and receita notifications | call-site wiring | ⚠️ OK (cohesive) |
| T44: Enforce reception restrictions end-to-end | 1 sweep test + guard fixes | ⚠️ OK (cohesive) |
| T45: Add MVP journey e2e | 1 spec + helpers | ✅ Granular |
| T46: Add admin configuration e2e | 1 spec | ✅ Granular |
| T47: Add accessibility suite and fix violations | 1 spec + fixes | ⚠️ OK (cohesive) |
| T48: Add Lighthouse CI budgets and fix regressions | 1 config + fixes | ⚠️ OK (cohesive) |
| T49: Release gestao backend to production | 1 config file + operational steps | ✅ Granular |
| T50: Release site and run the extended smoke check | 1 script + operational steps | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (same-phase arrows) | Status |
| --- | --- | --- | --- |
| T1 | None | - | ✅ Match |
| T2 | None | - | ✅ Match |
| T3 | T1 | T1 | ✅ Match |
| T4 | None (same phase); earlier phase: T3 | - | ✅ Match |
| T5 | None (same phase); earlier phase: T1, T3 | - | ✅ Match |
| T6 | T5 | T5 | ✅ Match |
| T7 | None | - | ✅ Match |
| T8 | None | - | ✅ Match |
| T9 | None | - | ✅ Match |
| T10 | T8 (earlier phase) | - | ✅ Match |
| T11 | None (same phase); earlier phase: T5 | - | ✅ Match |
| T12 | None (same phase); earlier phase: T7 | - | ✅ Match |
| T13 | None | - | ✅ Match |
| T14 | T13 | T13 | ✅ Match |
| T15 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T16 | T15 | T15 | ✅ Match |
| T17 | None | - | ✅ Match |
| T18 | T15, T17 | T15, T17 | ✅ Match |
| T19 | T18 | T18 | ✅ Match |
| T20 | None | - | ✅ Match |
| T21 | T20 | T20 | ✅ Match |
| T22 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T23 | None | - | ✅ Match |
| T24 | None | - | ✅ Match |
| T25 | None | - | ✅ Match |
| T26 | None | - | ✅ Match |
| T27 | None | - | ✅ Match |
| T28 | T1 (earlier phase, cross-lane) | - | ✅ Match |
| T29 | T28 | T28 | ✅ Match |
| T30 | T28 | T28 | ✅ Match |
| T31 | None (same phase); earlier phase: T28 | - | ✅ Match |
| T32 | None (same phase); earlier phase: T28 | - | ✅ Match |
| T33 | None (same phase); earlier phase: T28 | - | ✅ Match |
| T34 | None | - | ✅ Match |
| T35 | None | - | ✅ Match |
| T36 | None | - | ✅ Match |
| T37 | None | - | ✅ Match |
| T38 | None | - | ✅ Match |
| T39 | None | - | ✅ Match |
| T40 | None | - | ✅ Match |
| T41 | None | - | ✅ Match |
| T42 | None | - | ✅ Match |
| T43 | None (same phase); earlier phase: T5 | - | ✅ Match |
| T44 | None | - | ✅ Match |
| T45 | None | - | ✅ Match |
| T46 | T45 | T45 | ✅ Match |
| T47 | None | - | ✅ Match |
| T48 | None | - | ✅ Match |
| T49 | T47, T48 | T47, T48 | ✅ Match |
| T50 | T49 | T49 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Add gestao core contracts | core | unit | unit | ✅ OK |
| T2: Implement finance engine | core | unit | unit | ✅ OK |
| T3: Add gestao schema, migration and seeds | migration constraints + seeds | integration | integration | ✅ OK |
| T4: Implement object storage library | API pure lib | unit | unit | ✅ OK |
| T5: Implement notifications service and push sender | API service | integration | integration | ✅ OK |
| T6: Add push subscription routes and VAPID public key | API route | integration | integration | ✅ OK |
| T7: Add gestao e-mail templates | API pure lib | unit | unit | ✅ OK |
| T8: Harden the RFC 5545 serializer | API pure lib | unit | unit | ✅ OK |
| T9: Add e-mail retry and retention jobs | API job | integration | integration | ✅ OK |
| T10: Implement calendar feeds and per-booking .ics | API service/route | integration | integration | ✅ OK |
| T11: Implement gateway configuration | API service/route | integration | integration | ✅ OK |
| T12: Implement notification admin endpoints | API route | integration | integration | ✅ OK |
| T13: Implement MCP tokens and transport | API service/route | integration | integration | ✅ OK |
| T14: Register MCP tool catalog | API MCP | integration | integration | ✅ OK |
| T15: Implement expenses, categories and attachments | API service/route | integration | integration | ✅ OK |
| T16: Add recurring expenses job | API job | integration | integration | ✅ OK |
| T17: Implement manual receipts | API service/route | integration | integration | ✅ OK |
| T18: Implement finance summary endpoint | API service/route | integration | integration | ✅ OK |
| T19: Implement DRE xlsx export | API service/route | integration | integration | ✅ OK |
| T20: Implement extra services and checkout add-on | API service/route | integration | integration | ✅ OK |
| T21: Implement quote requests funnel | API service/route | integration | integration | ✅ OK |
| T22: Implement rooms admin and photos | API service/route | integration | integration | ✅ OK |
| T23: Implement Clientes service | API service/route | integration | integration | ✅ OK |
| T24: Implement staff users and audit log query | API service/route | integration | integration | ✅ OK |
| T25: Implement LGPD export and anonymization | API service/route | integration | integration | ✅ OK |
| T26: Add holiday reminder and import jobs | API job | integration | integration | ✅ OK |
| T27: Implement free-tier usage endpoint | API service/route | integration | integration | ✅ OK |
| T28: Add gestao UI primitives | Web component | unit | unit | ✅ OK |
| T29: Build Financeiro overview page | Web page | unit | unit | ✅ OK |
| T30: Build expenses and manual receipts tabs | Web page | unit | unit | ✅ OK |
| T31: Build Integrações payments tab | Web page | unit | unit | ✅ OK |
| T32: Build Integrações calendar and e-mail tabs | Web page | unit | unit | ✅ OK |
| T33: Build Integrações MCP and usage tabs | Web page | unit | unit | ✅ OK |
| T34: Build Serviços Extras admin | Web page | unit | unit | ✅ OK |
| T35: Build Clientes list and profile | Web page | unit | unit | ✅ OK |
| T36: Build Salas admin and media proxy rule | Web page + web config | unit | unit | ✅ OK |
| T37: Build Usuários and Auditoria pages | Web page | unit | unit | ✅ OK |
| T38: Build public extras page and quote forms | Web page | unit | unit | ✅ OK |
| T39: Build checkout extras add-on picker | Web component | unit | unit | ✅ OK |
| T40: Build push notification settings and SW handler | Web page + web config | unit | unit | ✅ OK |
| T41: Build privacy page and calendar sync | Web page | unit | unit | ✅ OK |
| T42: Add analytics funnel module | Web config/module | unit | unit | ✅ OK |
| T43: Bridge nucleo and receita notifications | API services | integration | integration | ✅ OK |
| T44: Enforce reception restrictions end-to-end | API routes + web router | integration (highest) | integration | ✅ OK |
| T45: Add MVP journey e2e | e2e journey | e2e | e2e | ✅ OK |
| T46: Add admin configuration e2e | e2e journey | e2e | e2e | ✅ OK |
| T47: Add accessibility suite and fix violations | e2e accessibility | e2e | e2e | ✅ OK |
| T48: Add Lighthouse CI budgets and fix regressions | performance budgets | e2e | e2e | ✅ OK |
| T49: Release gestao backend to production | Deploy config (`neon.ts`) + operational steps | unit | unit | ✅ OK |
| T50: Release site and run the extended smoke check | Production release (smoke) | e2e | e2e | ✅ OK |
