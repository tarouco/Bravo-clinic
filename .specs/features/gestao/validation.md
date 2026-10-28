# Gestão Validation

## Validation verdict: FAIL

Iteration 1 verdict at `main` `42a920a`: **FAIL** on the discrimination sensor. 139/141 in-scope ACs (GES-01..GES-141) pass with file:line evidence; GES-95 and GES-138 are PARTIAL. Sensor 24/28 killed with 3 real survivors (A7, A12, A19) and 1 equivalent (A17). Every gate is green. GES-142..GES-144 (T47–T50) are pending and not judged. The fixes are three test additions; no product-code defect was found.

## Iteration history

| Iteration | Verdict | Summary |
| --------- | ------- | ------- |
| 1 (2026-10-28, branch `worktree-agent-aaa9364ff302e0105`, `main` at `86f1b96` → fast-forwarded to `42a920a`) | FAIL | Scope T1–T46 (GES-01..GES-141). 139/141 in-scope ACs pass, GES-95 and GES-138 PARTIAL; sensor 24/28 killed (survivors A7, A12, A19; A17 equivalent); gates green (core 1194, web 1196, API 1228, typecheck, lint). GES-142..GES-144 (T47–T50) pending, not judged. Findings: F1, F2 Major (survivors A7, A19), F3 Minor survivor (A12), F4–F7 Minor non-blocking |

---

## Iteration 1 report

**Date**: 2026-10-28 (started 02:30 BRT; resumed 07:55 BRT after a host restart)
**Spec**: `.specs/features/gestao/spec.md` (GES-01..GES-144)
**Scope**: every AC of tasks T1–T46, i.e. GES-01..GES-141. GES-142 (T47 axe), GES-143 (T48 Lighthouse) and GES-144 (T49–T50 production release) belong to tasks still in progress and are marked **⏸ pending / out of scope** for this iteration, not FAIL.
**Diff range**: gestao commits on `main` up to `86f1b96` (Phase 11 merge `c1ae66c` plus the schedule-grid fix); after the restart the worktree was fast-forwarded to `42a920a` (`chore(ops): declare gestao buckets and triggers`, T49 code prep: `neon.ts` + `apps/api/src/neon.test.ts`). Only GES ACs are judged.
**Verifier**: independent sub-agent (author ≠ verifier; wrote none of the gestao code or tests), worktree branch `worktree-agent-aaa9364ff302e0105`.
**Test DBs**: four fresh empty databases `gestao_ver_hmuv87_1..4`, created for this run with `CREATE DATABASE` on the Neon verify branch (`DATABASE_URL_VERIFY`, host checked different from both production `DATABASE_URL`/`DATABASE_URL_UNPOOLED` and the dev `DATABASE_URL_TEST` owned by another agent). The worktree `.env` (untracked, gitignored) is a copy of the main checkout's `.env` with `DATABASE_URL_TEST` pointed at `gestao_ver_hmuv87_1`; shards 2–4 received their database through the process environment (Vite `loadEnv` lets `process.env` override the file, checked with a probe). The suite's own `assertNotProduction` guard ran in every shard. All four databases were dropped at the end (see Cleanup).

---

## Task Completion

46 in-scope tasks (T1–T46). `python …/scripts/validate_tasks.py .specs/features/gestao` → `0 error(s), 23 warning(s)` (granularity warnings only).

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T27 (lane A: core, API, jobs) | ✅ Done | all Done-when boxes `[x]` |
| T28–T41 (lane B: web) | ✅ Done | all Done-when boxes `[x]` |
| T42 analytics funnel | ✅ Done (code) / ⚠️ boxes unticked | Implemented in `cf4e837 feat(web): add cookieless funnel analytics`; `apps/web/src/lib/analytics.test.tsx` and the funnel-point tests pass; but its 6 Done-when boxes in `tasks.md:1365-1370` are still `[ ]` → F4 |
| T43–T46 (Phase 11 integration, e2e) | ✅ Done | e2e not re-run by the verifier (ports in use by other agents); T45/T46 passed 16/16 on `main` at 02:21 2026-10-28 per the orchestrator |
| T47–T50 | ⏸ In progress | out of scope this iteration; T49 code prep (`42a920a`) present, release not done |

---

## Spec-Anchored Acceptance Criteria

Paths: `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`, `e2e/` = `apps/web/e2e/`. Line numbers point to the `it(` / `describe(` whose assertions carry the spec value. Every cited file was read at `86f1b96`/`42a920a` (the fast-forward touched only `neon.ts` and `api/neon.test.ts`). 70 test files carry GES tags; GES-122 has no tag and was traced by content. Where an AC value rests on a constant rather than an assertion, the row says "(code path)".

### P1 Revenue recognition engine

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-01 | purpose → category map (8 purposes) | `core/finance/recognition.test.ts:74` (one `toBe` per purpose, e.g. `extra_service` → `extra_services`) | ✅ |
| GES-02 | Caixa: `approved_at` / receipt `date` / refund `completed_at` local dates | `recognition.test.ts:128` (deposit+balance in 2026-11), `:218` (refund dated `2026-11-10`), `:433` (manual receipt by date); `api/modules/finance/finance-report.int.test.ts:48` | ✅ |
| GES-03 | Competência: booking `starts_at`, or `cancelled_at` for `cancelled_*`/`expired` | `recognition.test.ts:128` (2026-12), `:218` (cancel ≥ 24 h on 2026-10-30), `:384` (`cancelled_nonpayment`, `expired`), `:433`; `finance-report.int.test.ts:82` | ✅ |
| GES-04 | even spread, leftover to earliest days; 616000/30 → 10×20534 + 20×20533 | `recognition.test.ts:87` (exact split, sum 616000, first/last date), `:165` (Nov total 595467), `:326` | ✅ |
| GES-05 | extra hours on payment date in both regimes | `recognition.test.ts:415` (`run('cash')` and `run('accrual')` equal the same dated list) | ✅ |
| GES-06 | discounts and credit charges on line 1 and line 2, dated with their receipt | `recognition.test.ts:137` (gross 21900, discounts −2000 both regimes), `:273`, `:297`, `:326`; `finance-report.int.test.ts:116` | ✅ |
| GES-07 | refunds and chargebacks line 3 under original category; fees line 4 | `recognition.test.ts:354`, `:297` (credit: no fee), `:128` (fees −219) | ✅ |
| GES-08 | extras share half up `amount × extras / total` | `recognition.test.ts:99` (`splitExtras(15, 1, 2)` → 8/7), `:194` (22000 / 8000 both regimes) | ✅ |
| GES-09 | no entry for `package`/`subscription` payment modes | `recognition.test.ts:253` (`toEqual([])` for both modes, both regimes) | ✅ |
| GES-10 | pure `@bravo/core` module, same totals browser/server | `recognition.test.ts:464`; module lives in `core/finance/recognition.ts` (no I/O imports); the API serves its totals (`finance-report.int.test.ts:200` MCP = HTTP totals) | ✅ |

