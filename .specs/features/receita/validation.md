# Receita Validation

## Validation verdict: FAIL

**Date**: 2026-10-27 (iteration 1)
**Spec**: `.specs/features/receita/spec.md` (REC-01..REC-161)
**Diff range**: receita commits `5e20dfc` (T1) .. `ca9f709` (merge of Phase 10) on `main`; `main` also carries nucleo and gestao work, only REC ACs are judged here.
**Verifier**: independent sub-agent (author ≠ verifier; wrote none of the receita code or tests), worktree branch `worktree-agent-a8af581ab3cb24871` reset to `main` = `ca9f709`.
**Test DB**: a fresh empty database `receita_verify`, created for this run on the Neon verify branch (`DATABASE_URL_VERIFY`). Its host differs from both `DATABASE_URL` (production) and the dev `DATABASE_URL_TEST` (in use by another worker). Only the worktree `.env` (untracked, gitignored) had `DATABASE_URL_TEST` pointed at it; `apps/api/vitest.config.ts` and `test/global-setup.ts` read that root `.env`. Dropped at the end of the run.

---

## Task Completion

50 tasks (T1–T50). All 247 Done-when boxes of `tasks.md` are `[x]`, none unticked. `python …/scripts/validate_tasks.py .specs/features/receita` → `0 error(s), 16 warning(s)` (granularity warnings only, e.g. T29–T31 name several files).

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T7 (core) | ✅ Done | |
| T8–T29 (API, jobs) | ✅ Done | |
| T30–T47 (web) | ✅ Done | |
| T48–T50 (e2e) | ✅ Done | re-run by the verifier, see Gate Check |

---

## Spec-Anchored Acceptance Criteria

Paths: `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`, `e2e/` = `apps/web/e2e/`. Line numbers point to the `it(` / `describe(` whose assertions carry the spec value. Every cited file was read at `ca9f709`; the tests carry `REC-nn` tags that the verifier re-derived (137 files reference REC ids). Where an AC has no test but the behavior follows from a single code path, the code path is cited and the row says "(code path)".

### P1 Package categories

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| REC-01 | hour package: name 2..80, price ≥ 1, hours 1..200 → minutes ×60, period enum; else 422 | `core/validation/revenue-schemas.test.ts:65` (0 and 201 h rejected, 20 h → 1200); `api/modules/subscriptions/category-handlers.int.test.ts:57`, `:84` (`it.each`: 0/201 h, period, price 0 → 422 `VALIDATION_FAILED` on the path, nothing stored); `web/features/admin-categories/PackageCategoryForms.test.tsx:155` | ✅ |
| REC-02 | fixed: ≥ 1 weekday, slot-aligned window ≥ default booking, price ≥ 1, period | `revenue-schemas.test.ts:103`; `category-handlers.int.test.ts:72`, `:84` (grid, short window, no weekday); `PackageCategoryForms.test.tsx:219` | ✅ |
| REC-03 | "→ R$ 80,00/h", "R$ 112,00/h" | `PackageCategoryForms.test.tsx:107` (`toContain('→ R$ 80,00/h')` `:116`, `'→ R$ 112,00/h'` `:119`), `:156`, `:229` | ✅ |
| REC-04 | "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00" | `core/fixed/occurrences.test.ts:75`; `PackageCategoryForms.test.tsx:122` | ✅ |
| REC-05 | 409 `CONFLICT` + exact message, nothing saved | `category-handlers.int.test.ts:103` (`toMatchObject({ code: 'CONFLICT', message: LOCKED_CATEGORY_MESSAGE })`, row still `version: 1`); web `PackageCategoryForms.test.tsx:294` | ✅ |
| REC-06 | version +1, audit `category.update`, `subscription.price_change` to active/suspended subscribers | `category-handlers.int.test.ts:142` (version bump, audit, one e-mail per active/suspended subscriber) | ✅ |
| REC-07 | inactive omitted publicly; tenant purchase 404 | `api/routes/public/packages.int.test.ts:56`, `:148`, `:256`; `purchase.service.int.test.ts:304` | ✅ |
| REC-08 | admin_only omitted publicly, only admin sale accepts | `packages.int.test.ts:256`; `purchase.service.int.test.ts:304`, `:445` (admin-only link sale) | ✅ |
| REC-09 | inactive/admin_only keep renewing | `api/jobs/renewals.int.test.ts:202` (inactive); admin_only by the same code path (`createRenewalPeriod` reads the category without status/visibility filter, `api/modules/subscriptions/period.service.ts:225-231`) | ✅ (admin_only: code path) |

### P1 Buy an hour package

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-10 | startsOn 2026-11-02, endsOn 2026-12-02, 160000, 1200, vPac 8000, renewsOn 2026-12-02, chargeDueOn 2026-11-30 | `api/routes/app/subscriptions.int.test.ts:84`; `packages.int.test.ts:173`; `core/packages/period.test.ts:11`, `:19` | ✅ |
| REC-11 | 422 on `baseOn`, "Escolha uma data base entre {hoje} e {limite}" | `revenue-schemas.test.ts:142`; `packages.int.test.ts:246` | ✅ |
| REC-12 | 409 `CONFLICT` "Você já tem um pacote de horas…" | `purchase.service.int.test.ts:160`; DB `api/db/receita-constraints.int.test.ts:146` (23505); web `SubscribePage.test.tsx:387` | ✅ |
| REC-13 | no consents → 422 `POLICY_VIOLATION`; consents written `ref_type='subscription'` | `subscriptions.int.test.ts:169`; `purchase.service.int.test.ts:172`, `:109` (consent rows) | ✅ |
| REC-14 | one tx: subscription awaiting with hold, period seq 1 with snapshot, coupon use, credits, `subscription_initial` charge; 201 + ChargeIntent | `purchase.service.int.test.ts:109`; `subscriptions.int.test.ts:104` (201, contract parse); `e2e/receita-hour-package.spec.ts:26` | ✅ |
| REC-15 | payNow 0 → active without gateway charge | `purchase.service.int.test.ts:214`, `:258` | ✅ |
| REC-16 | approval → active, period active + `period_grant` (or `paid`), coupon consumed, `subscription.activated` | `api/modules/subscriptions/charge-handlers.int.test.ts:138`, `:160`; `period.service.int.test.ts:99`; e2e `receita-hour-package.spec.ts:26` | ✅ |
| REC-17 | rollover activates a paid seq 1 on starts_on | `api/jobs/period-rollover.int.test.ts:149` | ✅ |
| REC-18 | hold expiry → expired, period cancelled, charge cancelled, coupon released, credits returned | `api/jobs/expire-purchases.int.test.ts:89` (all five asserted) | ✅ |
| REC-19 | late approval → full refund `late_approval_conflict` + `payment.late_refund` | `charge-handlers.int.test.ts:204` | ✅ |
| REC-20 | Idempotency-Key replay / mismatch 422 | `subscriptions.int.test.ts:127`; missing key → 400 `BAD_REQUEST` (`:153`, documented SPEC_DEVIATION, see below) | ✅ |
| REC-21 | foreign/deleted/no-consent/other-gateway card → 422 on `savedCardId` | `purchase.service.int.test.ts:183`, `:197` | ✅ |