### P1 Expenses and manual receipts

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-11 | 201 + audit `expense.create` | `api/routes/admin/finance-expenses.int.test.ts:73`; `core/validation/gestao-schemas.test.ts` (bounds); `web/pages/admin/finance/ExpensesTab.test.tsx:154`, `:178` | ✅ |
| GES-12 | 422 `VALIDATION_FAILED`, `details[0].path = "categoryId"` | `finance-expenses.int.test.ts:104` (inactive and unknown) | ✅ |
| GES-13 | update / soft delete with before/after audit, excluded from reports | `finance-expenses.int.test.ts:138`, `:161`; report exclusion: `api/modules/finance/dre-xlsx.int.test.ts:76` and `finance-report.int.test.ts` fail when the `isNull(expenses.deletedAt)` filter (`finance-report.service.ts:238`) is removed (sensor A18, 6 tests red) | ✅ |
| GES-14 | one child per due occurrence ≤ today, day clamped, idempotent | `api/jobs/recurring-expenses.int.test.ts:63` (month-end clamp, never ahead), `:88`, `:101` (re-run no duplicates); `core/finance/report.test.ts:265`; `api/db/gestao-constraints.int.test.ts:134` (unique `(recurrence_parent_id, date)` 23505); daily trigger `recurring-expenses` declared in `neon.ts` and asserted in `api/neon.test.ts:41` (`42a920a`) | ✅ |
| GES-15 | recurrence `none` stops children, existing kept | `recurring-expenses.int.test.ts:119`; `report.test.ts:294` | ✅ |
| GES-16 | private bucket `expense-attachments`, key/name/content type set | `finance-expenses.int.test.ts:234`, `:258` (replace deletes previous after commit); `ExpensesTab.test.tsx:178` | ✅ |
| GES-17 | 413 `PAYLOAD_TOO_LARGE` > 5 MiB; 415 `UNSUPPORTED_MEDIA_TYPE` type/magic | `api/lib/storage.test.ts:94`, `:105`, `:113` (exactly 5 MiB accepted, +1 byte 413), `:128`; `finance-expenses.int.test.ts:278` | ✅ |
| GES-18 | 302 to presigned URL valid 300 s; object never public | `finance-expenses.int.test.ts:303` (`status 302`, `expires = '300'`); bucket `expense-attachments: { access: 'private' }` asserted in `api/neon.test.ts:99` (`42a920a`) | ✅ |
| GES-19 | category create/rename/reorder/deactivate with audit; 409 `CONFLICT` case-insensitive | `finance-expenses.int.test.ts:341`, `:373`; `gestao-constraints.int.test.ts:166`; `web/features/admin-finance/CategoriesDrawer.test.tsx` | ✅ |
| GES-20 | manual receipt 201 + audit `manual_receipt.create` | `api/routes/admin/finance-receipts.int.test.ts:57`, `:90` (422 cases); `web/pages/admin/finance/ReceiptsTab.test.tsx:106` | ✅ |
| GES-21 | delete needs 5..500 char justification (422) then `deleted_at` + audit with justification | `finance-receipts.int.test.ts:129`; `ReceiptsTab.test.tsx:176`, `:194`. The AC's own wording passes; its consequence for the reports (a deleted receipt leaves Financeiro and the DRE, as GES-13 states for expenses) is untested: sensor A19 survived → F2 | ✅ (report side → F2) |

### P1 Financeiro overview

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-22 | one bucket per period, 7 fields, range totals, per-category breakdowns | `core/finance/report.test.ts:79`, `:140`; `finance-report.int.test.ts:48`, `:82`, `:155` | ✅ |
| GES-23 | ISO weeks Mon–Sun, calendar months/quarters, clipped edges | `report.test.ts:42`, `:53` (2026-W53), `:60`, `:68`; `finance-report.int.test.ts:155` | ✅ |
| GES-24 | previous equal-length range ending day before `from`; deltas; 1-decimal %; `null` when previous 0 | `report.test.ts:155`, `:166`, `:172`; `finance-report.int.test.ts:99`, `:155` | ✅ |
| GES-25 | 422 for reversed range or > 731 days | `finance-report.int.test.ts:181`; `core/validation/gestao-schemas.test.ts`; web `FinanceOverviewPage.test.tsx:222`, `:231` | ✅ |
| GES-26 | default Caixa, month, last 6 months; tiles with delta | `web/pages/admin/finance/FinanceOverviewPage.test.tsx:63` (Caixa checked, `month`, `2026-05-01`..`2026-10-26`), `:82`, `:93` (`+28,6%`, `vs. 03/11/2025–30/04/2026`) | ✅ |
| GES-27 | SVG chart with legend + screen-reader table | `web/components/ui/EvolutionChart.test.tsx:31`, `:45`, `:56`, `:86`; `FinanceOverviewPage.test.tsx:114` | ✅ |
| GES-28 | refetch on change, selection in URL, export uses it | `FinanceOverviewPage.test.tsx:170`, `:196`, `:209`, `:311` | ✅ |

### P1 DRE export

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-29 | 200, xlsx content type, `dre-<regime>-<from>-<to>.xlsx` | `api/modules/finance/dre-xlsx.int.test.ts:76` (`Content-Type`, `Content-Disposition`) | ✅ |
| GES-30 | one column per month `mmm/aaaa` pt-BR + `Total`; mid-month partial | `dre-xlsx.int.test.ts:76` (header row), `:171`; `report.test.ts:192`, `:256` | ✅ |
| GES-31 | the 7 lines in order, sub-rows; "Outras receitas" only non-zero | `dre-xlsx.int.test.ts:76` (label list), `report.test.ts:192`, `:224` | ✅ |
| GES-32 | numeric BRL, deductions negative, line 5 = 1+2+3+4, line 7 = 5+6 per column | `dre-xlsx.int.test.ts:76` (cents per column, per-column sum loop, `BRL_FORMAT`); `report.test.ts:240` | ✅ |
| GES-33 | `Total` column = summary totals, same from/to/regime | `dre-xlsx.int.test.ts:149` (both regimes) | ✅ |
| GES-34 | header rows: clinic, regime label, `dd/mm/aaaa a dd/mm/aaaa`, local timestamp | `dre-xlsx.int.test.ts:171` | ✅ |

### P1 Payment gateway configuration

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-35 | adapters with descriptors, flags, `webhookUrl`, never a secret | `api/routes/admin/integrations-gateway.int.test.ts:87`; `web/pages/admin/integrations/PaymentsTab.test.tsx:61` | ✅ |
| GES-36 | AES-256-GCM ciphertext, hint `••••`+last 4, empty keeps stored, audit without secrets | `integrations-gateway.int.test.ts:174`, `:216`, `:240`; `PaymentsTab.test.tsx:98` | ✅ |
| GES-37 | credential check 10 s timeout; 200 `{ ok, message }`, `ok:false` pt-BR on rejection/timeout | `integrations-gateway.int.test.ts:264`, `:271` (401 → ok false), `:298` (timeout → ok false); 10 s value: `api/modules/integrations/gateway-config.service.ts:36` (code path) | ✅ (10 s: code path, F5) |
| GES-38 | sets `payment.active_gateway`, audit, existing charges keep provider | `integrations-gateway.int.test.ts:349`; `PaymentsTab.test.tsx:195` | ✅ |
| GES-39 | 422 `POLICY_VIOLATION` unconfigured / disabled | `integrations-gateway.int.test.ts:319`; `PaymentsTab.test.tsx:188` | ✅ |
| GES-40 | one `subscription.card_reregister` per affected subscription, deduped per switch | `integrations-gateway.int.test.ts:349` | ✅ |
| GES-41 | banner "Pagamentos em modo de teste" in production with sandbox/test env | `integrations-gateway.int.test.ts:136` (`NEON_BRANCH: 'production'` → `productionWarning`); `PaymentsTab.test.tsx:227`, `:233` | ✅ |

### P1 Calendar feeds and .ics files

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-42 | URL `${APP_BASE_URL}/api/ics/<token>.ics` once, SHA-256 + 6-char prefix, revoke previous, audit | `api/routes/ics.int.test.ts:117` (`URL_PATTERN` `:25`, hash, prefix, token absent from rows/audit), `:168`, `:182`; `gestao-constraints.int.test.ts:97`, `:109`; `web/pages/admin/integrations/CalendarTab.test.tsx:62`, `:72` | ✅ |
| GES-43 | revoke: `revoked_at`, audit, URL 404 | `ics.int.test.ts:208`, `:168` | ✅ |
| GES-44 | allowed statuses + active blocks, window −90..+180, room filter, SUMMARY formats | `ics.int.test.ts:255` (`'Joana · Sala Principal'`, `'Manutenção · Sala Secundária'`, cancelled/expired excluded), `:329` (window edges included, room scope) | ✅ |
| GES-45 | tenant creates/regenerates single active personal feed, URL once | `ics.int.test.ts:351`, `:400`; `web/features/calendar-sync/CalendarSyncCard.test.tsx:27`, `:71`; `e2e/mvp-journey.spec.ts:174` | ✅ |
| GES-46 | own bookings, 4 statuses, −30..+180, SUMMARY `Bravô Clinic · <sala>` | `ics.int.test.ts:351` (`'Bravô Clinic · Sala Secundária'`, hidden statuses absent) | ✅ |
| GES-47 | RFC 5545: CRLF, 75-octet folding, escaping, VERSION/PRODID/CALSCALE, UID, SEQUENCE, DTSTAMP, UTC | `api/lib/ics-serializer.test.ts:21`, `:32`, `:54`, `:69` (`DTSTART:20261027T130000Z`), `:80`; `ics.int.test.ts:255` | ✅ |
| GES-48 | no buffer event, no other customer data, no amounts | `ics.int.test.ts:255` (8 VEVENTs only, buffer comment `:321`, `not.toMatch(/R\$|12345|123,45/)`, no e-mail), `:351` (`not.toContain('Locatário')`) | ✅ |
| GES-49 | reschedule: same UID, new times, SEQUENCE +1; cancel: absent | `ics.int.test.ts:417`; `e2e/mvp-journey.spec.ts:157-187` | ✅ |
| GES-50 | owner `.ics` PUBLISH one VEVENT / CANCEL + `STATUS:CANCELLED`; other user 404 | `ics.int.test.ts:503`; `ics-serializer.test.ts:105`, `:126`; `api/routes/app/bookings-reads.int.test.ts:245` (404) | ✅ |
| GES-51 | > 60/h → 429 + `Retry-After` | `ics.int.test.ts:477` (61st request) | ✅ |
| GES-52 | malformed/unknown/revoked → same 404 | `ics.int.test.ts:457`; anonymized user's feed 404 `api/routes/app/privacy.int.test.ts:399` | ✅ |

### P1 MCP server

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-53 | `bmcp_` + 43 base64url once, hash + prefix, audit `mcp_token.issue` | `api/routes/mcp.int.test.ts:67`, `:100`; `web/pages/admin/integrations/McpTab.test.tsx:132`, `:142`, `:156` | ✅ |
| GES-54 | never raw tokens; revoke sets `revoked_at` + audit | `mcp.int.test.ts:123`; `McpTab.test.tsx:205` | ✅ |
| GES-55 | `mcp.enabled` false → 404 `FEATURE_DISABLED` | `mcp.int.test.ts:205` | ✅ |
| GES-56 | 401 `UNAUTHENTICATED` missing/unknown/revoked/expired/demoted owner | `mcp.int.test.ts:215` | ✅ |
| GES-57 | design catalog; read tokens see read tools only | `api/mcp/tools/catalog.int.test.ts:122` (`toEqual(DESIGN_TABLE)` with scope/destructive flags), `:148`; `e2e/admin-config.spec.ts:206-209` | ✅ |
| GES-58 | read token + write tool → tool error `FORBIDDEN`, nothing changed | `catalog.int.test.ts:160` | ✅ |
| GES-59 | destructive without `confirm: true` → `CONFIRMATION_REQUIRED` + pt-BR preview, nothing changed | `catalog.int.test.ts:180`, `:235` | ✅ |
| GES-60 | over `mcp.rate_limit_per_minute` → 429 `TOO_MANY_ATTEMPTS` + `Retry-After` | `mcp.int.test.ts:246` | ✅ |
| GES-61 | audit row origin `mcp`, action `mcp.<tool>`, actor owner, entity token; service audit with origin mcp | `mcp.int.test.ts:290`; `catalog.int.test.ts:202`, `:327` | ✅ |
| GES-62 | schema failure → tool error `VALIDATION_FAILED` with pt-BR field messages | `catalog.int.test.ts:271` | ✅ |
| GES-63 | tab: server URL (`API_FUNCTION_URL` + `/mcp` or proxied + warning), enabled, catalog, tokens | `mcp.int.test.ts:153`, `:183`; `McpTab.test.tsx:70`, `:79`, `:89` | ✅ |
| GES-64 | `last_used_at` at most once per minute | `mcp.int.test.ts:269` | ✅ |

### P1 Notification e-mails

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-65 | lower-cased, active; 409 duplicate; 422 `POLICY_VIOLATION` at 11th | `api/routes/admin/integrations-notifications.int.test.ts:37`, `:64`, `:79`; `web/pages/admin/integrations/EmailsTab.test.tsx:158`, `:185` | ✅ |
| GES-66 | 7 toggle keys stored; unknown key 422 | `integrations-notifications.int.test.ts:113`; `core/notifications/catalog.test.ts`; `EmailsTab.test.tsx:119`, `:132` | ✅ |
| GES-67 | one `staff.<event>` per active recipient, dedupe `staff:<event>:<entityId>:<recipientId>`, caller's transaction | `api/modules/notifications/notifications.service.int.test.ts:90` (dedupe key, repeat none), `:205` (rollback → no row) | ✅ |
| GES-68 | toggle off → nothing | `notifications.service.int.test.ts:115`; `api/modules/notifications/staff-port.int.test.ts:440` | ✅ |
| GES-69 | 7 trigger points emit their events | `staff-port.int.test.ts:151` (payment_received + new_booking), `:204`, `:226`, `:255`, `:284` (booking_cancelled), `:306` (pre_reservation_expired), `:338` (new_subscription), `:372` (renewal_failed), `:419` (new_quote_request) | ✅ |
| GES-70 | `system.test` to every active recipient or given address; final statuses; 6th in an hour 429 | `integrations-notifications.int.test.ts:155`, `:191`, `:201`; `EmailsTab.test.tsx:230`, `:245`, `:259` | ✅ |
| GES-71 | last 30 days, fields, status filter, no HTML | `integrations-notifications.int.test.ts:221`, `:275`; `EmailsTab.test.tsx:277`, `:297` | ✅ |
| GES-72 | `email-retry` every 5 min: failed attempts < 5 within 48 h, pending > 5 min | `api/jobs/maintenance.int.test.ts:93`, `:114`, `:226`; schedule `*/5 * * * *` asserted in `api/neon.test.ts:41` (`42a920a`) | ✅ |
| GES-73 | pt-BR template per gestao catalog event, no emoji, absolute links on `APP_BASE_URL` | `api/emails/templates/gestao.test.ts:84`, `:90` (`it.each` over every template), `:103`, `:124` | ✅ |
| GES-74 | exact "Provedor de e-mail não configurado — mensagens ficam registradas no histórico" | `EmailsTab.test.tsx:101`; `integrations-notifications.int.test.ts:137` | ✅ |