### P1 Pay a booking with package hours

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-22 | 120 / 78 / 185 / 84 / 152, one ceiling | `core/packages/debit.test.ts:9-56` (five examples) + one-ceiling case `:65`; sensor C1 killed | ✅ |
| REC-23 | `packageOption` fields | `api/modules/packages/package-payment.service.int.test.ts:122`, `:152` | ✅ |
| REC-24 | "Esta reserva vai debitar {X} min do seu pacote" | `web/components/revenue/PackagePaymentOption.test.tsx:37`; `web/extensions/receita.test.tsx:65`; e2e `receita-hour-package.spec.ts:78` | ✅ |
| REC-25 | package minutes only inside `[starts_on, ends_on)` of the active period; else lots, `outside_period` | `package-payment.service.int.test.ts:164`; `core/packages/allocation.test.ts:8`; `period.test.ts:32` | ✅ |
| REC-26 | package first, lots by expiry (ties by creation), lot must expire after now and booking start | `package-payment.service.int.test.ts:152`; `allocation.test.ts:48`; sensor C6 killed | ✅ |
| REC-27 | insufficient → `reason:'insufficient'`; booking 422 `INSUFFICIENT_BALANCE` with `requiredMinutes`/`availableMinutes` | `package-payment.service.int.test.ts:248`; `api/modules/revenue/steps.int.test.ts:230` | ✅ |
| REC-28 | disabled option, "Saldo insuficiente: … {X} min e você tem {Y} min", two buttons | `PackagePaymentOption.test.tsx:62` (`toBeDisabled`, exact text), `:74` (`/app/compras/horas-extras`, money) | ✅ |
| REC-29 | same tx: `payment_mode='package'`, total 0, confirmed, debited columns, ledger detail | `package-payment.service.int.test.ts:220`; `steps.int.test.ts:206`; e2e `receita-hour-package.spec.ts:103` | ✅ |
| REC-30 | no coupon/slot discount, `discount_source='none'` | `steps.int.test.ts:206` | ✅ |
| REC-31 | block category → null option, package payment 422 `POLICY_VIOLATION` | `package-payment.service.int.test.ts:196` (Lane A note: the web `block_category` branch is unreachable; accepted) | ✅ |
| REC-32 | concurrent package bookings: one wins, other 422, no negative | `package-payment.service.int.test.ts:260`; `minutes.service.int.test.ts:125` | ✅ |
| REC-33 | V_ref weekday rate, V_pac from period snapshot, V_slot per segment | `package-payment.service.int.test.ts:122`, `:220` (detail V_ref 9700, V_pac 8000); `debit.test.ts:89` | ✅ |
| REC-34 | tenant ≥ 24 h: package minutes back with `refund`, extra to lots | `package-payment.service.int.test.ts:287`; `steps.int.test.ts:240` (through nucleo's cancel route) | ✅ |
| REC-35 | tenant < deadline or `no_show` → no return | `package-payment.service.int.test.ts:306` (< 24 h: 0 returned, balances unchanged); `no_show`: code path — `api/jobs/no-shows.ts` only transitions the booking and never calls the payment-mode handler, so nothing returns; sensor A6 killed | ✅ (no_show: code path) |
| REC-36 | clinic cancel: all minutes back; closed period → manual 90-day lot `clinic_cancellation` | `package-payment.service.int.test.ts:320` | ✅ |
| REC-37 | reschedule reverses + re-debits in one tx; uncovered → 422, nothing changes | `package-payment.service.int.test.ts:388`, `:402`; `steps.int.test.ts:264` | ✅ |
| REC-38 | period closed by switch → converted minutes to successor | `package-payment.service.int.test.ts:351` | ✅ |

### P1 Balance ledger, extrato and admin adjustment

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-39 | UPDATE/DELETE on the three ledgers raise `append_only_table` | `api/db/receita-constraints.int.test.ts:106`, `:118`, `:131` | ✅ |
| REC-40 | balance = ledger sum; negative balances rejected | `minutes.service.int.test.ts:76`, `:232`; `receita-constraints.int.test.ts:188`, `:199` (23514) | ✅ |
| REC-41 | extrato newest first, label, signed minutes, balance after, booking code, "60 min + 18 min de excedente = 78 min" | `subscriptions.int.test.ts:211`; `debit.test.ts:101`; `web/components/revenue/LedgerTable.test.tsx:12`; e2e `receita-hour-package.spec.ts:112` | ✅ |
| REC-42 | "Compra"/"Renovação", lot source labels | `core/status/subscription.test.ts:130`, `:147`; `LedgerTable.test.tsx:24` | ✅ |
| REC-43 | ±1..12000, justification 5..500 → `manual_adjustment` + audit `package_ledger.adjust` before/after | `minutes.service.int.test.ts:144`; `api/routes/admin/subscriptions.int.test.ts:211`; `revenue-schemas.test.ts:322` | ✅ |
| REC-44 | negative → 422 `INSUFFICIENT_BALANCE`; no justification → 422 `VALIDATION_FAILED` | `minutes.service.int.test.ts:173`; `admin/subscriptions.int.test.ts:211`, `:304` | ✅ |
| REC-45 | reception → 403 `FORBIDDEN` | `admin/subscriptions.int.test.ts:126` (status 403; the `FORBIDDEN` code comes from the shared `requireRole('admin')`, `api/middleware/auth.ts:39`) | ✅ (code: code path) |

### P1 Renewal, suspension and closure

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-46 | ends_on = starts_on + days; charge_due_at 2026-11-30T03:00Z | `period.test.ts:11`, `:19`; `period.service.int.test.ts:210` (`'2026-11-30T03:00:00.000Z'`) | ✅ |
| REC-47 | due → create/promote awaiting period, current category price, credits FIFO, card or Pix | `renewals.int.test.ts:112`, `:162`, `:182`; `period.service.int.test.ts:210` (170000 after a price change), `:234`; sensor A9 killed | ✅ |
| REC-48 | twice → one period, one charge per attempt | `renewals.int.test.ts:112` (re-run creates nothing) | ✅ |
| REC-49 | renewal approved → period paid, held occurrences confirmed, `renewal_approved` | `charge-handlers.int.test.ts:276`, `:287` | ✅ |
| REC-50 | card rejected → `renewal_failed` + staff event, one retry next daily run before starts_on | `charge-handlers.int.test.ts:319`; `renewals.int.test.ts:145` | ✅ |
| REC-51 | one Pix reminder per local day | `renewals.int.test.ts:237` | ✅ |
| REC-52 | missing/deleted/other-gateway card → Pix + ask for a card | `renewals.int.test.ts:173`; `api/emails/templates/revenue.test.ts:171` | ✅ |
| REC-53 | rollover closes with `expiry`, activates a paid next period with grant | `period-rollover.int.test.ts:93`; `period.service.int.test.ts:192` | ✅ |
| REC-54 | unpaid at starts_on → suspended, period awaiting, held occurrences expired, `subscription.suspended` | `period-rollover.int.test.ts:124`, `:173`; `cancel.service.int.test.ts:332`; e2e `receita-fixed-and-renewals.spec.ts:69`; sensor A3 killed | ✅ |
| REC-55 | suspended: no package payment, lots usable | `package-payment.service.int.test.ts:182` | ✅ |
| REC-56 | regularization in grace (hour: full price/dates/minutes; fixed: re-hold free future occurrences × count) | `cancel.service.int.test.ts:375`, `:407`; `charge-handlers.int.test.ts:338` | ✅ |
| REC-57 | grace end 2026-12-09 → ended, period failed, charge cancelled, `subscription.ended` | `period-rollover.int.test.ts:137` (nothing on 12-08, ended on 12-09); `cancel.service.int.test.ts:355`; `period.test.ts:24`; sensor A2 killed | ✅ |
| REC-58 | `period_ending` 7 and 1 days before | `renewals.int.test.ts:250`; `period.test.ts:28` | ✅ |
| REC-59 | 401 without trigger, nothing changes; `job_runs` with stats | `expire-purchases.int.test.ts:196`, `:204`; `period-rollover.int.test.ts:191`; `api/neon.test.ts:40` | ✅ |
| REC-60 | only the listed subscription transitions; else 409 `INVALID_TRANSITION` | `core/status/subscription.test.ts:19`, `:50` (49 pairs), `:93`; `period.service.int.test.ts:276` | ✅ |
| REC-61 | only the listed period transitions | `subscription.test.ts:32`, `:73`; `period.service.int.test.ts:276`, `:296` | ✅ |

### P1 Extra hours

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-62 | eligible, unit, min/max, lots, total | `api/routes/app/purchases.int.test.ts:84`; `web/pages/app/compras/HorasExtrasPage.test.tsx:85` | ✅ |
| REC-63 | unit 8000, 5 h → 40000 | `purchases.int.test.ts:84`, `:120`; `debit.test.ts:89`; `HorasExtrasPage.test.tsx:50`; e2e `receita-hour-package.spec.ts:125` | ✅ |
| REC-64 | hours outside min/max → 422 on `hours` | `purchases.int.test.ts:166`; `revenue-schemas.test.ts:210` | ✅ |
| REC-65 | no active hour package → 422 `POLICY_VIOLATION` with the message | `purchases.int.test.ts:98` | ✅ |
| REC-66 | approval → paid, lot hours×60, expiry paid_at + 90 d, `grant`, `extra_hours.purchased` | `purchases.int.test.ts:120`; e2e `receita-hour-package.spec.ts:125` | ✅ |
| REC-67 | rollover expires lots | `minutes.service.int.test.ts:268`; `period-rollover.int.test.ts:220` | ✅ |
| REC-68 | unexpired lots usable after cancel/switch/suspend/end | suspended: `package-payment.service.int.test.ts:182`; cancelled/switched/ended: code path only (`api/modules/packages/package-payment.service.ts:160` keeps lots when no live hour package exists, rate from `latestRate`); sensor A7 **survived** (lots dropped when no live hour package: every package-payment and steps test still passes) | ⚠️ PARTIAL (finding F2) |
| REC-69 | web hides Horas extras without active package | `web/pages/app/compras/ComprasPage.test.tsx:224`; `HorasExtrasPage.test.tsx:100` | ✅ |
| REC-70 | unpaid hold → purchase cancelled, charge cancelled, credits back | `purchases.int.test.ts:213`; `expire-purchases.int.test.ts:89` describe | ✅ |

### P1 Change and cancel a subscription

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-71 | 360 → 384, half-up | `core/packages/conversion.test.ts:13`, `:21`; `switch.service.int.test.ts:122`; sensor C4 killed | ✅ |
| REC-72 | switch quote fields, dates from today, price, payNow | `switch.service.int.test.ts:122`; `subscriptions.int.test.ts:276`; `web/features/purchases/SubscriptionDialogs.test.tsx:139` | ✅ |
| REC-73 | one tx: old `switched` + `switched_to`, `conversion_out`, period closed, pending renewal cancelled, new active base = approval date, grant + `conversion_in` | `switch.service.int.test.ts:159` (all but the pending renewal); pending renewal: code path `api/modules/subscriptions/switch.service.ts:484` (`cancelFuturePeriods`); sensor A4 **survived** (removing `cancelFuturePeriods` passes every switch and route test) | ⚠️ PARTIAL (finding F3) |
| REC-74 | conversion at approval time | `switch.service.int.test.ts:193` (320 after a −60 debit) | ✅ |
| REC-75 | rejected/expired switch → old unchanged | `switch.service.int.test.ts:211`, `:224` | ✅ |
| REC-76 | other type or same category → 422 on `categoryId` | `switch.service.int.test.ts:240` | ✅ |
| REC-77 | fixed switch releases old future (cancelled_by_tenant) / held (expired), reserves new, own occurrences ignored | `switch.service.int.test.ts:263` describe, `:306`, `:326` | ✅ |
| REC-78 | insert conflict at approval → refund, old kept, `payment.late_refund` | `switch.service.int.test.ts:350` | ✅ |
| REC-79 | cancel preview: minutes lost, paid upcoming lost, occurrences to release, extra kept | `cancel.service.int.test.ts:155`, `:164`, `:176`; `SubscriptionDialogs.test.tsx:35` | ✅ |
| REC-80 | cancel: cancelled, `expiry`, charges cancelled, future periods cancelled, package bookings kept | `cancel.service.int.test.ts:190` | ✅ |
| REC-81 | fixed cancel: future `cancelled_by_tenant`/`cancelled_by_clinic`, held `expired`, no refund | `cancel.service.int.test.ts:227` (tenant, `refunds` empty), `:265` (admin → `cancelled_by_clinic`) | ✅ |
| REC-82 | admin cancel without justification 422; with → audit `subscription.cancel` | `admin/subscriptions.int.test.ts:186`; `cancel.service.int.test.ts:265` | ✅ |

### P1 Buy a fixed-schedule package

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-83 | 22 occurrences; 616000 | `core/fixed/occurrences.test.ts:25`, `:34`, window to 1440 `:59` | ✅ |
| REC-84 | occurrences, `{date, reason, label}` conflicts, price, ≤ 3 rooms and ≤ 3 base dates suggestions | `packages.int.test.ts:96`, `:117`; `occurrences.test.ts:109-180`; `FixedSchedulePicker.test.tsx:65`, `:73`; e2e `receita-fixed-and-renewals.spec.ts:69` | ✅ |
| REC-85 | conflict at purchase → 409 `OCCURRENCE_CONFLICT` with every date, nothing created | `purchase.service.int.test.ts:357`; `subscriptions.int.test.ts:378` | ✅ |
| REC-86 | every occurrence `fixed_occurrence`, `subscription` mode, `awaiting_payment`, hold, occupancy `[start, end+cleanup)` | `purchase.service.int.test.ts:321` | ✅ |
| REC-87 | taken between check and purchase → whole purchase aborted, 409 with that date | `purchase.service.int.test.ts:386` | ✅ |
| REC-88 | approval → all confirmed, one e-mail, one `.ics` with one VEVENT each | `charge-handlers.int.test.ts:170` (22 `BEGIN:VEVENT`); e2e `receita-fixed-and-renewals.spec.ts:69` | ✅ |
| REC-89 | no occurrence before now + min advance; max advance not applied | `occurrences.test.ts:45`; `packages.int.test.ts:96` | ✅ |
| REC-90 | holidays keep occurrences | `occurrences.test.ts:39`; open-holiday hours SPEC_DEVIATION in `api/modules/subscriptions/quote.service.ts:166` (see below) | ✅ |
| REC-91 | "{n} ocorrências × R$ {preço} = R$ {total}" | `FixedSchedulePicker.test.tsx:106`; `SubscribePage.test.tsx:116` describe | ✅ |

### P1 Fixed-schedule period lifecycle

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-92 | next period `upcoming`, free occurrences `held_for_renewal`, conflicts stored + `next_period_conflicts` | `period.service.int.test.ts:134`, `:158`; `api/routes/admin/booking-queries.int.test.ts:113` | ✅ |
| REC-93 | renewal counts held only; known closed days reduce count, no compensation | `period.service.int.test.ts:234`, `:252`; `renewals.int.test.ts:212` | ✅ |
| REC-94 | single fixed occurrence cancel → no refund, subscription unchanged | `steps.int.test.ts:375` | ✅ |
| REC-95 | fixed reschedule money difference zero | `steps.int.test.ts:375` | ✅ |

### P1 Closed-day compensation

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-96 | 40 / 40 / 20; 20533 | `conversion.test.ts:41` describe (`it.each` 40/40/20, `:61` 20533, `:65` half-up); sensor C5 killed | ✅ |
| REC-97 | preview subscribers, minutes, cents | `compensation.service.int.test.ts:93` (2, 40, 20533, 1) | ✅ |
| REC-98 | clinic-wide → extra lot `closed_day_compensation` with grant + e-mail | `compensation.service.int.test.ts:108` | ✅ |
| REC-99 | fixed: clinic-wide or subscription room → credit lot period price ÷ days + e-mail | `compensation.service.int.test.ts:108` (20533-cent credit), `:178` (room of the fixed schedule), `:195` (other room: nothing) | ✅ |
| REC-100 | confirmed and held occurrences on the date → `cancelled_by_clinic`, no refund | `compensation.service.int.test.ts:108`, `:159` | ✅ |
| REC-101 | one-room closure → no hour-package compensation | `compensation.service.int.test.ts:178`; sensor A5 killed | ✅ |
| REC-102 | activation compensates known clinic-wide closed days | `compensation.service.int.test.ts:245`; `period.service.int.test.ts:122`; `period-rollover.int.test.ts:163` | ✅ |
| REC-103 | setting false → no compensation | `compensation.service.int.test.ts:214` | ✅ |
| REC-104 | at most one per (closed day, subscription) | `compensation.service.int.test.ts:203`; `receita-constraints.int.test.ts:249` | ✅ |

### P1 Customer credits

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-105 | lot, expiry now + validity, `grant` | `api/modules/credits/credits.service.int.test.ts:44` | ✅ |
| REC-106 | available = unexpired remaining | `credits.service.int.test.ts:57` | ✅ |
| REC-107 | FIFO by expiry/creation, min(available, payable), one internal charge + `use` entries | `credits.service.int.test.ts:67`, `:115`; `steps.int.test.ts:298`; `allocation.test.ts:146` | ✅ |
| REC-108 | concurrent uses never exceed | `credits.service.int.test.ts:140` (passes, but sensor A8 **survived**: without `FOR UPDATE` on the credit lots the test still passes, so it does not force the interleaving; the DB check `remaining_cents >= 0` is the only other guard) | ⚠️ PARTIAL (finding F4) |
| REC-109 | retained consumes credit first; refunded credit to lot or fresh lot | `allocation.test.ts:219` (sensor C7 killed); `credits.service.int.test.ts:181`, `:194`; `steps.int.test.ts:316` | ✅ |
| REC-110 | cheaper reschedule → `reschedule_difference` credit, amount returned | `steps.int.test.ts:352` | ✅ |
| REC-111 | clinic cancel with credit → `clinic_cancellation` lot of the paid amount | `steps.int.test.ts:333` | ✅ |
| REC-112 | manual credit 1..10.000.000, justification, audit `credit.grant_manual`; reception 403 | `api/routes/admin/customer-credits.int.test.ts:32`, `:62` (`FORBIDDEN`), `:74`; `revenue-schemas.test.ts:345` | ✅ |
| REC-113 | rollover expires credit lots | `credits.service.int.test.ts:217`; `period-rollover.int.test.ts:220` | ✅ |
| REC-114 | Créditos page: total, lot source label, remaining, expiry, ledger | `web/pages/app/compras/CreditosHistoricoPages.test.tsx:16`, `:27`; `purchases.int.test.ts:246` | ✅ |
| REC-115 | credits pay bookings, purchases, switches, extra hours; automatic on renewals | `steps.int.test.ts:298`; `purchase.service.int.test.ts:214`, `:272`; `purchases.int.test.ts:176`; `renewals.int.test.ts:182`, `:193`; switch with `useCredits` per Lane A note | ✅ |

### P1 Coupons in checkout

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-116 | 2190; 2000; cap at gross | `core/pricing/discounts.test.ts:30`, `:38`, `:42`; `coupons.service.int.test.ts:101`; sensor C3 killed | ✅ |
| REC-117 | 8 reasons with the exact messages | `discounts.test.ts:137` describe; `web/components/revenue/CouponField.test.tsx:42`; `steps.int.test.ts:179` | ✅ |
| REC-118 | first-booking by document (confirmed bookings, reserved/consumed uses) | `coupons.service.int.test.ts:127`, `:145`, `:180` | ✅ |
| REC-119 | per-customer limit, reserved + consumed, by document else user | `coupons.service.int.test.ts:206`; `discounts.test.ts:137` | ✅ |
| REC-120 | larger wins, tie keeps slot, note; 16000/1600/2000 → coupon, net 14000 | `discounts.test.ts:96`, `:112`; `steps.int.test.ts:112`; e2e `receita-discounts.spec.ts:48`; sensor C2 killed | ✅ |
| REC-121 | "Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00)." | `discounts.test.ts:229`, `:235`; `CouponField.test.tsx:50`; e2e `receita-discounts.spec.ts:100` | ✅ |
| REC-122 | deposit on net: 14000 → 7000 | `steps.int.test.ts:112`; e2e `receita-discounts.spec.ts:101` | ✅ |
| REC-123 | last use race: one reserves, other 409 `COUPON_EXHAUSTED` "Cupom esgotado" | `coupons.service.int.test.ts:34`; e2e `receita-discounts.spec.ts:174`; sensor A1 killed | ✅ |
| REC-124 | reserved → consumed / released with counter −1 | `coupons.service.int.test.ts:74`; `steps.int.test.ts:112`, `:159` | ✅ |
| REC-125 | coupon on first period only | `renewals.int.test.ts:112` ("without the coupon"); `period.service.int.test.ts:210`; `packages.int.test.ts:194` | ✅ |
| REC-126 | disabled → refused on next quote/checkout | `coupons.service.int.test.ts:117`; `discounts.test.ts:137` | ✅ |
| REC-127 | one coupon, case-insensitive, stored upper | `coupons.service.int.test.ts:101`; `revenue-schemas.test.ts:227` | ✅ |

### P1 Admin coupons screen

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-128 | list columns "Primeira reserva"/"Desconto", "10%"/"R$ 20,00", "3/10"/"3/∞", validity, switch | `web/pages/admin/cupons/CuponsPage.test.tsx:96`, `:111`, `:121`; `coupons.int.test.ts:142` | ✅ |
| REC-129 | code regex unique, percent bp, max_uses ≥ max(1, uses), validity order, first_booking → bookings | `revenue-schemas.test.ts:227`; `api/routes/admin/coupons.int.test.ts:42`, `:57`, `:67`, `:99`; `CouponFormModal.test.tsx:57`, `:236` | ✅ |
| REC-130 | toggle audits enable/disable; create/edit audits | `coupons.int.test.ts:42`, `:85`, `:126`; `CuponsPage.test.tsx:165` | ✅ |
| REC-131 | history: customer, booking code or category, date, discount, status labels | `coupons.int.test.ts:142`; `CuponsPage.test.tsx:220` | ✅ |
| REC-132 | reception 403 `FORBIDDEN` | `coupons.int.test.ts:200` | ✅ |

### P1 Slot discounts

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-133 | one row per free sub-interval; `created[]`/`skipped[]` | `api/routes/admin/slot-discounts.int.test.ts:62`, `:124`; `SlotDiscountDialog.test.tsx:111` | ✅ |
| REC-134 | percent/alignment/window/past → 422 | `slot-discounts.int.test.ts:93` describe; `revenue-schemas.test.ts:298` | ✅ |
| REC-135 | overlap → 409 "Já existe desconto neste horário" | `slot-discounts.int.test.ts:101`; `receita-constraints.int.test.ts:221` (23P01) | ✅ |
| REC-136 | public cells carry `discountPercent`; web "−{p}%" | `steps.int.test.ts:435` **fails at `ca9f709`** (`expected [ undefined, 10 ] to deeply equal [ 10, 10 ]`, full run and isolated re-run): the test date `TUE = '2026-10-27'` is today and `slotDiscountDecorator` read the wall clock (`api/modules/revenue/ports.ts:129`), hiding cells before the real current minute. Production behavior is right (wall clock = request clock); the test is not deterministic. e2e `receita-discounts.spec.ts:161` | ❌ FAIL at `ca9f709` (finding F1; fixed on `main` by `8261082` per the orchestrator, not re-verified here) |
| REC-137 | admin calendar markers; hover "Remover desconto" | `web/features/admin-reservas/SlotDiscountSlots.test.tsx:188` describe, `:212`, `:227` | ✅ |
| REC-138 | overlapped part consumed, rest active | `slot-discounts.int.test.ts:160`; `steps.int.test.ts:112` | ✅ |
| REC-139 | remove → `removed_at`, audit, no longer listed/priced | `slot-discounts.int.test.ts:186` | ✅ |
| REC-140 | parts ending ≤ now not shown or applied | `slot-discounts.int.test.ts:215` | ✅ |
| REC-141 | reception 403 on mutations | `slot-discounts.int.test.ts:252` | ✅ |
| REC-142 | 1600 for Tue 14:00–16:00 at 8000/h, 10% | `discounts.test.ts:50`, rounding `:78` | ✅ |

### P1 Perfil → Compras

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-143 | subscription card: status, category, base date, next charge, balance "12h 30min de 20h" + meter / fixed details | `ComprasPage.test.tsx:120`, `:130`, `:142`; `web/components/revenue/PackageCard.test.tsx:64`; `subscriptions.int.test.ts:183` | ✅ |
| REC-144 | actions per status | `ComprasPage.test.tsx:71`, `:84`, `:97`, `:110` | ✅ |
| REC-145 | Histórico newest first: date, description, method, amount, status label | `CreditosHistoricoPages.test.tsx:64`, `:78`; `purchases.int.test.ts:258` | ✅ |
| REC-146 | four tabs at the four routes | `ComprasPage.test.tsx:209`, `:237` | ✅ |
| REC-147 | empty state + link `/precos` | `ComprasPage.test.tsx:152` | ✅ |

### P1 Admin subscriptions and sale

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-148 | list columns, 7 status labels, filters, search | `admin/subscriptions.int.test.ts:78`; `AssinaturasTab.test.tsx:95`, `:110`, `:121`; `subscription.test.ts:117` | ✅ |
| REC-149 | periods, extrato, actions | `AssinaturasTab.test.tsx:154`, `:170`, `:216`, `:256`, `:282` | ✅ |
| REC-150 | sale input: customer, category (public/admin_only), base date, room, coupon, link 1..720 h or manual | `purchase.service.int.test.ts:407`, `:445`, `:464`; `admin/subscriptions.int.test.ts:156`, `:281`; `SellSubscriptionDialog.test.tsx:149`, `:198`, `:229`; e2e `receita-fixed-and-renewals.spec.ts:154` | ✅ |
| REC-151 | link: `pre_reserved` until hold, `subscription.sale_link` to `/app/compras/assinaturas/{id}/pagar` | `purchase.service.int.test.ts:407`; `cancel.service.int.test.ts:444` | ✅ |
| REC-152 | manual: active without charge, audit `subscription.confirm_manual` | `purchase.service.int.test.ts:464` | ✅ |
| REC-153 | reception 403 on sell/adjust/cancel; GET list allowed | `admin/subscriptions.int.test.ts:126` (403 on quote, sell, cancel, adjust, resend), `:78` (reception reads); web `SellSubscriptionDialog.test.tsx:419` | ✅ |
| REC-154 | resend → new `sale_link` row | `admin/subscriptions.int.test.ts:238` | ✅ |

### P1 Public packages and purchase flow

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-155 | `/precos` packages list + "Assinar" to `/assinar/{id}` | `packages.int.test.ts:56`; `PackagesSection.test.tsx:24`, `:80`; `PackageCard.test.tsx:9` | ✅ |
| REC-156 | ≤ 4 visible steps | `SubscribePage.test.tsx:115` describe, `:127` | ✅ |
| REC-157 | logged out → `/login?next=/assinar/{id}` keeping options | `SubscribePage.test.tsx:201` (`startsWith('/login?next=')`) | ✅ |
| REC-158 | summary text "Renova automaticamente em … (cobrança 2 dias antes)", two checkboxes | `SubscribePage.test.tsx:144`, `:159` | ✅ |

### P1 Subscription notifications

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| REC-159 | 17 templates rendered pt-BR and queued | `api/emails/templates/revenue.test.ts:158`, `:205`; `core/notifications/catalog.test.ts:22`; outbox rows asserted per call site (e.g. `charge-handlers.int.test.ts:138`, `period-rollover.int.test.ts:173`) | ✅ |
| REC-160 | staff events `new_subscription`, `renewal_failed` | `charge-handlers.int.test.ts:157`, `:330`. "Honoring `notifications.events`" belongs to the notification port, which is nucleo's no-op default until gestao registers its port (`api/extensions/index.ts:26-45` registers no notification port); receita only emits | ✅ |
| REC-161 | renewal charge/reminder: amount, due date, method, Pix copy-paste | `revenue.test.ts:127`, `:157`, `:171` | ✅ |

**Status**: ❌ 157 PASS (153 with test evidence, 4 rows partly on a code path: REC-09, REC-35, REC-45, REC-160), 3 PARTIAL (REC-68, REC-73, REC-108: mutants survived), 1 FAIL at `ca9f709` (REC-136: red test, fixed on `main` by `8261082` per the orchestrator) of 161.

### Accepted SPEC_DEVIATIONs (marked in code/tests and justified)

1. `apps/api/src/routes/app/subscriptions.int.test.ts:160` — a purchase without `Idempotency-Key` answers 400 `BAD_REQUEST` (nucleo middleware on every money route), not 422; also recorded in design.md "Lane A notes (Phases 5–6)". REC-20 itself (replay / mismatch) is met.
2. `apps/api/src/modules/subscriptions/quote.service.ts:166` — an open holiday keeps the weekday hours for a fixed schedule, so the PRD example (Meio turno 07:00–09:30 from 2026-11-02, 22 occurrences incl. Finados and Consciência Negra) holds (REC-83/REC-90). Not listed in design.md "Lane A notes" (doc-only finding F4).

---

## Discrimination Sensor

Sensor depth: P0 (money, minutes, coupons, subscription lifecycle): 16 manual behavior-level mutants. Each mutant was applied by `node_modules/.cache/verify/sensor.mjs` (outside git), which requires exactly one textual match. Core mutants ran in a scratch copy of `packages/core` (`node_modules/.cache/verify/core`, so the API suite running at the same time never saw them) and were restored by rewriting the original text (scratch diffed identical to `packages/core/src` afterwards). API mutants ran in place after the full API suite, one at a time, on `receita_verify`, and each file was restored with `git checkout -- <file>`. `git status --porcelain` matched the baseline (only the untracked temporary e2e config) after every mutant. Killed = the named test file failed on an `AssertionError` (checked in the log).

| # | File:line | Mutation | Tests run | Result |
| - | --------- | -------- | --------- | ------ |
| C1 | `core/packages/debit.ts:47` | single ceiling of the exact extra → floor | `packages/debit.test.ts` | ✅ Killed (3 failed: 77 ≠ 78, 184 ≠ 185, 151 ≠ 152) |
| C2 | `core/pricing/discounts.ts:67` | tie goes to the coupon (`>` → `>=`) | `pricing/discounts.test.ts` | ✅ Killed (`:112` tie keeps slot) |
| C3 | `core/pricing/discounts.ts:30` | fixed coupon not capped at gross | `pricing/discounts.test.ts` | ✅ Killed (`:42`, 50000 ≠ 16000) |
| C4 | `core/packages/conversion.ts:15-19` | conversion half-up → floor | `packages/conversion.test.ts` | ✅ Killed (`:21`, 0 ≠ 1) |
| C5 | `core/packages/compensation.ts:31` | fixed compensation half-up → floor | `packages/conversion.test.ts` | ✅ Killed (`:65`, 0 ≠ 1) |
| C6 | `core/packages/allocation.ts:49` | lot usable when it outlives now only (booking start ignored) | `packages/allocation.test.ts` | ✅ Killed (`:48`) |
| C7 | `core/packages/allocation.ts:108` | refund returns credit first (retained consumes cash) | `packages/allocation.test.ts` | ✅ Killed (`:220`) |
| A1 | `api/modules/coupons/coupons.service.ts:341` | coupon limit `uses_count < max_uses` → `<=` | `modules/coupons/coupons.service.int.test.ts` | ✅ Killed (`:34`: the second reserve no longer answers 409 `COUPON_EXHAUSTED`) |
| A2 | `api/modules/subscriptions/cancel.service.ts:294` | grace end one day late (`- grace - 1`) | `jobs/period-rollover.int.test.ts`, `modules/subscriptions/cancel.service.int.test.ts` | ✅ Killed (3 failed: `:137` ended 0 ≠ 1 on 2026-12-09, `:173`, cancel `:355`) |
| A3 | `api/modules/subscriptions/cancel.service.ts:246` | suspension one day after `starts_on` | same two files | ✅ Killed (4 failed: rollover `:124` suspended 0 ≠ 1, `:137`, cancel `:332`, `:407`) |
| A4 | `api/modules/subscriptions/switch.service.ts:484` | `completeSwitch` no longer cancels the old pending renewal period and its charge | `modules/subscriptions/switch.service.int.test.ts`, `routes/app/subscriptions.int.test.ts` | ❌ **Survived** (26/26 passed) → F3 |
| A5 | `api/modules/subscriptions/compensation.service.ts:86` | hour packages compensated for a single-room closure | `modules/subscriptions/compensation.service.int.test.ts` | ✅ Killed (2 failed: `:178` subscribers 2 ≠ 1, `:195`) |
| A6 | `api/modules/packages/package-payment.service.ts:386` | tenant late cancel returns minutes (guard moved to `clinic`) | `modules/packages/package-payment.service.int.test.ts` | ✅ Killed (2 failed: `:306` 78 ≠ 0, `:320` 0 ≠ 78) |
| A7 | `api/modules/packages/package-payment.service.ts:160` | extra lots unusable once the user has no live hour package (cancelled/ended/switched) | `modules/packages/package-payment.service.int.test.ts`, `modules/revenue/steps.int.test.ts` | ❌ **Survived** (all package-payment tests pass; the only red test was the pre-existing REC-136 failure, unrelated) → F2 |
| A8 | `api/modules/credits/credits.service.ts:121` | credit lots read without `FOR UPDATE` | `modules/credits/credits.service.int.test.ts` | ❌ **Survived** (8/8 passed) → F4 |
| A9 | `api/modules/subscriptions/period.service.ts:270` | renewal priced from the previous period instead of the current category | `modules/subscriptions/period.service.int.test.ts` | ✅ Killed (`:210`, 170000 expected) |

**Result**: 13/16 killed (core 7/7, API 6/9); survivors A4, A7, A8 → findings F2–F4 - FAIL ❌

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep (receita registers through nucleo's registry, no duplicated checkout path) | ✅ |
| Surgical changes, matches patterns (guarded `UPDATE … WHERE status`, `withTransaction`, `revenueMailer` single helper) | ✅ |
| Spec-anchored outcome check (PRD values asserted verbatim: 78/185/152/84/120, 384, 40/20533, 616000, 2190, 14000/7000, 2026-12-09) | ✅ |
| Per-layer coverage (core 1:1 ACs; routes happy + validation + 401/403/404 + error codes; contract schemas parse bodies) | ✅ |
| Every test maps to an AC, edge case or Done-when (REC tags in 137 files) | ✅ |
| Documented guidelines followed: `.specs/STATE.md` AD-010/AD-018, `docs/architecture.md` §11, tasks.md Test Coverage Matrix | ✅ |

---

## Edge Cases (spec.md:493-504)

- [x] Last package minutes raced → period row lock (`minutes.service.int.test.ts:125`, `package-payment.service.int.test.ts:260`)
- [x] Duplicate renewal webhook → no change (`charge-handlers.int.test.ts:190`)
- [x] Renewal approved while suspended → regularization (`charge-handlers.int.test.ts:338`)
- [x] Renewal approved after ended → refund (`charge-handlers.int.test.ts:353`)
- [x] Active gateway changed → Pix (`renewals.int.test.ts:173`, card of another provider via `purchase.service.int.test.ts:197`)
- [x] Past closed day → nucleo rejects (nucleo NUC-49, `calendar-exceptions.int.test.ts:409`)
- [x] Window ending at 1440 → next local day (`occurrences.test.ts:59`)
- [x] Reference category changed between quote and create → server recomputes (`debitForBooking` recomputes under lock, `package-payment.service.ts:266-315`; code path)
- [x] Lot expired between quote and create → recompute, may 422 (same code path; `allocation.test.ts:48`)
- [x] Coupon `valid_until` passes during hold → reserved use still consumed (`consumeUse` has no validity filter, `coupons.service.ts:381-387`; code path)
- [x] Deleted users skipped by jobs (code path: subscriptions of anonymized users are cancelled by gestao's flow; receita jobs only act on `active`/`suspended`/`awaiting_payment` rows)
- [x] Included minutes below one debit → `insufficient` (`allocation.test.ts`, `package-payment.service.int.test.ts:248`)

---

## Gate Check

All commands ran in the verifier worktree with `TEMP`, `TMP` and `npm_config_cache` under `node_modules/.cache` (drive C: nearly full).

| Gate | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `npm run typecheck` | ✅ exit 0 (web, api, core) |
| Lint | `npm run lint` | ✅ exit 0 |
| Core | `npm test -w packages/core` | ✅ 32 files, 1191 tests passed |
| Web | `npm test -w apps/web -- --maxWorkers=2` | ✅ 138 files, 1191 tests passed (393 s) |
| API | `npm test -w apps/api` (full suite on `receita_verify`) | ❌ 90 files, 951 tests: 950 passed, **1 failed** (`modules/revenue/steps.int.test.ts:435`, REC-136, F1); 4144 s. The isolated re-run of that file at 15:07 BRT failed the same test (1 of 14). No `ENOTFOUND` blips. |
| E2E | Playwright suite of `apps/web/e2e` (7 tests × 2 projects) | ⚠️ 14 tests: 12 passed, 2 failed, both nucleo `booking.spec.ts:214` "availability p95 ≤ 300 ms" (p95 333 ms desktop, 306 ms mobile). Re-run of that test alone: desktop 314 ms ✘, mobile 298 ms ✓. Every receita e2e test passed in both projects: `receita-hour-package.spec.ts:26`, `receita-discounts.spec.ts:48`, `receita-fixed-and-renewals.spec.ts:69` (T48–T50) |

E2E setup: an unrelated Docker stack holds `0.0.0.0`/`[::]:5173` and answers every path with 200, so Playwright's pre-start URL check refused `127.0.0.1:5173`. The verifier therefore ran `npx vite build` and served `npx vite preview --host 127.0.0.1 --port 5173 --strictPort` itself. The more specific bind wins for 127.0.0.1, checked with the page title "Bravô Clinic – Salas Inteligentes". The suite ran with a temporary, uncommitted `apps/web/playwright.verify.config.ts`. That config spreads `playwright.config.ts`, keeps only the API seed web server (`apps/api/test/e2e-seed.ts`, which resets `receita_verify`), and adds the Chrome arg `--host-resolver-rules=MAP localhost 127.0.0.1`. It ran with `NODE_OPTIONS=--dns-result-order=ipv4first`. The config, the build output (`apps/web/dist`) and the preview process (verified by its command line) were removed or stopped afterwards. The p95 test is the known latency-sensitive nucleo check against the remote verify branch; it is not a receita AC.

- **Skipped tests**: none.
- **Test count**: the counts above are the whole repository suites at `ca9f709`; receita adds 137 test files carrying REC tags.

---

## Findings and Fix Plans

### F1 (Blocker for the gate, fixed on `main` per the orchestrator): REC-136 test depends on the wall clock

- **Symptom**: `apps/api/src/modules/revenue/steps.int.test.ts:435` "marks available cells inside an active discount with discountPercent" fails at `ca9f709` with `expected [ undefined, 10 ] to deeply equal [ 10, 10 ]`. It failed in the full API run (about 14:05 BRT) and again in an isolated re-run at 15:07 BRT, 1 of 14 failed both times.
- **Root cause**: the test pins `TUE = '2026-10-27'` (`steps.int.test.ts:51`) and injects the clock `NOW = 2026-10-20` (`:50`). But `slotDiscountDecorator` read `new Date()` (`apps/api/src/modules/revenue/ports.ts:129`) and drops the discount of every cell before the real current minute (`:132`, `:138`). 2026-10-27 is today, so the 14:00 cell lost its discount after 14:00. From tomorrow on the whole day is in the past and both cells would fail.
- **Status**: the orchestrator reports the fix `8261082` "fix(api): use the request clock in availability decorators" (`extensions/registry.ts`, `availability/availability.service.ts`, `revenue/ports.ts`; decorators now receive `now`). The verifier saw the commit (`git show --stat 8261082`) but did not run it, because it was told not to move to a newer `main` mid-run. Re-verify `steps.int.test.ts` in the next iteration.
- **Residual risk of the same kind (not failing today)**: other receita registry implementations still read the wall clock instead of the request clock:
  - `apps/api/src/modules/revenue/steps.ts:172`: `persist` ignores the `ctx.now` it receives.
  - `steps.ts:179`: `onConfirmed`, which consumes the coupon and splits the slot discount.
  - `steps.ts:186`: `release`.
  - `steps.ts:315` and `:343`: the credit step.
  - `apps/api/src/modules/revenue/ports.ts:31` and `:40`: the package mode handler.
  - `ports.ts:64`: the credit port `grant`.
  - `ports.ts:120`: compensation.

  The effect: ledger and refund timestamps follow the wall clock while jobs and e2e inject `--now`. Tests pinned to calendar dates near today, such as `steps.int.test.ts:112` (slot discount Tue 2026-10-27 14:00–16:00), can turn red as real time passes.
- **Fix task**:
  - Use `ctx.now` in `discountStep.persist` (`steps.ts:172`).
  - Add `now` to the nucleo seams for `CheckoutStep.onConfirmed/release`, `PaymentModeHandler.reschedule/cancel` and `CreditPort.grant`, as an additive change the way `8261082` did for decorators, and pass the payment/booking service clock.
  - Move test calendar dates away from the real calendar, or derive them from `NOW`.
  - Done when `steps.int.test.ts` passes with a faked system time after 2026-10-28.
- **Priority**: Blocker (gate red at `ca9f709`); Minor for the remaining wall-clock reads.

### F2 (Major): REC-68 lots usable after cancel / switch / end are not tested (sensor A7 survived)

- **Gap**: only the suspended case is asserted (`package-payment.service.int.test.ts:182`). The mutant changes `apps/api/src/modules/packages/package-payment.service.ts:160` to return no option whenever the user has no live hour package (`if (subscription === null)`). Every package-payment and steps test still passes with it.
- **Fix task**: in `apps/api/src/modules/packages/package-payment.service.int.test.ts`, add one test per terminal status (`cancelled`, `ended`, `switched`), or a single `it.each`. Each sets up a subscriber with that status plus `createExtraLot(300)`. `quotePackageOption` for Wed 19:00–20:00 must answer `sufficient: true`, `fromPackageMinutes: 0`, `fromExtraMinutes: 78`, and `debitForBooking` must leave the lot at 222. Done when mutant A7 is killed.
- **Priority**: Major (a regression could make tenants lose extra minutes they paid for).

### F3 (Major): REC-73 "cancel its pending renewal" on switch approval is not tested (sensor A4 survived)

- **Gap**: `switch.service.int.test.ts:159` asserts every other part of REC-73, but its setup has no pending renewal. Deleting `await cancelFuturePeriods(tx, ctx, old.id, now);` (`apps/api/src/modules/subscriptions/switch.service.ts:484`) passes all 26 switch and route tests. With that bug, the old subscription's `awaiting_payment` renewal period and its pending charge would survive the switch and could still be charged.
- **Fix task**: add a test in `switch.service.int.test.ts` where the old subscription has a seq 2 `awaiting_payment` renewal with a `pending` charge, set up like `hourWithRenewal` in `cancel.service.int.test.ts`. After the switch approval, assert the period is `cancelled` and the charge is `cancelled`. Done when mutant A4 is killed.
- **Priority**: Major (money: a subscriber who switched could be billed for the old package).

### F4 (Major): REC-108 parallel credit test does not force the race (sensor A8 survived)

- **Gap**: `credits.service.int.test.ts:140` runs two `applyCredits` calls in `Promise.all`. Removing `FOR UPDATE` on the credit lots (`apps/api/src/modules/credits/credits.service.ts:121`) still passes 8/8, because the two transactions do not overlap in practice and the test never exercises the lock. Without the lock, the second use would read a stale balance and hit the `remaining_cents >= 0` check: a 500 instead of a correct partial use of 2000.
- **Fix task**: force the two transactions to overlap. In transaction A, call `applyCredits`, then wait until transaction B has issued its `SELECT … FOR UPDATE` before committing. A simpler option is `pg_sleep(0.3)` before A commits, with B started after A takes its lock. Assert that B uses 2000 and both lots end at 0. Another option is to repeat the race 20 times (spec Success Criteria: "20 consecutive runs"). Done when mutant A8 is killed. Check `minutes.service.int.test.ts:125` and `package-payment.service.int.test.ts:260` for the same pattern (not mutated in this run).
- **Priority**: Major (concurrency AC of PRD §8).

### F5 (Minor, documentation / precision)

- `apps/api/src/modules/subscriptions/quote.service.ts:166` SPEC_DEVIATION (open holidays keep weekday hours for fixed schedules) is justified in code but not listed in design.md "Lane A notes"; add it there.
- `apps/api/src/routes/admin/subscriptions.int.test.ts:152` asserts only `403` for reception (REC-45, REC-153); add `expect(res.error?.code).toBe('FORBIDDEN')` as `coupons.int.test.ts:200` does.
- REC-09 (`admin_only` keeps renewing) and REC-35 (`no_show` returns nothing) rest on code paths only. One test each would pin them:
  - REC-09: `renewals.int.test.ts:202` with `visibility: 'admin_only'`.
  - REC-35: a package booking moved to `no_show` by `jobs/no-shows.ts` keeps its debit.

---

## Requirement Traceability Update

Not changed by the verifier (the orchestrator flips statuses after a PASS). Recommended: keep REC-68, REC-73, REC-108 and REC-136 as "Needs Fix" until F1–F4 are closed; the other 157 can be marked Verified after the re-verification.

---

## Summary

**Overall**: ❌ Not Ready (iteration 1 of 3)

**Spec-anchored check**: 157 pass / 3 partial / 1 fail of 161
**Sensor**: 13/16 killed (core 7/7, API 6/9); survivors A4, A7, A8 → findings F2–F4 - FAIL ❌
**Gate**: typecheck ✅, lint ✅, core 1191/1191 ✅, web 1191/1191 ✅, API 950/951 ❌ (REC-136 wall-clock test), e2e 12/14 (both failures: nucleo p95 latency check; receita flows 6/6 ✅)

**What works**: every PRD worked example (debit 120/78/185/84/152, conversion 360 → 384, compensation 40 min and R$ 205,33, fixed price 22 × R$ 280,00, coupon 2190, larger-discount 14000 with deposit 7000, grace end 2026-12-09) is asserted verbatim in core and at least one API test; concurrency ACs (package debit, credits, last coupon use) run parallel transactions; all four jobs are re-run-safe and 401 without a trigger.

**Next steps**: Route F1 (re-verify with `8261082` and sweep the residual wall-clock reads), F2, F3 and F4 to an implementer as test-strengthening tasks; F5 is optional polish. Then re-verify: full API suite, and mutants A4, A7, A8 must be killed.

---

# Iteration 2

## Validation verdict (iteration 2): PASS

**Date**: 2026-10-27 (iteration 2 of 3), runs between 19:05 and 23:20 BRT
**Commit verified**: `27b56bc` (`main`: receita + iteration-1 fixes). Not moved mid-run.
**Fix commits re-checked**: `8261082` (decorator clock, landed before iteration 1 finished) and `git log 9abb7c9..27b56bc`: `b0fdc11` (clock through the seams), `85ea193` (F2), `1cc43ca` (F3), `cbc973b` (F4), `a821aca` (F5 doc), `5968167` (F5 tests).
**Verifier**: a new independent sub-agent (author ≠ verifier; it wrote none of the receita code, tests or fixes), worktree branch `worktree-agent-a39fdb2740500c19d` at `27b56bc`.
**Test DB**: a fresh database `receita_verify_it2`, created for this run on the Neon verify branch (`DATABASE_URL_VERIFY`). Its host differs from production `DATABASE_URL` and from the dev `DATABASE_URL_TEST`, which another worker uses. Only the untracked worktree `.env` pointed `DATABASE_URL_TEST` at it. Dropped at the end of the run (see Cleanup).

Same path prefixes as iteration 1: `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`, `e2e/` = `apps/web/e2e/`.

---

## Findings F1–F5 re-checked

### F1 (wall clock in receita decisions): ✅ Closed

- **Grep, receita modules and jobs.** `grep -rnE "new Date\(\)|Date\.now\(\)"` over `api/modules/{revenue,subscriptions,packages,credits,coupons,slot-discounts,extra-hours}`, `api/jobs`, `api/routes/app/{subscriptions,purchases}.ts` and `api/routes/admin` (tests excluded) leaves two hits, and neither is a business decision:
  - `api/jobs/cli.ts:20`: the CLI's default clock, which is the clock source itself.
  - `api/jobs/runner.ts:73`: `job_runs.finished_at` metadata.
- **Grep, SQL clocks.** Receita has no SQL `now()` or `current_date`. Across the whole API source, the remaining wall-clock reads are nucleo's injectable defaults (`app.ts:23`, `auth/session.ts`, `calendar.repo.ts:229`, `lib/ics.ts:134`) and `updatedAt` stamps. Every receita caller of `loadDayContexts` and `buildIcs` passes `now` (`subscriptions/{cancel,period,purchase,quote,switch}.service.ts`, `slot-discounts.service.ts:133`, `occurrences.service.ts:184`).
- **Seam callers.** Every caller of a seam that `b0fdc11` or `8261082` changed in `api/extensions/registry.ts:70-131` passes a request or job clock:

  | Seam | Callers and the clock they pass |
  | ---- | ------------------------------- |
  | `CheckoutStep.onConfirmed` | `booking/create-booking.service.ts:400` (`now = deps.now()`, `:202`); `payments/payment-effects.service.ts:169` and `booking/staff-booking.service.ts:130` (`deps.now()`) |
  | `CheckoutStep.release` | `booking/cancel.service.ts:303` (`deps.now()`, `:195`); `booking/expire-booking.ts:52`, fed by `jobs/expire-holds.ts:57` (job `now`) and `booking/create-booking.service.ts:185` (`args.now`); `jobs/charge-balances.ts:79` (job `now`) |
  | `PaymentModeHandler.cancel` | `booking/cancel.service.ts:250` |
  | `PaymentModeHandler.reschedule` | `booking/reschedule.service.ts:717` (`deps.now()`, `:696`) |
  | `CreditPort.grant` | `cancel.service.ts:261` and `reschedule.service.ts:830` (`now`) |
  | `ClosedDayCompensationPort.apply` | `calendar/exceptions.service.ts:233`, called with `now()` from `routes/admin/calendar-exceptions.ts:99` |
  | `AvailabilityDecorator.decorate` | `availability/availability.service.ts:195`, `:315` |

  The implementations use what they receive (`api/modules/revenue/ports.ts:24-41`, `:64`, `:118-121`, `:128-131`; `api/modules/revenue/steps.ts:172`, `:178-186`, `:314`, `:326-345`). `tsc` enforces the new parameters, because they are required and not optional.
- **The iteration-1 failure no longer reproduces.** `api/modules/revenue/steps.int.test.ts:435` (REC-136) passed in the full API run at about 19:30 BRT on 2026-10-27, its own pinned date `TUE` (`:51`), after 14:00. Iteration 1 failed at exactly that point.
- **Time-travel run (fix-task "Done when").** A temporary vitest config, never committed and kept under `node_modules/.cache/verify/tt`, added a setup file. That file fakes only `Date` to `2026-11-10T15:00Z` (`vi.useFakeTimers({ toFake: ['Date'] })`), so any wall-clock read sees a date long after the tests' injected `NOW` of 2026-10-20. Under it, `steps.int.test.ts`, `packages/package-payment.service.int.test.ts`, `credits/credits.service.int.test.ts` and `subscriptions/compensation.service.int.test.ts` passed 52/52. The fake clock is effective: mutant N1 (below) fails under it.
- The test dates were not moved off the real calendar, as iteration 1 had suggested. That is no longer needed, because nothing in the paths these tests cover reads the system clock.

### F2 (REC-68): ✅ Closed

`api/modules/packages/package-payment.service.int.test.ts:198` adds an `it.each` over cancelled, switched and ended subscriptions, each with a closed period and a 300-minute lot:
- `quotePackageOption` returns `{ debitMinutes: 78, sufficient: true, fromPackageMinutes: 0, fromExtraMinutes: 78 }`.
- `debitForBooking` leaves the lot at 222.

The suspended case stays at `:184`. Mutant A7 is now killed (3 failed: `expected null to match object { debitMinutes: 78 }`).

### F3 (REC-73 pending renewal): ✅ Closed

`api/modules/subscriptions/switch.service.int.test.ts:196` gives the old subscription a seq 2 `awaiting_payment` renewal (`createRenewalPeriod`) with a `pending` charge. After approval:
- the old subscription is `switched`;
- the periods are `[[1,'closed'],[2,'cancelled']]`;
- the renewal charge is `cancelled`.

Mutant A4 is now killed.

### F4 (REC-108 race): ✅ Closed

`api/modules/credits/credits.service.int.test.ts:162` makes the two uses overlap:
- Use A keeps its transaction open after its writes.
- Use B starts after A, and A commits only after `untilALockIsAwaited()` (`:45`) sees a session waiting on a lock in `pg_stat_activity`.
- The test asserts `results.map(r => r.usedCents)` = `[8000, 2000]` and every lot at 0.

Mutant A8 is now killed: B's stale read drives a lot below zero and trips `credit_lots_remaining_check`, so the test fails. Control N6 shows that the barrier is what makes the test discriminating.

### F5 (doc and precision): ✅ Closed

- `design.md` "Lane A notes" now lists the open-holiday SPEC_DEVIATION (`a821aca`; code `api/modules/subscriptions/quote.service.ts:166`).
- `api/routes/admin/subscriptions.int.test.ts:153` asserts `res.error?.code === 'FORBIDDEN'` (REC-45, REC-153).
- REC-09 `admin_only`: `api/jobs/renewals.int.test.ts:212` (seq 2 `awaiting_payment`, one charge).
- REC-35 `no_show`: `package-payment.service.int.test.ts:336`, through the real `noShows` job: booking `no_show`, period balance 0, lot 262, no `refund` entry.

---

## Spec-Anchored Acceptance Criteria (iteration 2)

### ACs that iteration 1 marked PARTIAL or FAIL

| AC | Spec-defined outcome | Evidence at `27b56bc` | Iteration 1 | Iteration 2 |
| -- | -------------------- | --------------------- | ----------- | ----------- |
| REC-68 | unexpired lots stay usable after cancel, switch, suspend or end | `package-payment.service.int.test.ts:198` (`it.each` cancelled/switched/ended: `fromExtraMinutes: 78`, lot 222), `:184` (suspended); sensor A7 killed | ⚠️ PARTIAL | ✅ PASS |
| REC-73 | one tx: old `switched` + `switched_to`, `conversion_out`, period closed, **pending renewal cancelled**, new active, `period_grant` + `conversion_in` | `switch.service.int.test.ts:162` (all but the renewal), `:196` (period 2 `cancelled`, charge `cancelled`); sensor A4 killed | ⚠️ PARTIAL | ✅ PASS |
| REC-108 | concurrent uses never exceed the available amount; no lot negative | `credits.service.int.test.ts:162` (forced overlap, `[8000, 2000]`, lots 0); sensor A8 killed | ⚠️ PARTIAL | ✅ PASS |
| REC-136 | available cells inside an active discount carry `discountPercent`; web "−{p}%" | `steps.int.test.ts:435` (`[10, 10]` at 14:00 and 15:30, `undefined` outside); green in the full run after 14:00 on its own date and in the time-travel run; e2e `receita-discounts.spec.ts:48` (both projects); sensor N1 killed | ❌ FAIL | ✅ PASS |

### Rows that rested on a code path in iteration 1

| AC | Evidence now | Result |
| -- | ------------ | ------ |
| REC-09 (`admin_only` keeps renewing) | `renewals.int.test.ts:212`, plus inactive at `:202` | ✅ PASS (test) |
| REC-35 (`no_show` returns nothing) | `package-payment.service.int.test.ts:336`, plus tenant late at `:361`; sensor A6 killed | ✅ PASS (test) |
| REC-45 / REC-153 (reception 403 `FORBIDDEN`) | `admin/subscriptions.int.test.ts:126`, `:153` | ✅ PASS (test) |
| REC-160 | unchanged: receita emits `new_subscription` / `renewal_failed` (`charge-handlers.int.test.ts:157`, `:330`); honoring `notifications.events` is the nucleo/gestao notification port | ✅ PASS (partly code path, as accepted in iteration 1) |

### Spot-check of ACs whose code the seam change touched

All rows below passed in the full API run (`27b56bc`, real clock). The rows from the four files of the time-travel run also passed under the fake clock.

| Area | AC | Evidence (unchanged assertions, re-run) | Result |
| ---- | -- | --------------------------------------- | ------ |
| Credit grant | REC-105 | `credits.service.int.test.ts:66` (expiry = now + `credits.validity_days`, `grant` entry) | ✅ |
| Credit grant | REC-110 | `steps.int.test.ts:352` (cheaper reschedule → `reschedule_difference` lot 6300, `creditCents` 6300) | ✅ |
| Credit grant | REC-111 | `steps.int.test.ts:333` (clinic cancel → `clinic_cancellation` lot) | ✅ |
| Credit release | REC-109 | `steps.int.test.ts:316` (tenant cancel returns the credit share through `creditStep.release`); `credits.service.int.test.ts:214`, `:227` | ✅ |
| Credit release | REC-107 | `steps.int.test.ts:298` (`creditStep.persist` with `ctx.now`, one internal charge) | ✅ |
| Closed-day compensation | REC-98..REC-100, REC-104 | `compensation.service.int.test.ts:108`, `:159`, `:203`; route `routes/admin/calendar-exceptions.int.test.ts:357` (port `apply` called with the new ids) | ✅ |
| Closed-day compensation | REC-101..REC-103 | `compensation.service.int.test.ts:178`, `:214`, `:245`; sensor A5 killed | ✅ |
| Reschedule | REC-37 | `steps.int.test.ts:264` (through `packageModeHandler.reschedule`); `package-payment.service.int.test.ts:443`, `:457` | ✅ |
| Reschedule | REC-95 | `steps.int.test.ts:375` | ✅ |
| Cancel | REC-34 | `steps.int.test.ts:240` (through `packageModeHandler.cancel`); `package-payment.service.int.test.ts:317` | ✅ |
| Cancel | REC-35 | see above | ✅ |
| Cancel | REC-36 | `package-payment.service.int.test.ts:375` | ✅ |
| Cancel | REC-38 | `package-payment.service.int.test.ts:406` | ✅ |
| Cancel | REC-94 | `steps.int.test.ts:375` | ✅ |
| Coupon and slot-discount steps | REC-124, REC-138 | `steps.int.test.ts:112` (reserved → consumed, slot part consumed by the booking), `:159` (`expireHoldingBooking(…, NOW)` → `released`) | ✅ |

### Updated per-AC summary

| Result | Iteration 1 | Iteration 2 |
| ------ | ----------- | ----------- |
| ✅ PASS with test evidence | 153 | 160 |
| ✅ PASS, partly on a code path | 4 (REC-09, REC-35, REC-45, REC-160) | 1 (REC-160) |
| ⚠️ PARTIAL | 3 (REC-68, REC-73, REC-108) | 0 |
| ❌ FAIL | 1 (REC-136) | 0 |
| **Total** | 161 | **161 PASS / 161** |

The other 153 ACs were not re-derived one by one. Their test files ran green in the full suite at `27b56bc`. The fix commits changed only the seam signatures and the tests listed above, and the spot-check covers every AC on those seams.

---

## Discrimination Sensor (iteration 2)

Method:
- The mutants were applied by a script outside git (scratchpad `sensor.cjs` + `mutants.json`) that requires exactly one textual match.
- **Core mutants** ran in a scratch copy, `node_modules/.cache/verify/packages/core`. Afterwards that copy's `src/` was `diff -r`-identical to `packages/core/src`.
- **API mutants** ran in place on `receita_verify_it2` after the full API suite had finished, strictly one at a time. Each file was restored with `git checkout -- <file>`, and `git status --porcelain` was recorded after every mutant. It always held only the then-present temporary e2e config.
- `[tt]` marks a run under the time-travel clock (system `Date` = 2026-11-10T15:00Z, injected test clocks unchanged).

**Process note.** A first API mutant batch was aborted: its revert path failed, and stopping the batch did not kill its bash loop. Two loops then ran concurrently on the database, which produced deadlocks and invalid results. Every stray process of this worktree was killed, the tree was restored with `git checkout -- apps/api/src`, and A2–A9 and N1–N7 were re-run alone. Only those clean runs are reported. A1 and the time-travel baseline ran before the overlap and are valid.

### The 16 iteration-1 mutants, re-applied

| # | File:line | Mutation | Tests run | Iteration 1 | Iteration 2 |
| - | --------- | -------- | --------- | ----------- | ----------- |
| C1 | `core/packages/debit.ts:46` | single ceiling → floor | `packages/debit.test.ts` | Killed | ✅ Killed (3: 77≠78, 184≠185, 151≠152) |
| C2 | `core/pricing/discounts.ts:67` | tie goes to coupon (`>` → `>=`) | `pricing/discounts.test.ts` | Killed | ✅ Killed (tie keeps slot) |
| C3 | `core/pricing/discounts.ts:30` | fixed coupon not capped | `pricing/discounts.test.ts` | Killed | ✅ Killed (50000≠16000) |
| C4 | `core/packages/conversion.ts:15` | half-up → floor | `packages/conversion.test.ts` | Killed | ✅ Killed (0≠1) |
| C5 | `core/packages/compensation.ts:31` | half-up → floor | `packages/conversion.test.ts` | Killed | ✅ Killed (0≠1) |
| C6 | `core/packages/allocation.ts:49` | booking start ignored for lot expiry | `packages/allocation.test.ts` | Killed | ✅ Killed |
| C7 | `core/packages/allocation.ts:108` | refund returns credit first | `packages/allocation.test.ts` | Killed | ✅ Killed (cash 0≠8000) |
| A1 | `api/modules/coupons/coupons.service.ts:341` | `uses_count < max_uses` → `<=` | `coupons.service.int.test.ts` | Killed | ✅ Killed (`:34` race no longer 409 `COUPON_EXHAUSTED`) |
| A2 | `api/modules/subscriptions/cancel.service.ts:294` | grace end one day late | `period-rollover.int.test.ts`, `cancel.service.int.test.ts` | Killed | ✅ Killed (3 failed: ended 0≠1) |
| A3 | `api/modules/subscriptions/cancel.service.ts:246` | suspension one day after `starts_on` | same two files | Killed | ✅ Killed (4 failed: suspended 0≠1) |
| A4 | `api/modules/subscriptions/switch.service.ts:484` | `cancelFuturePeriods` removed | `switch.service.int.test.ts` | **Survived** | ✅ Killed (`:196`: `[2,'awaiting_payment']` ≠ `[2,'cancelled']`) |
| A5 | `api/modules/subscriptions/compensation.service.ts:85` | hour packages compensated for a one-room closure | `compensation.service.int.test.ts` | Killed | ✅ Killed (2 failed) |
| A6 | `api/modules/packages/package-payment.service.ts:386` | late tenant cancel returns minutes | `package-payment.service.int.test.ts` | Killed | ✅ Killed (78≠0, 0≠78) |
| A7 | `api/modules/packages/package-payment.service.ts:160` | lots unusable without a live hour package | `package-payment.service.int.test.ts` | **Survived** | ✅ Killed (3 failed, `:198` × 3) |
| A8 | `api/modules/credits/credits.service.ts:120` | credit lots read without `FOR UPDATE` | `credits.service.int.test.ts` | **Survived** | ✅ Killed (`:162`, `credit_lots_remaining_check` on the stale update) |
| A9 | `api/modules/subscriptions/period.service.ts:270` | renewal priced from the previous period | `period.service.int.test.ts` | Killed | ✅ Killed |

**16/16 killed** (core 7/7, API 9/9). All three iteration-1 survivors are now killed.

### New mutants on the changed seam code

| # | File:line | Mutation | Tests run | Result |
| - | --------- | -------- | --------- | ------ |
| N1 | `api/modules/revenue/ports.ts:128` | decorator reads `new Date()` again (the `8261082` regression) | `steps.int.test.ts`, real clock and `[tt]` | ✅ Killed both times (`:435`: `[undefined, undefined]` ≠ `[10, 10]`) |
| N2 | `api/modules/payments/payment-effects.service.ts:169` | `onConfirmed(…, new Date())` instead of `deps.now()` | `steps.int.test.ts` `[tt]` | Survived: **equivalent**. In `onConfirmed` the clock only stamps `coupon_uses.consumed_at` and the `created_at` of split slot-discount parts (`slot-discounts.service.ts:284`); no AC outcome depends on it |
| N3 | `api/modules/booking/cancel.service.ts:250` | `handler.cancel(…, new Date())` | `steps.int.test.ts`, `routes/app/cancel.int.test.ts` `[tt]` | Survived (F6): changes only the lot-expiry test and the new `manual` lot's `expires_at` in `returnForCancellation`; no route-level test pins either against the request clock |
| N4 | `api/modules/booking/create-booking.service.ts:400` | `onConfirmed(…, new Date())` | `steps.int.test.ts` `[tt]` | Survived: **equivalent** (timestamps only, as N2) |
| N5 | `api/modules/packages/package-payment.service.ts:107` | active period read without `FOR UPDATE` during the debit | `package-payment.service.int.test.ts`, `minutes.service.int.test.ts` | Survived: **equivalent for REC-32**. `debitPeriod` → `addPeriodEntry` locks the period again and re-checks the balance (`packages/minutes.service.ts:70-73`), so the race still ends with one winner, one 422 and no negative balance |
| N6 | `api/modules/credits/credits.service.int.test.ts:185` (test) + A8 | lock-wait barrier `await untilALockIsAwaited()` dropped, with `FOR UPDATE` removed | `credits.service.int.test.ts` | Control: A8 **survives** without the barrier (8/8 pass). The barrier is load-bearing, and with it A8 is killed. With the barrier dropped on the real code (N6c), 8/8 pass |
| N7 | `api/modules/revenue/ports.ts:64` | `CreditPort.grant` uses `new Date()` instead of `input.now` | `steps.int.test.ts` `[tt]` | Survived (F6): only the granted lot's `expires_at` moves; `steps.int.test.ts:352` asserts source and amount, not expiry |

**Sensor result**: the 16 iteration-1 mutants are 16/16 killed. Of the 6 new product mutants, 1 is killed (N1), 3 are equivalent (N2, N4, N5) and 2 survive (N3, N7), with N6 as a control. N3 and N7 do not change behavior in production. In a request path `deps.now` is `() => new Date()` (`api/app.ts:23`), so the seam clock and the wall clock differ by milliseconds and no spec-defined outcome changes. They are therefore recorded as a Minor test-hardening finding (F6) and do not block the feature. **Sensor: PASS.**

---

## Gate Check (iteration 2)

Every command ran in the verifier worktree, with `TEMP`, `TMP` and `npm_config_cache` under `node_modules/.cache`.

| Gate | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `npm run typecheck` | ✅ exit 0 (web, api, core) |
| Lint | `npm run lint` | ✅ exit 0 |
| Core | `npm test -w packages/core` | ✅ 32 files, 1191/1191 passed |
| Web | `npm test -w apps/web -- --maxWorkers=2` | ✅ 138 files, 1191/1191 passed (336 s) |
| API | `npm test -w apps/api` (full suite on `receita_verify_it2`, 19:05–20:22 BRT) | ✅ 97 files, **1041/1041 passed** (4638 s); no `ENOTFOUND` blips, no re-runs needed |
| E2E | Playwright suite of `apps/web/e2e`, nucleo + receita (7 tests × 2 projects) | ✅ **14/14 passed** (14.1 min): `admin.spec.ts:31`, `booking.spec.ts:52`, `:160`, `:214`, `receita-discounts.spec.ts:48`, `receita-fixed-and-renewals.spec.ts:69`, `receita-hour-package.spec.ts:26`, desktop and mobile. Nucleo availability p95: 286 ms desktop (median 282), 287 ms mobile (median 282), both under 300 ms this run |

The test counts grew from iteration 1 (API 951 → 1041 over 90 → 97 files) because `main` also carries other work and the fix commits added 7 receita tests. No tests were skipped and none were removed. The 7 new receita tests are `package-payment.service.int.test.ts:198` × 3 and `:336`, `switch.service.int.test.ts:196`, `renewals.int.test.ts:212`, and the rewritten `credits.service.int.test.ts:162`.

**E2E setup**: same as iteration 1.
- The verifier ran `npx vite build`, then served `npx vite preview --host 127.0.0.1 --port 5173 --strictPort` itself. The page title "Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí" was checked on 127.0.0.1:5173, because Docker holds `[::]:5173` and wslrelay `[::1]:5173`.
- A temporary, uncommitted `apps/web/playwright.verify.config.ts` spread `playwright.config.ts`. It kept only the API seed web server (`apps/api/test/e2e-seed.ts`, which resets `receita_verify_it2`) and added the Chrome arg `--host-resolver-rules=MAP localhost 127.0.0.1`.
- The suite ran with `NODE_OPTIONS=--dns-result-order=ipv4first`.
- Afterwards the config, `apps/web/dist` and the Playwright output were deleted, and the preview process of this worktree was stopped (checked by its command line).

---

## New findings

### F6 (Minor, test hardening, non-blocking): two seam clocks are not pinned by any test

- **N3.** `api/modules/booking/cancel.service.ts:250` could pass any clock to `packageModeHandler.cancel` without a test noticing. That clock decides whether a lot is still unexpired, and the `expires_at` of the `manual` 90-day lot (`api/modules/packages/package-payment.service.ts:437`, `:451`).
- **N7.** `api/modules/revenue/ports.ts:64` could ignore `input.now` in `CreditPort.grant` without a test noticing; that changes the granted lot's `expires_at` (REC-105, REC-110, REC-111).
- **Impact**: none in production, where the request clock is the wall clock (`api/app.ts:23`). Under an injected clock, such as tests or the job CLI's `--now`, a regression would go unnoticed. That is the same class of issue as F1.
- **Fix task (optional)**: add `expiresAt` assertions to two existing route-level tests that run with `now: () => NOW`.
  - In `api/modules/revenue/steps.int.test.ts:352`, the `reschedule_difference` lot `expiresAt` = NOW + `credits.validity_days`.
  - In a clinic cancel through the cancel route with a closed period (as `package-payment.service.int.test.ts:375` does directly), the `manual` lot `expiresAt` = NOW + 90 days.
  - Done when mutants N3 and N7 are killed.

No other new findings. Code quality is unchanged from iteration 1. The fix commits are surgical: 19 files, +216/−54. The seam change is additive in shape, and its parameters are required, so the compiler checks every caller.

---

## Requirement Traceability

Not changed by the verifier. All 161 REC ACs are now backed by passing, discriminating tests (REC-160 partly by the notification port's code path). The orchestrator may flip REC-68, REC-73, REC-108 and REC-136 together with the rest.

---

## Cleanup

- `receita_verify_it2` was dropped (`drop database … with (force)`), and a lookup in `pg_database` confirmed it no longer exists.
- The worktree `.env` is untracked and gitignored.
- The temporary Playwright config, `apps/web/dist`, the scratch core copy and the time-travel config were removed or live only under `node_modules/.cache`.
- All node, bash and tail processes started by this worktree were stopped.
- `git status --porcelain` was empty before the report commit.

---

## Summary (iteration 2)

**Overall**: ✅ Ready.

**Spec-anchored check**: 161/161 ACs pass. 160 rest on test evidence; REC-160 rests partly on a code path, as accepted in iteration 1. No PARTIAL rows and no spec-precision gaps.

**Sensor**:
- The 16 iteration-1 mutants are 16/16 killed, including the former survivors A4, A7 and A8.
- On the new seam code, N1 is killed and N2, N4 and N5 are equivalent.
- N3 and N7 survive. Both are production-equivalent and recorded as Minor finding F6.

**Gate**:
- typecheck ✅, lint ✅
- core 1191/1191 ✅, web 1191/1191 ✅
- API 1041/1041 ✅
- e2e 14/14 ✅, with nucleo p95 at 286/287 ms

**Findings F1–F5**: all closed with fresh evidence. F1 is confirmed by the grep, the caller audit, a green run after 14:00 on the pinned date and a time-travel run.

**Next steps**: F6 is optional hardening. No fix iteration is required.