### P1 Web push

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-75 | `vapidPublicKey`, `null` when unset | `api/routes/app/push.int.test.ts:163`, `:170` | ✅ |
| GES-76 | upsert by endpoint, reassign, 201; https ≤ 1000, base64url keys | `push.int.test.ts:46`, `:63`, `:91`; `gestao-schemas.test.ts` | ✅ |
| GES-77 | delete by endpoint → 204 | `push.int.test.ts:123`, `:136` | ✅ |
| GES-78 | after commit, `{ title, body, url, tag }` ≤ 3 KB to each subscription | `notifications.service.int.test.ts:157`, `:198` (3 KB), `:205` (rollback → no push) | ✅ |
| GES-79 | 404/410 delete; other failures count, delete at 5 | `notifications.service.int.test.ts:249`, `:260` | ✅ |
| GES-80 | success → `last_success_at`, `failure_count` 0 | `notifications.service.int.test.ts:277` | ✅ |
| GES-81 | no VAPID → no push, request still succeeds | `notifications.service.int.test.ts:223` | ✅ |
| GES-82 | SW shows title/body/brand icon; click focuses or opens URL | `web/pwa/push-sw.test.ts:51`, `:104`, `:114`, `:134` | ✅ |
| GES-83 | Ativar/Desativar; pt-BR explanations for unsupported / denied / iOS outside PWA | `web/pages/app/NotificationSettingsPage.test.tsx:120`, `:142`, `:183`, `:192`, `:201`, `:216` | ✅ |

### P1 Extra services catalog and online add-on

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-84 | create/edit with bounds, audit `extra_service.create`/`update` | `api/routes/admin/extra-services.int.test.ts:44`, `:122`; `web/pages/admin/extras/ExtrasAdminPage.test.tsx:131`, `:162` | ✅ |
| GES-85 | `online` + null price → 422 on `referencePriceCents` | `extra-services.int.test.ts:81`; `ExtrasAdminPage.test.tsx:100` | ✅ |
| GES-86 | public: active, display order, public fields | `extra-services.int.test.ts:140` | ✅ |
| GES-87 | `/servicos-extras` "R$ 80,00/h", "R$ X/projeto", "Sob consulta", quote form | `web/pages/public/ExtrasPage.test.tsx:25`, `:40` | ✅ |
| GES-88 | frozen unit price × qty added before deposit split, `booking_extra_items`, summary lines | `api/modules/extras/extras-step.int.test.ts:74` (total 32000, deposit on new total), `:122`, `:209`; `web/features/extras/ExtrasAddonPicker.test.tsx:61`, `:148` | ✅ |
| GES-89 | inactive / quote mode / qty out of range → 422 | `extras-step.int.test.ts:142`, `:162`, `:191` | ✅ |

### P1 Quote request funnel

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-90 | 201, status `new`, session user linked | `api/routes/admin/quote-requests.int.test.ts:91`, `:115`; `web/features/extras/QuoteRequestForm.test.tsx:45`, `:62` | ✅ |
| GES-91 | foreign/no-session booking → 422 on `bookingId` | `quote-requests.int.test.ts:133`; `QuoteRequestForm.test.tsx:207` | ✅ |
| GES-92 | > 5/h/IP → 429 `TOO_MANY_ATTEMPTS` | `quote-requests.int.test.ts:167` | ✅ |
| GES-93 | honeypot → 202, nothing stored | `quote-requests.int.test.ts:181`; `QuoteRequestForm.test.tsx:163` | ✅ |
| GES-94 | emit `new_quote_request`; `quote.received` when e-mail given | `quote-requests.int.test.ts:193`, `:218` | ✅ |
| GES-95 | **only** `new → contacted → quote_sent → won\|lost` and non-terminal → `lost`; guarded; audit; else 409 `INVALID_TRANSITION` | `quote-requests.int.test.ts:246` (every valid move), `:279` (refuses `won → contacted`, `lost → new` and one skipped step `new → won`), `:301` (concurrent: one 200, one 409); `ExtrasAdminPage.test.tsx:250`, `:291`. The "only" half is not discriminated: allowing `new → quote_sent` (sensor A7) leaves all 15 tests green | ⚠️ PARTIAL → F1 |
| GES-96 | newest first, status filter, fields, notes ≤ 2000 editable | `quote-requests.int.test.ts:342`, `:315`; `ExtrasAdminPage.test.tsx:308`, `:336` | ✅ |
| GES-97 | `/app/orcamentos` only own requests with labels | `quote-requests.int.test.ts:389`; `web/pages/app/QuotesPage.test.tsx:11` | ✅ |
| GES-98 | Home modal posts, shows "Pedido enviado. Retornaremos em breve.", WhatsApp secondary | `web/pages/public/home/ExtrasSection.test.tsx:76`, `:102`; `QuoteRequestForm.test.tsx:77` | ✅ |

### P1 Clientes

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-99 | search name/e-mail/doc/phone digits, 50/page cursor, no deleted | `api/routes/admin/customer-profiles.int.test.ts:54`, `:83`; `web/pages/admin/customers/CustomersPage.test.tsx:28`, `:89` | ✅ |
| GES-100 | profile + every section | `customer-profiles.int.test.ts:110`, `:233`; `web/pages/admin/customers/CustomerDetailPage.test.tsx:79`, `:104` | ✅ |
| GES-101 | notes ≤ 4000, audit `customer.notes` (admin + reception) | `customer-profiles.int.test.ts:279`; `CustomerDetailPage.test.tsx:199`, `:213` | ✅ |
| GES-102 | reception profile edit 403; admin edit saved + audit `customer.update` | `customer-profiles.int.test.ts:279`, `:308`; `CustomerDetailPage.test.tsx:190`, `:227` | ✅ |

### P1 Salas admin

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-103 | create/edit with bounds, unique slug, audit | `api/routes/admin/rooms.int.test.ts:95`, `:124`; `web/pages/admin/rooms/RoomEditPage.test.tsx:72`, `:181` | ✅ |
| GES-104 | 409 `ROOM_HAS_FUTURE_COMMITMENTS` with codes / subscription ids, room stays active | `rooms.int.test.ts:163`, `:198`; `RoomEditPage.test.tsx:136` | ✅ |
| GES-105 | both variants verified in `room-photos`, key `rooms/<roomId>/<uploadId>`, audit | `rooms.int.test.ts:236`, `:272` (missing variant → 422, nothing inserted); `web/features/admin-rooms/PhotoManager.test.tsx:115` | ✅ |
| GES-106 | non-WebP 415, > 5 MiB 413, 13th photo 422 | `rooms.int.test.ts:259`, `:293`; `storage.test.ts:113`; `PhotoManager.test.tsx:234` | ✅ |
| GES-107 | reorder / cover / alt / delete with audit, one cover, objects deleted after commit | `rooms.int.test.ts:324`, `:350`, `:371`; `PhotoManager.test.tsx:252`, `:267`, `:294`, `:329` | ✅ |
| GES-108 | `/media/<key>-<variant>.webp`; `Cache-Control: public, max-age=31536000, immutable` | `rooms.int.test.ts:236` (`cacheControl` exact), `:386`; `core/media/room-photo-url.test.ts`; `apps/web/scripts/write-redirects.test.mjs` | ✅ |
| GES-109 | browser resizes to WebP large ≤ 1600 / small ≤ 800, progress | `web/features/admin-rooms/prepare-photo.test.ts:64`, `:98`, `:110`; `PhotoManager.test.tsx:151` | ✅ |

### P1 Usuários and audit log

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-110 | staff with name, e-mail, role, status, 2FA flag, last login | `api/routes/admin/users.int.test.ts:36`; `web/pages/admin/users/UsersPage.test.tsx:63` | ✅ |
| GES-111 | invite (no password, 72 h set-password, `staff.invite`, audit); tenant promote `user.role_change`; staff 409 | `users.int.test.ts:72`, `:112`; `UsersPage.test.tsx:232`, `:251` | ✅ |
| GES-112 | role change / disable / enable revoke sessions, audit before/after | `users.int.test.ts:145`, `:166`; `UsersPage.test.tsx:144`, `:161` | ✅ |
| GES-113 | own account 422 `POLICY_VIOLATION`; last admin 409 `LAST_ADMIN` | `users.int.test.ts:195`, `:212`; `UsersPage.test.tsx:111`, `:125` | ✅ |
| GES-114 | TOTP reset with 5..500 justification: delete `user_totp`, revoke, audit | `users.int.test.ts:231`; `UsersPage.test.tsx:185` | ✅ |
| GES-115 | filters, newest first, ≤ 100/page cursor, actor name/role | `users.int.test.ts:293`, `:328`, `:346`; `web/pages/admin/audit/AuditPage.test.tsx:46`, `:121` | ✅ |
| GES-116 | detail: date, user, origin label (Web, App, Admin, MCP, Job, Sistema), action, entity, justification, before/after | `AuditPage.test.tsx:183` (MCP), `:46` (Web, Job); labels App/Admin/Sistema: `web/features/admin-audit/labels.ts:2-9` (code path) | ✅ (3 labels code path, F6) |

### P1 Reception restrictions end-to-end

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-117 | 403 `FORBIDDEN` on every non-allowlisted `/admin/*` | `api/routes/admin/access-sweep.int.test.ts:228`, `:246`, `:262` | ✅ |
| GES-118 | every mounted `/admin/*` route classified; unclassified fails | `access-sweep.int.test.ts:210` | ✅ |
| GES-119 | web 403 page outside `reservas`/`clientes`; nav shows only the two | `web/router.test.tsx:147` (`it.each` over 6 paths), `:156` (nav links `['Gestão de Reservas', 'Clientes']`), `:173` | ✅ |
| GES-120 | every `/admin/integrations/*` incl. MCP token creation → 403 | `access-sweep.int.test.ts:246`; `mcp.int.test.ts:183`; `integrations-gateway.int.test.ts:439`; `ics.int.test.ts:233` | ✅ |

### P1 LGPD self-service

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-121 | JSON attachment `bravo-meus-dados-<date>.json` with all sections; audit `user.data_export` | `api/routes/app/privacy.int.test.ts:140` (`Content-Disposition`, section keys, push endpoint origin only, audit) | ✅ |
| GES-122 | no password hashes, TOTP secrets, recovery codes, token hashes, card tokens | `privacy.int.test.ts:140` (forbidden-key loop `:178-192`, `not.toContain('card_tok_123')` `:194`) — untagged, traced by content | ✅ |
| GES-123 | 4th export in 24 h → 429 `TOO_MANY_ATTEMPTS` | `privacy.int.test.ts:199` | ✅ |
| GES-124 | anonymize, revoke sessions, clear cookie, `privacy.account_deleted`, audit, 200 | `privacy.int.test.ts:337`, `:404` (`EXCLUIR`); `web/pages/app/PrivacyPage.test.tsx:141`, `:164` | ✅ |
| GES-125 | blockers → 409 `HAS_ACTIVE_COMMITMENTS` with list, nothing changed | `privacy.int.test.ts:251`, `:271`, `:291`; `PrivacyPage.test.tsx:189` | ✅ |
| GES-126 | wrong password/text → 401 `INVALID_CREDENTIALS`, nothing changed | `privacy.int.test.ts:313`; `PrivacyPage.test.tsx:223` | ✅ |
| GES-127 | admin anonymize with 5..500 justification, same blockers/effects; reception 403 | `privacy.int.test.ts:418`, `:451`; `CustomerDetailPage.test.tsx:262`, `:283` | ✅ |
| GES-128 | `/app/perfil/privacidade`: consents, "Baixar meus dados", "Excluir minha conta" with modal | `PrivacyPage.test.tsx:53`, `:85`, `:127` | ✅ |
| GES-129 | weekly retention: thresholds, blank bodies > 180 days, counts in `job_runs.stats` | `maintenance.int.test.ts:132`, `:226`; weekly trigger `retention` asserted in `api/neon.test.ts:41` (`42a920a`) | ✅ |

### P1 Holiday jobs

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-130 | on reminder date, `staff.holiday_review` to every active admin, dedupe per year; else nothing | `api/jobs/holidays.int.test.ts:51`, `:68`, `:77` | ✅ |
| GES-131 | weekly BrasilAPI import current + next year, missing dates only, `brasilapi`, `is_closed = false` | `holidays.int.test.ts:102`, `:124` | ✅ |
| GES-132 | failure / 10 s timeout / bad shape → year unchanged, other year processed, error in `job_runs` | `holidays.int.test.ts:145`, `:167`, `:184`; 10 s value: code path `api/modules/calendar/holiday-import.ts:11` (`TIMEOUT_MS = 10_000`, used as `AbortSignal.timeout` at `:30`) | ✅ (10 s: code path, F5) |

### P1 Analytics funnel

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-133 | unset provider → no script, `track()` no-op | `web/lib/analytics.test.tsx:48`, `:59`, `:69` | ✅ |
| GES-134 | script after `load`, cookieless (`persistence: 'memory'`, `client_storage: 'none'`) | `analytics.test.tsx:80`, `:92`, `:131` | ✅ |
| GES-135 | the 8 funnel events, whitelisted props only | `analytics.test.tsx:182`, `:203`, `:266`; funnel points `web/components/layout/PublicLayout.test.tsx:100` (`page_view`), `web/pages/public/rooms/RoomsPage.test.tsx` (`view_room`), `web/features/booking/BookingFlowPage.test.tsx:149` (`select_slot`), `web/features/booking/SummaryStep.test.tsx:255` (`begin_checkout`), `web/pages/public/CheckoutPage.test.tsx` (`purchase`), `web/pages/public/SubscribePage.test.tsx:339`, `web/features/extras/QuoteRequestForm.test.tsx:129`, `web/pages/auth/SignupPage.test.tsx:100` | ✅ |
| GES-136 | no event under `/admin` | `analytics.test.tsx:232`, `:239`, `:248` | ✅ |

### P2 Free-tier usage panel

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-137 | DB bytes, bucket bytes, e-mails month/today, 10 largest tables, limits and % | `api/routes/admin/usage.int.test.ts:63`; `web/pages/admin/integrations/UsageTab.test.tsx:22`, `:42`; `core/settings/catalog.test.ts` (`usage.limits` defaults) | ✅ |
| GES-138 | at 80 % of a limit → `warning: true`, tab highlights | `usage.int.test.ts:107` (asserts 90 % and > 100 % only); `UsageTab.test.tsx:55`, `:67` (web renders the API flag). The 80 % threshold itself (`api/modules/usage/usage.service.ts:12`) is not discriminated: 90 % instead of 80 % (sensor A12) leaves the API tests green | ⚠️ PARTIAL → F3 |
| GES-139 | storage listing fails → storage `null` + `storageError`, other figures kept | `usage.int.test.ts:138`; `UsageTab.test.tsx:76` | ✅ |

### P1 MVP hardening and production release

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| GES-140 | 390×844 journey through sandbox payment, "Confirmada", `.ics` UID = `ics_uid`, reschedule SEQUENCE + 1, personal feed new time | `e2e/mvp-journey.spec.ts:41` (`viewportSize` 390×844 `:44`; "Confirmada" `:125`; UID/SEQUENCE 0 `:134`; reschedule UID/SEQUENCE 1 `:159-172`; feed `SUMMARY 'Bravô Clinic · Sala Terceira'`, new `DTSTART` `:184`); project viewport `apps/web/playwright.config.ts:45`. Read, not re-run; passed 16/16 on `main` at 02:21 2026-10-28 per the orchestrator | ✅ |
| GES-141 | admin e2e: TOTP login, price change, expense with PDF, DRE 7 lines, clinic ICS VCALENDAR, MCP token `tools/list`, revoke | `e2e/admin-config.spec.ts:73` (price `:92-93`, PDF attachment `:109-131`, DRE lines `:151`, feed `:169-179`, `tools/list` `:199-209`, revoked → 401 `:218`). Read, not re-run; same orchestrator run | ✅ |
| GES-142 | axe zero WCAG 2.1 A/AA violations on 13 pages × 2 themes | T47 in progress | ⏸ pending |
| GES-143 | Lighthouse mobile LCP ≤ 2500 ms, CLS ≤ 0.1, a11y ≥ 0.95 | T48 in progress | ⏸ pending |
| GES-144 | production migration, buckets, triggers, smoke exit 0 | T49–T50 in progress; code prep `42a920a` (`neon.ts` buckets + 5 gestao triggers, `api/neon.test.ts:41`, `:99`) seen but release not run | ⏸ pending |

**Status**: 139/141 in-scope ACs matched the spec outcome; 2 PARTIAL (GES-95 → F1, GES-138 → F3); 3 GES ACs pending (T47–T50); no spec-precision gap that the spec itself leaves open (two timeouts and three labels rest on constants, F5–F6)

---

## Discrimination Sensor

Sensor depth: P0 (money reports, auth/scope, LGPD, state transitions): 28 manual behavior-level mutants, run at `42a920a` after every suite had finished. Each mutant was applied by `node_modules/.cache/verify/sensor.mjs` (outside git; requires exactly one textual match), the named test files ran with `vitest run` (API files on `gestao_ver_hmuv87_1`), the file was restored with `git checkout -- <file>`, and `git status --porcelain` was compared with the baseline after every mutant (unchanged every time; empty before and after the whole run). Killed = a named test failed on an `AssertionError` (checked in each `mutant-<id>.log`). A6 first crashed with a Node out-of-memory error (host memory pressure, not a kill); it was re-run alone and killed on an assertion.

| # | File:line | Mutation | Tests run | Result |
| - | --------- | -------- | --------- | ------ |
| C1 | `core/finance/recognition.ts:108` | leftover cents to the latest days | `finance/recognition.test.ts`, `finance/report.test.ts` | ✅ Killed (3 failed: `:87` split, `:165` Nov 595466 ≠ 595467) |
| C2 | `core/finance/recognition.ts:124` | subscription-paid bookings produce revenue | `recognition.test.ts` | ✅ Killed (`:253`, expected `[]`) |
| C3 | `core/finance/report.ts:142` | net revenue ignores fees (line 4) | `report.test.ts`, `recognition.test.ts` | ✅ Killed (`:79`) |
| C4 | `core/finance/report.ts:201` | previous range ends on `from` | `report.test.ts` | ✅ Killed (`:155`) |
| C5 | `core/finance/report.ts:219` | `deltaPercent` 0 instead of `null` | `report.test.ts` | ✅ Killed (`:140`, `:166`) |
| C6 | `core/finance/report.ts:304` | DRE line 7 ignores line 6 | `report.test.ts` | ✅ Killed (`:192`, `:240`; 63960 ≠ −181040) |
| C7 | `core/finance/report.ts:322` | recurrence day clamped to 30 | `report.test.ts` | ✅ Killed (`:265`, `2026-02-30` ≠ `2026-02-28`) |
| W1 | `web/lib/analytics.ts:66` | `/admin/*` sub-paths tracked | `lib/analytics.test.tsx` | ✅ Killed (3 failed, `:232`, `:239`, `:248`) |
| W2 | `web/features/admin-finance/period.ts:22` | default range 7 months | `FinanceOverviewPage.test.tsx` | ✅ Killed (6 failed, `:63` `2026-04-01` ≠ `2026-05-01`) |
| A1 | `api/modules/ics/ics-feed.service.ts:31` | clinic feed drops `no_show` | `routes/ics.int.test.ts` | ✅ Killed (`:255`, 7 ≠ 8 events) |
| A2 | `api/modules/ics/ics-feed.service.ts:20` | feed limit 61/h | `routes/ics.int.test.ts` | ✅ Killed (`:477`, 200 ≠ 429) |
| A3 | `api/modules/mcp/mcp-token.service.ts:124` | expired MCP tokens authenticate | `routes/mcp.int.test.ts` | ✅ Killed (`:215`, expired → 200) |
| A4 | `api/mcp/server.ts:173` | read tokens call write tools | `mcp/tools/catalog.int.test.ts` | ✅ Killed (`:160`) |
| A5 | `api/mcp/server.ts:124` | destructive tools run without `confirm` | `catalog.int.test.ts` | ✅ Killed (`:180`, `:235`) |
| A6 | `api/modules/privacy/privacy.service.ts:342` | pending charges no longer block deletion | `routes/app/privacy.int.test.ts` | ✅ Killed on re-run (`:291`, 200 ≠ 409 `HAS_ACTIVE_COMMITMENTS`) |
| A7 | `api/modules/extras/quote-requests.service.ts:183` | funnel allows `new → quote_sent` | `routes/admin/quote-requests.int.test.ts` | ❌ **Survived** (15/15 passed) → F1 |
| A8 | `api/modules/users/staff-users.service.ts:167` | `LAST_ADMIN` guard removed | `routes/admin/users.int.test.ts` | ✅ Killed (`:212`, 422 ≠ 409 `LAST_ADMIN`) |
| A9 | `api/modules/notifications/notifications.service.ts:125` | staff toggles ignored | `notifications.service.int.test.ts` | ✅ Killed (`:115`) |
| A10 | `api/lib/push.ts:110` | push 404 no longer prunes | `notifications.service.int.test.ts` | ✅ Killed (`:249`) |
| A11 | `api/routes/admin/index.ts:41` | reception reaches `/finance/*` | `routes/admin/access-sweep.int.test.ts` | ✅ Killed (`:246`) |
| A12 | `api/modules/usage/usage.service.ts:12` | warning at 90 % instead of 80 % | `routes/admin/usage.int.test.ts` | ❌ **Survived** (4/4 passed) → F3 |
| A13 | `api/lib/storage.ts:42` | limit 5 MiB + 1 | `lib/storage.test.ts` | ✅ Killed (`:113`, `:128`, 200 ≠ 413) |
| A14 | `api/modules/integrations/gateway-config.service.ts:288` | disabled provider can be activated | `integrations-gateway.int.test.ts` | ✅ Killed (`:319`, 200 ≠ 422) |
| A15 | `api/routes/admin/customer-profiles.ts:73` | reception edits the profile | `customer-profiles.int.test.ts` | ✅ Killed (`:279`) |
| A16 | `api/lib/ics.ts:29` | fold at 76 octets | `lib/ics-serializer.test.ts` | ✅ Killed (`:54`, 76 > 75) |
| A17 | `api/jobs/recurring-expenses.ts:55` | `.onConflictDoNothing()` removed | `jobs/recurring-expenses.int.test.ts` | ⚪ Survived, **equivalent** (5/5 passed; see Note under Findings) |
| A18 | `api/modules/finance/finance-report.service.ts:238` | reports count soft-deleted expenses | `finance-report.int.test.ts`, `dre-xlsx.int.test.ts`, `finance-expenses.int.test.ts` | ✅ Killed (6 failed, `dre-xlsx:76` 91293 ≠ 92292) |
| A19 | `api/modules/finance/finance-report.service.ts:226` | reports count soft-deleted manual receipts | `finance-report.int.test.ts`, `dre-xlsx.int.test.ts`, `finance-receipts.int.test.ts` | ❌ **Survived** (17/17 passed) → F2 |

**Iteration 1 sensor outcome**: 24/28 killed (core 7/7, web 2/2, API 15/19); 1 equivalent (A17); 3 real survivors A7, A12, A19 → F1–F3 - FAIL ❌

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Gestao modules map 1:1 to design components; no extra features seen in the cited files |
| Surgical changes | ✅ Bridges into nucleo/receita go through ports (`staff-port.ts`, extensions registry) rather than edits of their services |
| Matches patterns | ✅ Same `AppError` envelope, `withTransaction`, `audit()` and `requireRole` patterns as fundacao/nucleo/receita |
| Spec-anchored outcome check | ✅ Asserted values match spec values (status codes, error codes, exact pt-BR strings, cents); two timeout values and three audit labels rest on constants (F5, F6); three state/threshold rules are not discriminated (F1–F3) |
| Per-layer Coverage Expectation | ✅ Core 1:1 with GES ids; every gestao route has happy + error + role tests (`access-sweep.int.test.ts` classifies every `/admin/*` route) |
| Every test maps to a spec requirement | ✅ 70 test files carry GES tags; untagged tests seen (e.g. `GET /app/me/consents`, list endpoints) serve listed ACs or design rows |
| Documented guidelines followed | ✅ `.specs/STATE.md` AD-010/AD-018/AD-029 (Vitest everywhere, serial API files against real Postgres, Playwright e2e) and the tasks.md Test Coverage Matrix |

---

## Edge Cases (spec.md:478-493)

- [x] Approved in one month, used in the next → Caixa vs Competência month: `recognition.test.ts:128`
- [x] Subscription period crossing the range edge → only in-range days: `recognition.test.ts:165` (Nov total 595467)
- [x] Refund whose charge predates the range → refund month: `report.test.ts:132`
- [x] Two admins regenerating the same clinic feed → one active, other 409 `CONFLICT`: partial unique index `gestao-constraints.int.test.ts:97` (23505) + generic 23505 → 409 `CONFLICT` mapping `api/lib/errors.ts:143-145` (code path; no concurrent HTTP test, F7)
- [x] Recurring-expenses interrupted/re-run → no duplicate child: `recurring-expenses.int.test.ts:101`, `gestao-constraints.int.test.ts:134`
- [x] Monthly expense on the 31st → month-end clamp: `report.test.ts:265`, `recurring-expenses.int.test.ts:63`
- [x] Concurrent quote moves → one 200, one 409 `INVALID_TRANSITION`: `quote-requests.int.test.ts:301`
- [x] Push endpoint reused by a new user → reassigned: `push.int.test.ts:63`
- [x] MCP destructive repeat after a state change → tool error 409 `INVALID_TRANSITION`: code path (`api/mcp/server.ts:95` maps any `AppError` to a tool error; nucleo cancel guard throws `INVALID_TRANSITION`); no test (F7)
- [x] DRE range starting mid-month → partial first column: `report.test.ts:256`, `dre-xlsx.int.test.ts:171`
- [x] Empty summary range → zero buckets, `null` percentages: `report.test.ts:140`, `finance-report.int.test.ts:155`
- [x] Attachment replaced → previous object deleted after commit: `finance-expenses.int.test.ts:258`; failed delete logged without failing: code path `api/modules/finance/expenses.service.ts:312` (no test, F7)
- [x] Photo registration with missing objects → 422, nothing inserted: `rooms.int.test.ts:272`
- [x] Anonymized user's personal feed → 404: `privacy.int.test.ts:399`
- [x] BrasilAPI holiday inserted open (`is_closed = false`): `holidays.int.test.ts:102`, `:124`
- [x] Emit inside a rolled-back transaction → no e-mail row, no push: `notifications.service.int.test.ts:205`

---

## Gate Check

All commands ran in the verifier worktree with `TEMP`, `TMP` and `npm_config_cache` under `node_modules/.cache` (drive C: is full). `npm install` exit 0.

| Gate | Command | Commit | Result |
| ---- | ------- | ------ | ------ |
| Typecheck | `npm run typecheck` | `86f1b96`, re-run `42a920a` | ✅ exit 0 at both commits (web, api, core) |
| Lint | `npm run lint` | `86f1b96`, re-run `42a920a` | ✅ exit 0 at both commits (`eslint .`, no output) |
| Core | `npm test -w packages/core` | `86f1b96`, re-run `42a920a` | ✅ 32 files, 1194 tests passed at both commits |
| Web | `npm test -w apps/web -- --maxWorkers=2` | `86f1b96` | ✅ 138 files, 1196 tests passed (`42a920a` changes only `neon.ts` and `apps/api/src/neon.test.ts`, which the web suite does not import) |
| API | `npm test -w apps/api` as `vitest run --shard=i/4`, each shard on its own database | `86f1b96` | ✅ 118 files, 1228 tests passed: shard 1 30 files/326 tests (2185 s), shard 2 30/294 (1980 s), shard 3 30/257 (1687 s), shard 4 28/351 (1568 s). No failures, no `ENOTFOUND`/`ECONNRESET` blips |
| API delta | `vitest run src/neon.test.ts` | `42a920a` | ✅ 1 file, 6 tests passed on `gestao_ver_hmuv87_1` (buckets `:99`, gestao triggers `:41`) |
| E2E | Playwright `apps/web/e2e` | — | Not re-run (ports used by other agents, per the brief). Specs read and cited above; T45/T46 passed 16/16 on `main` at 02:21 2026-10-28 per the orchestrator |

- **Skipped tests**: none reported by any suite.
- **Build gate** (`API_PROXY_ORIGIN=… npm run build`): not part of this brief's gate list; not run.
- **Host restart**: the first runs finished between 02:37 and 03:11 BRT (logs kept under `node_modules/.cache/verify/`); the restart killed only idle processes. After the fast-forward to `42a920a` the verifier re-ran typecheck, lint, core and the new API file before the sensor.

---

## Findings and Fix Plans

Ranked by severity. F1 and F2 are surviving mutants on P0 rules (state-transition integrity, money reports) and block the PASS; F3 is a surviving mutant on a P2 threshold; F4–F7 are non-blocking.

### F1 (Major): GES-95 "allow only" is not discriminated (sensor A7 survived)

- **Where**: `apps/api/src/modules/extras/quote-requests.service.ts:183-189` (`NEXT` table); test `apps/api/src/routes/admin/quote-requests.int.test.ts:279`
- **Failing scenario**: add `quote_sent` to `NEXT.new` (the funnel skips "Contatado"). All 15 tests of the file stay green, because `:279` refuses only `won → contacted`, `lost → new` and one skipped step `new → won`.
- **Fix task**: turn `:279` into an `it.each` over every disallowed `(from, to)` pair of the 5 statuses (e.g. `new → quote_sent`, `contacted → won`, `contacted → new`, `quote_sent → contacted`, `won → lost`, `lost → won`), each asserting `[409, 'INVALID_TRANSITION']`, the row unchanged and no `quote_request.status` audit. **Done when** mutant A7 (and its mirror `contacted: ['quote_sent', 'won', 'lost']`) fails the file.

### F2 (Major): reports would count deleted manual receipts (sensor A19 survived)

- **Where**: `apps/api/src/modules/finance/finance-report.service.ts:226` (`isNull(manualReceipts.deletedAt)`); tests `apps/api/src/modules/finance/finance-report.int.test.ts`, `dre-xlsx.int.test.ts`, `apps/api/src/routes/admin/finance-receipts.int.test.ts`
- **Failing scenario**: remove the filter. A receipt deleted with a justification (GES-21) keeps inflating line 1 of Financeiro and of the DRE; all 17 tests of the three files stay green because no report fixture contains a deleted receipt. The expense twin of this filter is covered (A18 killed, 6 tests red), so the gap is receipts only.
- **Fix task**: seed one soft-deleted manual receipt inside the range next to a live one in `finance-report.int.test.ts` (or `dre-xlsx.int.test.ts`) and assert the bucket and `Total` exclude it to the cent, in both regimes. **Done when** mutant A19 fails the file.

### F3 (Minor): GES-138 80 % threshold not discriminated at the API (sensor A12 survived)

- **Where**: `apps/api/src/modules/usage/usage.service.ts:12` (`WARNING_PERCENT = 80`); test `apps/api/src/routes/admin/usage.int.test.ts:107`
- **Failing scenario**: set the threshold to 90 %. The test asserts storage at exactly 90 % and the database above 100 %, so it still passes; a bucket at 80–89 % would get no warning.
- **Fix task**: add 4000 of 5000 storage bytes (80 %) → `warning: true` and 3950 of 5000 (79 %) → `warning: false`. **Done when** mutant A12 fails the file.

### F4 (Minor, documentation): T42 Done-when boxes unticked

- **Where**: `.specs/features/gestao/tasks.md:1365-1370`
- **Scenario**: T42 is implemented (`cf4e837`) and its tests pass (`apps/web/src/lib/analytics.test.tsx:48`, `:80`, `:131`, `:182`, `:239`; funnel-point tests under GES-135), but its six boxes are `[ ]`.
- **Fix**: tick the six boxes with that evidence.

### F5 (Minor, spec precision): 10-second timeouts rest on constants

- **Where**: `apps/api/src/modules/integrations/gateway-config.service.ts:36` (GES-37), `apps/api/src/modules/calendar/holiday-import.ts:11` (GES-132)
- **Scenario**: tests simulate a `TimeoutError`; they would still pass with a 30 s constant.
- **Fix**: assert the value (`expect(GATEWAY_TEST_TIMEOUT_MS).toBe(10_000)`) or a fake-timer abort at 10 000 ms, as fundacao's `dispatchEmails` test does.

### F6 (Minor, spec precision): three of six audit origin labels untested

- **Where**: `apps/web/src/features/admin-audit/labels.ts:2-9`; `apps/web/src/pages/admin/audit/AuditPage.test.tsx:46`, `:183`
- **Scenario**: `Web`, `Job`, `MCP` are asserted; `App`, `Admin`, `Sistema` could change silently.
- **Fix**: an `it.each` over `AUDIT_ORIGIN_LABELS` rendering one row per origin.

### F7 (Minor, test hardening): three edge cases rest on code paths

- **Where**: concurrent clinic-feed regeneration (`apps/api/src/lib/errors.ts:143`, index test only); MCP destructive repeat → `INVALID_TRANSITION` (`apps/api/src/mcp/server.ts:95`); attachment cleanup failure logged (`apps/api/src/modules/finance/expenses.service.ts:312`)
- **Fix**: (a) two parallel feed issues asserting `[201, 409]` and one active row; (b) `booking_cancel` with `confirm: true` on an already-cancelled booking asserting tool error `INVALID_TRANSITION`; (c) attachment replace with a storage stub whose `delete` rejects, asserting 200 and a logged error.

### Note: sensor A17 is equivalent

Dropping `.onConflictDoNothing()` from `apps/api/src/jobs/recurring-expenses.ts:55` keeps `recurring-expenses.int.test.ts` green because `nextOccurrences` already starts after the last child, and the partial unique index (`gestao-constraints.int.test.ts:134`) still forbids a duplicate. The spec outcome (no duplicate child, GES-14 edge case) holds either way; no fix task.

### Note: traceability statuses lagged the work

Rows for finished web tasks (GES-26..28, 82, 83, 87, 98, 109, 116, 128, 133..136) read `In Tasks` before this run; the verifier flipped every row it verified to `Verified`.

---

## Requirement Traceability Update

139 of the 141 in-scope rows → `Verified` in `spec.md`, each with the evidence above. GES-95 and GES-138 stay `Implementing` (PARTIAL, F1 and F3). GES-142, GES-143, GES-144 stay `In Tasks` (T47–T50 in progress).

---

## Cleanup

- `gestao_ver_hmuv87_1..4` were dropped (backends terminated, then `DROP DATABASE IF EXISTS`); a lookup in `pg_database` on the verify branch confirmed no `gestao_ver_*` database remains.
- The worktree `.env` is untracked and gitignored; its values were never printed. Nothing in the main checkout `E:\src\Bravo-clinic` was changed (its `.env` was only read). The one stray install log the verifier wrote next to the worktrees folder was deleted.
- Logs, the sensor script and its mutant list live only under `node_modules/.cache/verify/` (ignored).
- Every mutated file was restored with `git checkout --`; `git status --porcelain` was empty before and after the sensor and before the report commit (only this report and the `spec.md` traceability rows are committed).
- No server or watcher was started; all test processes exited.

---

## Summary

**Overall**: ❌ Not ready: fix F1–F3 (test additions), then re-verify (iteration 2 re-applies A7, A12, A19).

**Spec-anchored check**: 139/141 in-scope ACs matched the spec outcome; 2 PARTIAL (GES-95 → F1, GES-138 → F3); 3 GES ACs pending (T47–T50); no spec-precision gap that the spec itself leaves open (two timeouts and three labels rest on constants, F5–F6)
**Sensor**: 24/28 killed (survivors A7, A12, A19; A17 equivalent)
**Gate**: typecheck ✅, lint ✅, core ✅, web 1196/1196 ✅, API 1228/1228 ✅; e2e cited (16/16 per orchestrator)

**What works**: the finance engine and DRE (exact cents, both regimes), Integrações (gateway, ICS feeds, MCP, e-mails, usage), web push, extras and quotes, Clientes, Salas, Usuários/Auditoria, the reception sweep, LGPD and the jobs all meet their ACs with file:line evidence; 24 of 27 non-equivalent mutants are killed.

**Lessons**: L-009 (allow-only transition tables), L-010 (soft-delete filters in reports), L-011 (threshold boundaries), L-012 (named timeout values) recorded with `scripts/lessons.py add` in `.specs/lessons.json` / `.specs/LESSONS.md`.

**Next steps**: route F1–F3 to an implementer as test-only fix tasks (no product change expected), then run iteration 2: re-apply A7, A12, A19 and re-run the touched files. F4–F7 are optional. Re-verify GES-142..GES-144 after T47–T50.
