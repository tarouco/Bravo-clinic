# Receita Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/receita/design.md`
**Spec**: `.specs/features/receita/spec.md`
**Blueprint**: `docs/architecture.md`
**Status**: Draft

Worker rules specific to this feature:

- receita starts only after `nucleo` is merged on `main` (AD-013). Before the first task of Phase 3 (Lane A) and Phase 7 (Lane B), grep for every item of design.md "Required from nucleo" (tables A and B use nucleo's final names) used by that lane; if one is missing, STOP and report the missing names (do not implement nucleo's part silently).
- Every PRD worked example is asserted verbatim (values in spec.md and `docs/architecture.md` §7.7–§7.11).
- Route tests parse every success body with the matching core contract schema from `validation/revenue-schemas.ts`.
- Never print secret values; API tests use `DATABASE_URL_TEST` (AD-018).
- Lane B never edits `packages/core` or `apps/api`; Lane A never edits `apps/web`.

---

## Parallel lanes

| Lane | Phases | Worktree / branch | Scope |
| --- | --- | --- | --- |
| A — backend | 1 → 2 → 3 → 4 → 5 → 6 | `receita-api` | `packages/core`, `apps/api`, `neon.ts` |
| B — frontend | 7 → 8 → 9 | `receita-web` | `apps/web` only |
| Integration | 10 | `main` after both lanes merge | Playwright e2e |

Cross-lane dependencies:

- Lane B starts when **Lane A Phase 1 (T1–T3)** is merged to `main`: Lane B types are `z.infer` of the contract schemas (T2), and the category form uses `estimateFixedPeriod` (T3). Lane B branches from `main` after that merge.
- Lane B codes against the API contract of design.md "API Contracts" using fixtures (`features/purchases/fixtures.ts`) that are parsed by the T2 contract schemas in tests; it never calls a live API in unit tests.
- Lane A route tests parse responses with the same schemas, so both lanes share one contract. A contract change goes to T2 on `main` first, then both lanes rebase.
- Phase 10 runs on `main` after Lane A (T29) and Lane B (T47) are merged; it is the only place both lanes run together.

```
Lane A: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 ─┐
                 └──(Phase 1 merged)──▶ Lane B: Phase 7 → Phase 8 → Phase 9 ─┴──▶ Phase 10
```

---

## Test Coverage Matrix

> Generated from project guidelines, fundacao's matrix and this spec - confirm before Execute. Guidelines found: `.specs/STATE.md` AD-010, AD-018; `docs/architecture.md` §11; `.specs/features/fundacao/tasks.md` matrix (floor).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `packages/core` receita modules and schemas | unit | All branches; 1:1 to spec ACs; every PRD example value asserted verbatim; every schema bound (accepted + rejected) | `packages/core/src/**/*.test.ts` | `npm test -w packages/core` |
| `apps/api` services and hooks | integration (real Postgres) | Every AC the service implements: happy path + each edge/error + persisted rows and ledger sums asserted; concurrency ACs with two parallel transactions | `apps/api/src/modules/**/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` routes | integration (`app.request()`) | Every route: happy + validation + auth (401/403/404 other user) + documented error codes; body parsed by the core contract schema | `apps/api/src/routes/**/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` migrations and constraints | integration | Each constraint/trigger: accepted + rejected case with SQLSTATE | `apps/api/src/db/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` jobs | integration | Each job step with injected `now`; re-run changes 0 rows; unauthorized trigger 401 | `apps/api/src/jobs/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` e-mail templates | unit | Every template renders subject/text with the values of REC-159/REC-161 | `apps/api/src/emails/**/*.test.ts` | `npm test -w apps/api` |
| `apps/web` components, hooks, pages | unit (Testing Library + jsdom, fixtures) | Every AC of the component: text, roles, enabled/disabled states, navigation targets, error messages; fixtures parsed by contract schemas | `apps/web/src/**/*.test.tsx` | `npm test -w apps/web` |
| Integrated flows | e2e (Playwright, sandbox gateway, test DB) | The three flows of Phase 10 end to end | `apps/web/e2e/receita-*.spec.ts` | `npm run e2e -w apps/web` |
| Drizzle schema declarations, `neon.ts` triggers | none | - (build gate; behavior verified by the same task's integration tests, merge-forward) | - | build gate only |

## Gate Check Commands

> Same commands as fundacao plus the nucleo e2e script - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test -w packages/core` or `npm test -w apps/web` (workspace touched) |
| Full | After tasks with integration tests | `npm run typecheck && npm test -w apps/api` |
| Build | After phase completion | `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build` |
| E2E | Phase 10 tasks | `npm run e2e -w apps/web` (starts API on the test DB with the sandbox gateway, per nucleo's Playwright config) |

---

## Execution Plan

Phases are ordered; tasks inside a phase run in order. `[P]` marks a task with no dependency inside its phase. Lane B phases (7–9) may run in parallel with Lane A phases 2–6 in a separate worktree (see Parallel lanes).

### Phase 1 (Lane A): Shared contracts

```
T1 → T2
T3 [P]
```

### Phase 2 (Lane A): Core revenue math

```
T4 [P]
T5 → T6
T7 [P]
```

### Phase 3 (Lane A): Schema and balance services

```
T8 → T9
T8 → T10 → T13
T8 → T11
T8 → T12
```

### Phase 4 (Lane A): Checkout plug-ins

```
T14 → T15 → T16
T14 → T17
T18 [P]
```

### Phase 5 (Lane A): Subscription services

```
T19 → T20 → T21 → T22
T19 → T21
T20 → T23
T21 → T23
T24 [P]
```

### Phase 6 (Lane A): Routes and jobs

```
T25 [P]
T26 [P]
T27 → T29
T28 → T29
```

### Phase 7 (Lane B): Web data layer and revenue components

```
T30 → T31
T30 → T32
T30 → T33
T30 → T34
```

### Phase 8 (Lane B): Public purchase and Perfil → Compras

```
T35 [P]
T36 → T37
T36 → T39
T38 → T39
T40 [P]
T41 [P]
```

### Phase 9 (Lane B): Admin screens

```
T42 → T43
T44 [P]
T45 [P]
T46 → T47
```

### Phase 10 (Integration): End-to-end flows

```
T48 → T49
T48 → T50
```

---

## Task Breakdown

### Phase 1 (Lane A): Shared contracts

#### T1: Implement subscription and period status machines with labels

**What**: `SubscriptionStatus`, `PeriodStatus`, `canTransitionSubscription`, `canTransitionPeriod`, `assertSubscriptionTransition` (AD-030 transitions); append pt-BR labels for subscription/period statuses, ledger entry types (seq-aware "Compra"/"Renovação"), extra-lot sources, credit sources and coupon-use statuses to `labels.ts`; export from the barrel.
**Where**: `packages/core/src/status/subscription.ts` (+ `packages/core/src/labels.ts`)
**Depends on**: None
**Reuses**: `docs/architecture.md` §3.2; nucleo `status/booking.ts` pattern
**Requirement**: REC-42, REC-60, REC-61

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests enumerate every allowed subscription transition of REC-60 and every allowed period transition of REC-61 as true, and a sample of forbidden ones (`ended → active`, `expired → active`, `closed → active`, `cancelled → paid`) as false
- [x] `assertSubscriptionTransition('ended','active')` throws `InvalidTransitionError`
- [x] Tests assert labels "Aguardando pgto", "Ativa", "Suspensa", "Encerrada", "Cancelada", "Trocada", "Expirada", and `ledgerEntryLabel('period_grant', 1) === 'Compra'`, `(…, 2) === 'Renovação'`
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 14 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add subscription and period status machines`

---

#### T2: Define revenue request and response contract schemas

**What**: All request schemas and response contract schemas listed in design.md "@bravo/core" → `validation/revenue-schemas.ts`, with pt-BR messages and exported `z.infer` types; bounds from spec (REC-01, REC-02, REC-11 message builder, REC-64 factory with min/max, REC-112, REC-129, REC-134, REC-43/44).
**Where**: `packages/core/src/validation/revenue-schemas.ts`
**Depends on**: T1
**Reuses**: AD-024; fundacao `validation/auth-schemas.ts` style
**Requirement**: REC-01, REC-02, REC-11, REC-64, REC-127, REC-129, REC-134

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each request schema has an accepted sample and one rejected sample per bound (e.g. included hours 0 and 201 rejected, 20 accepted → `includedMinutes` 1200; coupon code "bravo10" normalized to "BRAVO10"; "AB" rejected; percent 0 and 101 rejected; justification of 4 chars rejected)
- [x] `subscriptionPurchaseInput` rejects `acceptTerms: false`
- [x] Every response schema parses the matching example object from design.md "API Contracts" (fixtures inside the test)
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 30 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add revenue api contract schemas`

---

#### T3: Implement fixed-schedule occurrence functions [P]

**What**: `generateOccurrences` (with `notBefore`), `fixedPeriodPriceCents`, `findOccurrenceConflicts`, `estimateFixedPeriod`, `occurrenceConflictLabel` per design.md and `docs/architecture.md` §7.11.
**Where**: `packages/core/src/fixed/occurrences.ts`
**Depends on**: None
**Reuses**: `time.ts`; nucleo `slots/grid.ts` (`Occupied`), `calendar/day-type.ts` (`ClosedDayRef`)
**Requirement**: REC-04, REC-83, REC-89, REC-90

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Meio turno mensal base 2026-11-02, 30 days → 22 occurrences, first `2026-11-02T10:00:00.000Z`–`12:30Z`; `fixedPeriodPriceCents(28000, 22) === 616000`
- [x] `estimateFixedPeriod({ weekdays:[1,2,3,4,5], periodDays:30, pricePerOccurrenceCents:28000 })` → `{ minCount:20, maxCount:22, minCents:560000, maxCents:616000 }`
- [x] Holiday date keeps its occurrence; `notBefore` drops earlier ones; window ending 1440 ends at next-day 00:00
- [x] Conflicts: closed day, overlap booking, cleanup (`[S, E+c)` rule), block, outside hours each reported with label ("Dia fechado", "Já reservado", "Conflito com limpeza", "Bloqueado", "Fora do horário de funcionamento")
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 12 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add fixed-schedule occurrence generation`

---

### Phase 2 (Lane A): Core revenue math

#### T4: Implement coupon and slot discount resolution [P]

**What**: `couponDiscountCents`, `slotDiscountCents`, `chooseDiscount`, `validateCoupon`, `couponRejectMessage`, `discountNote` per `docs/architecture.md` §7.7 and spec REC-116..REC-120, REC-142.
**Where**: `packages/core/src/pricing/discounts.ts`
**Depends on**: T2
**Reuses**: `money.ts` (`basisPointsOfCents`, `mulDivRoundHalfUp`); nucleo `PricedSegment`
**Requirement**: REC-116, REC-117, REC-118, REC-119, REC-120, REC-142

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `couponDiscountCents(21900, {kind:'percent', value:1000}) === 2190`; fixed 2000 on 16000 → 2000; fixed 50000 on 16000 → 16000
- [x] `slotDiscountCents` Tue 14:00–16:00 at 8000/h, 10% over all minutes → 1600; partial overlap and two discounts summed per segment
- [x] `chooseDiscount({gross:16000, slot:1600, coupon:2000})` → coupon, net 14000; tie → `slot_discount`; both zero → `none`
- [x] `validateCoupon` returns each of the 8 reasons in its triggering case and `ok` otherwise; messages match REC-117 verbatim
- [x] `discountNote` returns "Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00)." for the example
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 20 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add coupon and slot discount resolution`

---

#### T5: Implement proportional package debit

**What**: `vPacCents`, `packageDebitMinutes` (BigInt exact extra, one ceil), `formatDebitDetail` per `docs/architecture.md` §7.8.
**Where**: `packages/core/src/packages/debit.ts`
**Depends on**: T1
**Reuses**: `money.ts` (`mulDivRoundHalfUp`, `ceilDiv`)
**Requirement**: REC-22, REC-41, REC-63

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Five examples return 120, 78, 185, 84, 152 exactly; `extraMinutesExact` for Wed is `{ num: 69n, den: 4n }` or an equivalent reduced fraction equal to 17.25
- [x] V_slot ≤ V_ref yields debit = duration; `vPacCents({priceCents:160000, includedMinutes:1200}) === 8000`, half-up case `vPacCents({priceCents:100000, includedMinutes:1800}) === 3333`
- [x] `formatDebitDetail` → "60 min + 18 min de excedente = 78 min" (Wed) and "120 min" (Tue)
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 10 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add proportional package debit`

---

#### T6: Implement balance conversion and closed-day compensation

**What**: `convertPackageBalance` (§7.9) and `periodDaysOf`, `hourPackageCompensationMinutes`, `fixedScheduleCompensationCents` (§7.10).
**Where**: `packages/core/src/packages/conversion.ts` (+ `packages/core/src/packages/compensation.ts`)
**Depends on**: T5
**Reuses**: `PackageRate` from T5; `mulDivRoundHalfUp`
**Requirement**: REC-71, REC-96

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `convertPackageBalance({ remainingMinutes:360, from:{160000,1200}, to:{225000,1800} }) === 384`; 0 remaining → 0; half-up rounding case asserted
- [x] Compensation: (1200,30)=40, (2400,60)=40, (1800,90)=20; `fixedScheduleCompensationCents(616000,30) === 20533`; `periodDaysOf('bimonthly') === 60`
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add package conversion and compensation`

---

#### T7: Implement period dates and balance allocation [P]

**What**: `period.ts` (`periodBounds`, `chargeDueAt`, `isDateInPeriod`, `graceEndsOn`, `periodEndNoticeDates`) and `allocation.ts` (`allocateMinutes`, `allocateCredits`, `allocateRefund`) per design.md.
**Where**: `packages/core/src/packages/period.ts` (+ `packages/core/src/packages/allocation.ts`)
**Depends on**: T1
**Reuses**: `time.ts`
**Requirement**: REC-10, REC-25, REC-26, REC-46, REC-107, REC-109

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `periodBounds('2026-11-02', 30)` → endsOn `2026-12-02`; `chargeDueAt('2026-12-02', 2)` → `2026-11-30T03:00:00.000Z`; `graceEndsOn('2026-12-02', 7)` → `2026-12-09`; notices for endsOn 2026-12-02 → `2026-11-25`, `2026-12-01`
- [x] `allocateMinutes`: package first, then lots by expiry; skips lots expiring before booking start or before now; `usePackage:false` uses lots only; insufficient returns `sufficient:false` with `available`
- [x] `allocateCredits` FIFO by expiry then creation, never exceeds a lot; `allocateRefund({cash:8000, credit:8000, refund:8000})` → credit 0 / cash 8000 for retained 8000; `({cash:0, credit:16000, refund:8000})` → credit 8000
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 16 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add period dates and balance allocation`

---

### Phase 3 (Lane A): Schema and balance services

#### T8: Declare receita schema, migrations and test factories

**What**: Drizzle tables of `docs/architecture.md` §5.4 with AD-030 deltas (design.md "Data Models") in `db/schema/{subscriptions,ledgers,coupons}.ts`, the ALTERs on `bookings`/`charges`; generated migration `<n>_receita` and custom `<n>_receita_constraints` (slot-discount exclusion, append-only triggers, coupon-use transition trigger, partial unique indexes, non-negative checks); `test/factories/revenue.ts` (`createHourPackageCategory`, `createFixedCategory`, `createSubscription({ status, period })`, `createExtraLot`, `createCreditLot`, `createCoupon`).
**Where**: `apps/api/src/db/schema/subscriptions.ts` (+ `ledgers.ts`, `coupons.ts`, `apps/api/drizzle/*_receita*.sql`, `apps/api/test/factories/revenue.ts`, `apps/api/src/db/receita-constraints.int.test.ts`)
**Depends on**: T1
**Reuses**: fundacao `db/schema/*`, `forbid_update_delete()`, test harness
**Requirement**: REC-12, REC-39, REC-40, REC-104, REC-135

**Tools**:

- MCP: NONE
- Skill: `neon-postgres` (drizzle custom migration conventions)

**Done when**:

- [x] `npm run db:migrate -w apps/api` applies on an empty test DB after nucleo's migrations
- [x] Constraint tests: UPDATE/DELETE on each ledger raises `append_only_table`; second non-terminal hour package for a user → 23505; `minutes_balance = -1` → 23514; overlapping active slot discounts same room → 23P01, different room accepted; duplicate (closed_day, subscription) → 23505; coupon use `consumed → reserved` rejected
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(db): add receita tables and constraints`

---

#### T9: Implement credits service and admin customer-credit routes

**What**: `credits.service.ts` (grant, available, apply with internal charge, refund to lot or fresh lot, expire, list) and `routes/admin/customer-credits.ts` (`GET` staff, `POST` admin + Idempotency-Key, audit `credit.grant_manual`).
**Where**: `apps/api/src/modules/credits/credits.service.ts` (+ `apps/api/src/routes/admin/customer-credits.ts`)
**Depends on**: T8
**Reuses**: T7 `allocateCredits`; `lib/audit.ts`, `lib/idempotency.ts`; nucleo charges table
**Requirement**: REC-105, REC-106, REC-107, REC-108, REC-109, REC-112, REC-113

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Grant sets `expires_at = now + credits.validity_days`; available ignores expired lots
- [x] Apply 7000 over lots 5000 (exp. day 10) + 5000 (day 20) → uses 5000 + 2000, one internal charge `method='credit'`, two `use` entries
- [x] Two parallel applies of 8000 with 10000 available → total used ≤ 10000 and no negative lot
- [x] Refund to an expired lot creates a new lot of the same source with fresh validity
- [x] `POST /api/admin/customers/:id/credits` 201 for admin with audit row; 403 for reception; 422 without justification or amount 0
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 12 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add customer credits ledger and admin grant`

---

#### T10: Implement minute ledger service

**What**: `minutes.service.ts` for period ledgers (grant, debit, refund, expire, admin adjust with audit `package_ledger.adjust`) and extra lots (create, debit FIFO, refund, expire), each updating the cached balance in the same transaction after `FOR UPDATE` locks ordered by id.
**Where**: `apps/api/src/modules/packages/minutes.service.ts`
**Depends on**: T8
**Reuses**: T7 `allocateMinutes`; `lib/audit.ts`
**Requirement**: REC-32, REC-40, REC-43, REC-44, REC-67

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] After every operation `minutes_balance` equals the ledger sum (asserted by SQL)
- [x] Adjust +30 with justification writes entry and audit before/after; adjust making balance negative → `INSUFFICIENT_BALANCE`
- [x] Two parallel debits of 700 on a 1200 balance → one succeeds, one `INSUFFICIENT_BALANCE`
- [x] Expire lots with `expires_at ≤ now` writes `expiry` and zeroes remaining; second run changes 0 rows
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add package and extra minute ledgers`

---

#### T11: Implement coupons service and admin coupon routes

**What**: `coupons.service.ts` (CRUD, toggle, `evaluateCoupon` with first-booking-by-document and per-customer counting, atomic `reserveUse`, `consumeUse`, `releaseUse`, `listUses`) and `routes/admin/coupons.ts` (admin-only; audits `coupon.create|update|enable|disable`).
**Where**: `apps/api/src/modules/coupons/coupons.service.ts` (+ `apps/api/src/routes/admin/coupons.ts`)
**Depends on**: T8, T4
**Reuses**: T4 `validateCoupon`; T2 schemas
**Requirement**: REC-118, REC-119, REC-123, REC-124, REC-126, REC-127, REC-129, REC-130, REC-131, REC-132

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Last use raced by two transactions → one reserved, other `COUPON_EXHAUSTED`; `uses_count` ends at `max_uses`
- [x] Release decrements `uses_count`; consume keeps it; consumed use cannot be released
- [x] First-booking coupon rejected for a second account with the same CPF that has a confirmed booking
- [x] Routes: create (code upper-cased, duplicate → 409 `CONFLICT`), edit `max_uses` below `uses_count` → 422, toggle, uses list; reception 403
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 16 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add coupons service and admin routes`

---

#### T12: Implement slot discounts service and admin routes

**What**: `slot-discounts.service.ts` (`applyDiscount` on free sub-intervals per room, `listDiscounts`, `removeDiscount` with audit, `activeFor`, `consumeForBooking` splitting the remainder) and `routes/admin/slot-discounts.ts` (GET staff; POST/DELETE admin).
**Where**: `apps/api/src/modules/slot-discounts/slot-discounts.service.ts` (+ `apps/api/src/routes/admin/slot-discounts.ts`)
**Depends on**: T8, T4
**Reuses**: nucleo `loadDayContexts` (occupancy, window)
**Requirement**: REC-133, REC-134, REC-135, REC-137, REC-138, REC-139, REC-140, REC-141

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tue 19:00–22:00 at 15% on 3 rooms with a booking 20:00–21:00 (cleanup 30) in one room → that room gets 19:00–20:00 and 21:30–22:00, `skipped` lists 20:00–21:30, the other rooms get 19:00–22:00
- [x] Misaligned / past / outside window / percent 0 → 422; overlap → 409 "Já existe desconto neste horário"
- [x] `consumeForBooking` for a 19:00–20:00 booking on a 19:00–22:00 discount leaves an active 20:00–22:00 part
- [x] Remove sets `removed_at` + audit; list excludes parts ending ≤ now; reception POST → 403
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 12 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add slot discounts service and admin routes`

---

#### T13: Implement package payment service

**What**: `package-payment.service.ts`: `quotePackageOption`, `debitForBooking` (locks, recompute, ledger detail, booking columns), `returnForCancellation` (tenant deadline, clinic, switch successor), `redebitForReschedule`; fill `packageMinutes` (= `package_minutes_debited + extra_minutes_debited`) in nucleo's `GET /admin/calendar/events` serializer (`modules/admin/booking-queries.service.ts`).
**Where**: `apps/api/src/modules/packages/package-payment.service.ts`
**Depends on**: T10, T5, T7
**Reuses**: nucleo `getReferenceCategory`, `selectHourlyCategory`; T6 conversion for switch returns
**Requirement**: REC-23, REC-25, REC-26, REC-27, REC-29, REC-31, REC-32, REC-33, REC-34, REC-35, REC-36, REC-37, REC-38, REC-55, REC-68

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Factory categories: Wed 19:00–20:00 → debit 78, ledger detail holds V_ref 9700, V_pac 8000; Tue 17:30–20:00 → 152
- [x] Date beyond the active period uses lots only; suspended subscription → `reason:'suspended'`, lots still usable; block-priced draft → null option `block_category`
- [x] Insufficient → `INSUFFICIENT_BALANCE` with required/available; two parallel bookings → one succeeds
- [x] Cancel ≥ 24h returns package + lot minutes; < 24h returns 0; clinic cancel with closed period creates a manual lot; switch-closed period returns converted minutes to the successor
- [x] Reschedule reverses and re-debits; insufficient new debit leaves ledger unchanged
- [x] `GET /api/admin/calendar/events` returns `packageMinutes: 78` for the Wed package booking
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add package payment of bookings`

---

### Phase 4 (Lane A): Checkout plug-ins

#### T14: Implement receita e-mail templates [P]

**What**: Pure template functions for every REC-159 template (pt-BR, brand layout from fundacao; names = gestao notification catalog), renewal charge/reminder with amount, due date, method and Pix copy-paste (REC-161), fixed-schedule activation with occurrence list; `revenueMailer` helper (one function per template → `queueEmail` with dedupe key), the only path receita services use to queue tenant e-mails (AD-025, gestao R7).
**Where**: `apps/api/src/emails/templates/revenue.ts` (+ `apps/api/src/modules/subscriptions/revenue-mailer.ts`)
**Depends on**: T2
**Reuses**: fundacao `emails/templates/layout.ts`; `formatBRL`, `formatDateBR`
**Requirement**: REC-159, REC-161

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each of the 17 templates returns non-empty subject/html/text; snapshot of the key values (e.g. renewal charge text contains "R$ 1.600,00", "02/12/2026" and the copy-paste code)
- [x] No template contains emoji or unescaped user input (name with `<` is escaped)
- [x] `revenueMailer` exposes exactly the 17 REC-159 template names (asserted against a literal list)
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 18 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add subscription and credit e-mail templates`

---

#### T15: Implement closed-day compensation service

**What**: `compensation.service.ts`: `previewClosedDay`, `applyClosedDay` (hour lots, fixed credits, occurrence cancellations, unique insert, e-mails, setting toggle), `compensateKnownClosedDays(tx, periodId)`.
**Where**: `apps/api/src/modules/subscriptions/compensation.service.ts`
**Depends on**: T14, T9, T10, T6
**Reuses**: nucleo `transitionBooking`
**Requirement**: REC-97, REC-98, REC-99, REC-100, REC-101, REC-103, REC-104

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Closing 2026-11-20 (clinic) with a Pacote 20h period and a Meio turno period → 40-min lot, 20533-cent credit lot, Friday occurrence `cancelled_by_clinic`, two `subscription.compensation` outbox rows; preview returns `{ subscribers:2, minutes:40, creditCents:20533, fixedOccurrencesCancelled:1 }`
- [x] Room-specific closure: hour package not compensated; fixed only for the same room
- [x] Re-apply creates nothing; setting disabled → nothing
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 8 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add closed-day compensation`

---

#### T16: Implement and register revenue extensions in nucleo's registry

**What**: Checkout steps `discount` (100), `package` (200), `credit` (400), payment-mode handlers `package` and `subscription`, live `CreditPort`, `ClosedDayCompensationPort` (T15), `AvailabilityDecorator` for slot discounts, all composed over T9, T11, T12, T13, T15 and registered in nucleo's `extensions/index.ts` (design.md "Required from nucleo" A; B2, B5, B7 verified first); steps write `draft.extensions.{discount,package,credit}` (parsed by `revenueQuoteSchema`); the live `CreditPort` backfills nucleo's deferred grants (`booking_events.data.creditGrant.status = 'deferred'`) once, idempotently.
**Where**: `apps/api/src/modules/revenue/steps.ts` (+ `apps/api/src/extensions/index.ts`)
**Depends on**: T15, T9, T11, T12, T13
**Reuses**: nucleo booking routes/services (through the hook contract)
**Requirement**: REC-23, REC-27, REC-29, REC-30, REC-37, REC-94, REC-95, REC-109, REC-110, REC-111, REC-115, REC-120, REC-122, REC-124, REC-136, REC-138

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Through nucleo's booking endpoints: coupon R$ 20 vs slot 10% on 16000 → coupon wins, net 14000, deposit 7000, use reserved; on approval consumed and slot part consumed; on expiry released
- [x] Package booking via `payWith:'package'` → `payment_mode = 'package'`, confirmed with debit; insufficient → 422 and no booking row; quote `extensions` parse with `revenueQuoteSchema`
- [x] Credits pay part of the deposit (internal charge); tenant cancel ≥ 24h returns credit per `allocateRefund`; clinic cancel with credit option grants `clinic_cancellation` lot
- [x] Cheaper reschedule returns `creditCents` and a `reschedule_difference` lot; fixed occurrence cancel/reschedule moves no money
- [x] A deferred grant written before the live port existed becomes one credit lot; running the backfill twice creates no second lot
- [x] Availability response carries `discountPercent` on discounted available cells
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): register revenue checkout steps and ports`

---

#### T17: Accept package categories in the category admin API

**What**: Register `CategoryHandler`s for `hour_package` and `fixed_schedule` (T2 schemas + `toRow`) and their `onUpdate` (gap B3) (lock rule for weekdays/window/period with non-terminal subscriptions, version bump, price-change e-mails with first renewal date).
**Where**: `apps/api/src/modules/subscriptions/category-handlers.ts`
**Depends on**: T14
**Reuses**: T2 schemas; nucleo category service
**Requirement**: REC-01, REC-02, REC-05, REC-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Admin creates "Pacote 25h mensal" 187500 → stored `included_minutes = 1500`, `period = 'monthly'`; invalid combos → 422
- [ ] Window change on a category with an active subscription → 409 with REC-05 message; price change → version + 1, audit, one `subscription.price_change` per active/suspended subscriber
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): accept package categories in category admin`

---

#### T18: Implement package offers, occurrence check and subscription quote [P]

**What**: `quote.service.ts` (`listPackageOffers`, `checkOccurrences` with suggestions, `quoteSubscription` with coupon and credits) and `routes/public/packages.ts`.
**Where**: `apps/api/src/modules/subscriptions/quote.service.ts` (+ `apps/api/src/routes/public/packages.ts`)
**Depends on**: T3, T4, T7, T9, T11
**Reuses**: nucleo `loadDayContexts`, `averageHourlyCents`
**Requirement**: REC-07, REC-08, REC-10, REC-11, REC-84, REC-89, REC-155

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `GET /api/public/packages` lists active public package categories only, with `avgHourCents` 8000 for Pacote 20h and estimate for Meio turno
- [ ] Occurrence check for a date blocked in Sala Principal returns the conflict and suggests the other rooms and up to 3 conflict-free base dates within 14 days
- [ ] Quote REC-10 values exact; base date out of range → 422 message; inactive category → 404
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add package offers and subscription quote`

---

### Phase 5 (Lane A): Subscription services

#### T19: Implement subscription purchase and admin sale

**What**: `purchase.service.ts`: `purchaseSubscription` (hour and fixed: one-hour-package rule, consents, saved-card checks, subscription + period + held occurrences + coupon reserve + credits + pending charge, zero-amount activation) and `sellSubscription` (link mode with `pre_reserved` occurrences and `subscription.sale_link`, manual mode with audit `subscription.confirm_manual`).
**Where**: `apps/api/src/modules/subscriptions/purchase.service.ts`
**Depends on**: T18, T11, T9, T14
**Reuses**: nucleo `insertBookingWithOccupancy`, `createCharge`, `submitCharge`, `listSavedCards`, `chargeIntentSchema`
**Requirement**: REC-07, REC-08, REC-12, REC-13, REC-14, REC-15, REC-21, REC-85, REC-86, REC-87, REC-115, REC-125, REC-150, REC-151, REC-152

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Hour purchase creates the rows of REC-14 and a pending `subscription_initial` charge; second hour package → 409; missing consents → 422; foreign saved card → 422
- [ ] Coupon + credits covering the price activates immediately without charge
- [ ] Fixed purchase of Meio turno creates 22 `awaiting_payment` occurrences with occupancy; a conflicting date → 409 `OCCURRENCE_CONFLICT`, zero rows; a racing insert → 409 with that date
- [ ] Admin link sale holds `pre_reserved` occurrences for 24 h and queues `sale_link`; manual sale is active with an audit row
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 14 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add subscription purchase and admin sale`

---

#### T20: Implement period lifecycle

**What**: `period.service.ts`: `activatePeriod` (grant, known closed days, hold next fixed period with `held_conflicts` e-mail), `closePeriod` (expiry), `createRenewalPeriod` (hour new row / fixed promote, pricing from current category, held count).
**Where**: `apps/api/src/modules/subscriptions/period.service.ts`
**Depends on**: T19, T10, T15
**Reuses**: T1 transitions, T3 occurrences, T7 period dates
**Requirement**: REC-16, REC-53, REC-60, REC-61, REC-92, REC-93, REC-102

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Activation grants 1200 min once; a known clinic closure in the period yields a 40-min lot at activation
- [ ] Fixed activation creates seq 2 `upcoming` and holds its free occurrences as `held_for_renewal`; a blocked date lands in `held_conflicts` and one `next_period_conflicts` e-mail
- [ ] Renewal pricing: hour = current category price; fixed = per-occurrence × held count (known closed day reduces count)
- [ ] Illegal transitions throw `INVALID_TRANSITION`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add subscription period lifecycle`

---

#### T21: Implement subscription charge handlers

**What**: `charge-handlers.ts` registered as nucleo `Registry.chargeHandlers` (gap B1) for `subscription_initial` and `subscription_renewal`: approval (activate or `paid`, occurrences confirmed, coupon consumed, e-mails, staff `new_subscription`), failure (`subscription.renewal_failed` e-mail, staff `renewal_failed`), late approval refund (`payment.late_refund`), regularization via approval during suspension, switch completion delegate.
**Where**: `apps/api/src/modules/subscriptions/charge-handlers.ts`
**Depends on**: T19, T20
**Reuses**: nucleo `refundCharge`, `NotificationPort.notifyStaff(event, { entityId })`, `buildIcs`
**Requirement**: REC-16, REC-19, REC-49, REC-50, REC-88, REC-160

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Sandbox approval of an initial charge → active, period active (base today) or paid (future base); fixed occurrences confirmed with one e-mail carrying an `.ics` of 22 VEVENTs
- [ ] Duplicate webhook → no second change; approval of an expired subscription → full refund + `payment.late_refund`
- [ ] Renewal approval → period `paid`, held occurrences `confirmed`; rejection → declined e-mail + staff event
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): handle subscription charge outcomes`

---

#### T22: Implement package switch

**What**: `switch.service.ts`: `quoteSwitch`, `startSwitch` (new subscription `awaiting_payment` with `switch_from_subscription_id`), `completeSwitch` (called by the initial handler: conversion at approval, transitions, fixed release/insert with refund on conflict).
**Where**: `apps/api/src/modules/subscriptions/switch.service.ts`
**Depends on**: T21, T6
**Reuses**: T13 (bookings remain valid), T19 hold logic
**Requirement**: REC-72, REC-73, REC-74, REC-75, REC-76, REC-77, REC-78

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 360 min left on 160000/1200 → switch to 225000/1800: quote shows 384 + 1800; approval writes `conversion_out −360`, `conversion_in +384`, old `switched`, new `base_on` = approval date
- [ ] A booking debited between quote and approval reduces the converted amount (conversion at approval)
- [ ] Rejected/expired switch leaves the old subscription active; different type or same category → 422
- [ ] Fixed switch to Turno mensal in the same room releases old future occurrences and inserts the new ones; a taken slot at approval → refund, old kept
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add package switch with balance conversion`

---

#### T23: Implement cancellation, suspension and payment of pending periods

**What**: `cancel.service.ts`: `cancelPreview`, `cancelSubscription` (tenant/admin, justification for admin, expiry, cancel charges/periods, occurrence release), `suspendDue`, `endAfterGrace`, `payPending` (pay awaiting renewal or regularize suspended: hour full price; fixed re-hold).
**Where**: `apps/api/src/modules/subscriptions/cancel.service.ts`
**Depends on**: T20, T21
**Reuses**: nucleo `cancelCharge`, `createCharge`, `transitionBooking`
**Requirement**: REC-54, REC-56, REC-57, REC-79, REC-80, REC-81

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Preview for 6 h left → `minutesLost: 360`; paid upcoming period reported; fixed preview counts future occurrences
- [ ] Cancel: expiry entry, pending charge cancelled, future periods cancelled, existing package bookings untouched; fixed occurrences released per actor
- [ ] Suspend at `starts_on` releases held occurrences; end at `starts_on + 7` sets `ended`, period `failed`
- [ ] Regularize hour package during grace → active, full minutes, same dates; fixed regularization re-holds only free future occurrences and prices them
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 12 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add subscription cancel, suspension and regularization`

---

#### T24: Implement extra hours and tenant purchase routes [P]

**What**: `extra-hours.service.ts` (summary, purchase, `extra_hours` charge handler, expiry of unpaid holds helper) and `routes/app/purchases.ts` (`GET/POST /app/extra-hours`, `GET /app/credits`, `GET /app/purchases/history`).
**Where**: `apps/api/src/modules/extra-hours/extra-hours.service.ts` (+ `apps/api/src/routes/app/purchases.ts`)
**Depends on**: T9, T10, T14
**Reuses**: T5 `vPacCents`; nucleo `createCharge`, `Registry.chargeHandlers` (gap B1)
**Requirement**: REC-62, REC-63, REC-64, REC-65, REC-66, REC-115, REC-145

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Summary for a Pacote 20h subscriber: `eligible:true`, `unitPriceCents:8000`, min 1, max 20; non-subscriber → `eligible:false` and POST 422 with REC-65 message
- [ ] Buying 5 h → charge 40000; approval → lot 300 min expiring at paid_at + 90 days, `extra_hours.purchased`; 21 h → 422
- [ ] History lists the user's charges newest first; credits endpoint matches the contract; other users' data never appears
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add extra hours purchase and tenant purchase routes`

---

### Phase 6 (Lane A): Routes and jobs

#### T25: Implement tenant subscription routes [P]

**What**: `routes/app/subscriptions.ts` with all endpoints of design.md (quote, purchase with Idempotency-Key, list, detail, ledger with formula text, switch quote/start, cancel preview/cancel, pay).
**Where**: `apps/api/src/routes/app/subscriptions.ts`
**Depends on**: T19, T22, T23
**Reuses**: T18, T19, T22, T23 services; `lib/idempotency.ts`
**Requirement**: REC-14, REC-20, REC-41, REC-72, REC-79

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every endpoint: happy path parsed by its contract schema, 401 unauthenticated, 404 for another user's subscription, CSRF rejected without Origin
- [ ] Purchase replay with same key returns the stored 201; different body → 422 `IDEMPOTENCY_MISMATCH`; no key → 422
- [ ] Ledger shows "60 min + 18 min de excedente = 78 min" for a Wed booking
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 16 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add tenant subscription routes`

---

#### T26: Implement admin subscription routes [P]

**What**: `routes/admin/subscriptions.ts`: list (filters, search), detail, ledger (staff); quote, sell (Idempotency-Key), cancel (justification, audit `subscription.cancel`), adjust-balance, resend-link (admin); `admin-queries.service.ts` with `listAdminSubscriptions`, `getAdminSubscription` and the gestao R12 reads `getCustomerSubscriptions`, `getCustomerBalances`, `listCouponUsesByUser`.
**Where**: `apps/api/src/routes/admin/subscriptions.ts` (+ `apps/api/src/modules/subscriptions/admin-queries.service.ts`)
**Depends on**: T19, T23, T10
**Reuses**: services T10, T19, T23
**Requirement**: REC-43, REC-44, REC-45, REC-82, REC-148, REC-149, REC-150, REC-153, REC-154

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] List filters by status/type and searches by name; reception GET 200, reception POST sell/cancel/adjust 403
- [ ] Cancel without justification 422; with it → audit row; resend-link queues a new outbox row
- [ ] `getCustomerBalances` returns open-period minutes, extra lots and credit lots of one user only; `listCouponUsesByUser` lists that user's uses newest first
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 12 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add admin subscription routes`

---

#### T27: Implement renewals job

**What**: `jobs/renewals.ts`: due periods (batches of 50), pricing, credits FIFO, saved card (attempt 1/2) or Pix fallback, daily Pix reminders, period-ending notices, `job_runs` stats.
**Where**: `apps/api/src/jobs/renewals.ts`
**Depends on**: T20, T21
**Reuses**: nucleo `createCharge`/`submitCharge`; T7 dates
**Requirement**: REC-09, REC-47, REC-48, REC-50, REC-51, REC-52, REC-58, REC-93, REC-115, REC-125, REC-161

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] With `now = 2026-11-30T06:00Z`: Pacote 20h (base 2026-11-02) gets seq 2 `awaiting_payment` priced 160000 (coupon not reapplied) and one charge; a second run creates nothing
- [ ] Declined saved card → retry next day (attempt 2) only before `starts_on`; missing card → Pix + card-update e-mail; credits 50000 reduce the charge to 110000
- [ ] Pix reminder once per day; period-ending e-mails on 2026-11-25 and 2026-12-01; inactive category still renews
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(jobs): add subscription renewals job`

---

#### T28: Implement period-rollover and suspensions jobs

**What**: `jobs/period-rollover.ts` (activate paid periods, close ended ones, expire lots and credits) and `jobs/suspensions.ts` (suspend at `starts_on`, end after grace) calling T20/T23 services.
**Where**: `apps/api/src/jobs/period-rollover.ts` (+ `apps/api/src/jobs/suspensions.ts`)
**Depends on**: T20, T23
**Reuses**: T9 `expireCredits`, T10 `expireLots`
**Requirement**: REC-17, REC-53, REC-54, REC-57, REC-67, REC-113

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] On 2026-12-02 06:00Z: paid seq 2 activated with grant; seq 1 closed with expiry of the remaining minutes; unpaid seq 2 → subscription suspended; on 2026-12-09 → ended
- [ ] Running both jobs in either order gives the same final state; re-run changes 0 rows
- [ ] Expired lots and credits zeroed with `expiry` entries
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(jobs): add period rollover and suspension jobs`

---

#### T29: Implement expire-purchases job and register receita jobs

**What**: `jobs/expire-purchases.ts` (expired subscription holds and extra-hours holds); register `renewals`, `period-rollover`, `suspensions`, `expire-purchases` in `routes/jobs.ts`; declare triggers in `neon.ts` (`0 6 * * *` ×3, `*/5 * * * *`) and extend nucleo's `neon.test.ts` with them; `jobs/cli.ts` dev runner with `--now`.
**Where**: `apps/api/src/jobs/expire-purchases.ts` (+ `apps/api/src/routes/jobs.ts`, `neon.ts`, `apps/api/src/jobs/cli.ts`)
**Depends on**: T27, T28, T24
**Reuses**: nucleo `runJob`, `verifyTriggerRequest`
**Requirement**: REC-18, REC-59, REC-70

**Tools**:

- MCP: NONE
- Skill: `neon-functions` (trigger declaration)

**Done when**:

- [ ] An `awaiting_payment` fixed subscription past hold → `expired`, its occurrences `expired` (occupancy inactive), coupon released, credits refunded, charge cancelled; extra-hours hold → purchase `cancelled`
- [ ] POST `/jobs/<name>` without a trigger signature → 401; with the test signer → 200 and a `job_runs` row
- [ ] `npm run job -w apps/api -- renewals --now=2026-11-30T06:00:00Z` runs locally and refuses `NODE_ENV=production`
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(jobs): add purchase expiry job and receita triggers`

---

### Phase 7 (Lane B): Web data layer and revenue components

#### T30: Add purchases types, fixtures and query hooks

**What**: `types.ts` (`z.infer` of T2 contracts), `fixtures.ts` (one fixture per contract: Pacote 20h offer, Meio turno offer, active/suspended/awaiting subscriptions, ledger with the 78-min entry, extra-hours summary, credits, history, coupons, admin rows, `RevenueQuote` sufficient/insufficient), and TanStack Query hooks/mutations for every endpoint of design.md with the documented keys and `Idempotency-Key` generation.
**Where**: `apps/web/src/features/purchases/api.ts` (+ `types.ts`, `fixtures.ts`)
**Depends on**: T2
**Reuses**: fundacao `lib/api.ts`, `lib/query-client.ts`
**Requirement**: REC-14, REC-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A test parses every fixture with its contract schema
- [x] Hook tests (mocked `lib/api`) assert paths, query keys, invalidation after purchase/cancel/switch, and a UUID `Idempotency-Key` reused on retry of the same mutation call
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 14 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add purchases api hooks and fixtures`

---

#### T31: Build PackageCard and BalanceMeter

**What**: `PackageCard` (offer: name, period label, price, "R$ 80,00/h", included hours or weekdays/window + estimate, "Assinar" link) and `BalanceMeter` ("12h 30min de 20h", `role="meter"` with aria values, extra minutes line).
**Where**: `apps/web/src/components/revenue/PackageCard.tsx` (+ `BalanceMeter.tsx`)
**Depends on**: T30
**Reuses**: fundacao `Card`, `Badge`, `Button`; `formatBRL`
**Requirement**: REC-143, REC-155

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Pacote 20h fixture renders "R$ 1.600,00", "R$ 80,00/h", "20 horas · mensal", link `/assinar/<id>`; Meio turno renders "Seg–Sex · 07:00–09:30" and "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00"
- [x] Meter for 750 of 1200 renders "12h 30min de 20h", `aria-valuenow=750`, `aria-valuemax=1200`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add package card and balance meter`

---

#### T32: Build LedgerTable

**What**: Extrato table: date, label, booking code, formula text, signed minutes ("−78 min", "+1.200 min"), balance after; load-more by cursor; empty state.
**Where**: `apps/web/src/components/revenue/LedgerTable.tsx`
**Depends on**: T30
**Reuses**: nucleo `Table`
**Requirement**: REC-41, REC-42

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fixture renders "Compra", "Reserva BRV-…", "60 min + 18 min de excedente = 78 min", "−78 min" and the balance column
- [x] "Carregar mais" calls `fetchNextPage` when `nextCursor` exists; hidden otherwise
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ledger table`

---

#### T33: Build CouponField and CreditsToggle

**What**: `CouponField` (input upper-cases, apply/remove, shows discount, rejection message, discount note) and `CreditsToggle` ("Usar créditos (R$ X disponíveis)", applied amount), both controlled by `Quote.extensions` (parsed by `revenueQuoteSchema`) and registered in nucleo's slots `checkout.summary.discount` and `checkout.summary.credits`.
**Where**: `apps/web/src/components/revenue/CouponField.tsx`
**Depends on**: T30
**Reuses**: fundacao `Field`, `Input`, `Checkbox`, `Alert`
**Requirement**: REC-117, REC-121

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each rejection reason fixture shows its REC-117 message; the coupon-vs-slot fixture shows the REC-121 note
- [x] Typing "bravo10" submits "BRAVO10"; remove clears the code; toggle emits `useCredits`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add coupon field and credits toggle`

---

#### T34: Build PackagePaymentOption

**What**: Payment option "Pagar com meu pacote" with debit preview, breakdown disclosure, insufficient state (disabled, message, "Comprar horas extras" link, "Pagar esta reserva" button), outside-period/suspended/block messages; registered in nucleo's slot `checkout.summary.payWith`.
**Where**: `apps/web/src/components/revenue/PackagePaymentOption.tsx`
**Depends on**: T30
**Reuses**: nucleo `checkout.summary.payWith` slot, `BookingSummary`
**Requirement**: REC-24, REC-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Sufficient fixture shows "Esta reserva vai debitar 78 min do seu pacote" and selecting emits `payWith:'package'`
- [x] Insufficient fixture: option disabled, "Saldo insuficiente: esta reserva debita 78 min e você tem 40 min", link to `/app/compras/horas-extras`, "Pagar esta reserva" emits `payWith:'money'`
- [x] `packageOption: null` renders nothing; nucleo `BookingSummary` tests still pass
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add package payment option to checkout`

---

### Phase 8 (Lane B): Public purchase and Perfil → Compras

#### T35: Build packages section on Preços e Pacotes [P]

**What**: `PackagesSection` (hour packages and fixed schedules groups of `PackageCard`, loading/empty states) registered in nucleo's slot `pricing.packages` (`PricingPage`).
**Where**: `apps/web/src/features/purchases/PackagesSection.tsx`
**Depends on**: T31
**Reuses**: `usePackageOffers` (T30)
**Requirement**: REC-155

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Renders headings "Pacotes de horas" and "Horário fixo" with fixture cards; skeleton while loading; empty → section hidden
- [x] `PricingPage` test shows the section after the avulsas section
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add packages section to pricing page`

---

#### T36: Build FixedSchedulePicker

**What**: Room selector + base-date calendar + occurrence list + conflicts with labels + suggestion buttons ("Sala Secundária", "Iniciar em 09/11/2026") + period price "22 ocorrências × R$ 280,00 = R$ 6.160,00".
**Where**: `apps/web/src/features/purchases/FixedSchedulePicker.tsx`
**Depends on**: T30, T3
**Reuses**: nucleo `MonthCalendar`
**Requirement**: REC-84, REC-91

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Conflict fixture lists dates with labels and disables "Continuar"; clicking a room or date suggestion updates the query params and refetches
- [x] Conflict-free fixture shows the REC-91 line and enables "Continuar"
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add fixed-schedule picker`

---

#### T37: Build subscription purchase page

**What**: `/assinar/:categoryId` with ≤ 4 visible steps (`Stepper`), base date, `FixedSchedulePicker` for fixed categories, summary (price, discount via `CouponField`, credits, pay-now, period dates, renewal sentence), terms + recurring checkboxes, login redirect with state in URL, payment step with nucleo `PaymentMethodPanel`; route registered in `router.tsx`.
**Where**: `apps/web/src/pages/public/SubscribePage.tsx`
**Depends on**: T36, T33
**Reuses**: nucleo `Stepper`, `PaymentMethodPanel`; fundacao `RequireAuth` behavior
**Requirement**: REC-91, REC-156, REC-157, REC-158

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Hour package shows 3 steps, fixed shows 4; summary shows "Renova automaticamente em 02/12/2026 por R$ 1.600,00 (cobrança 2 dias antes)"
- [x] Pay button disabled until both checkboxes; logged-out user is sent to `/login?next=/assinar/<id>?baseOn=2026-11-02`
- [x] Purchase 409 `CONFLICT` shows the REC-12 message with a link to `/app/compras`; 409 `OCCURRENCE_CONFLICT` returns to the picker with dates
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add subscription purchase flow`

---

#### T38: Build Compras page with subscription cards

**What**: `/app/compras` tabs (Assinaturas, Horas extras when eligible, Créditos, Histórico), `SubscriptionCard` per subscription (status, base date, next charge, `BalanceMeter` or occurrences), actions per status, `PayDialog` (also at `/app/compras/assinaturas/:id/pagar`), empty state; routes in `router.tsx`.
**Where**: `apps/web/src/pages/app/compras/ComprasPage.tsx`
**Depends on**: T31
**Reuses**: fundacao `Tabs`, `EmptyState`; nucleo `PaymentMethodPanel`
**Requirement**: REC-143, REC-144, REC-146, REC-147

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Active fixture shows "Trocar", "Cancelar", "Extrato"; suspended shows "Regularizar"; awaiting shows "Pagar"; ended shows none
- [x] Next charge reads "30/11/2026 · R$ 1.600,00 · cartão final 4242"; empty state links `/precos`
- [x] Horas extras tab hidden for a non-eligible fixture; `/app/compras/assinaturas/<id>/pagar` opens `PayDialog`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add compras page with subscription cards`

---

#### T39: Build switch and cancel dialogs

**What**: `SwitchPackageDialog` (target category select, preview of converted minutes or released occurrences + new picker for fixed, price and pay-now, payment) and `CancelSubscriptionDialog` (preview of minutes/paid period lost or occurrences released, extra hours kept, explicit confirm).
**Where**: `apps/web/src/features/purchases/SubscriptionDialogs.tsx`
**Depends on**: T38, T36
**Reuses**: fundacao `Modal`
**Requirement**: REC-72, REC-79

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Switch fixture shows "Seu saldo de 6h vira 6h 24min no novo pacote" and "Total no novo período: 36h 24min"
- [x] Cancel fixture shows "Você perde 6h de saldo deste período, sem reembolso" and "Suas horas extras continuam válidas até 08/02/2027"; confirm sends `{ confirm: true }`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add package switch and cancel dialogs`

---

#### T40: Build Horas extras page [P]

**What**: `/app/compras/horas-extras`: hours stepper within min..max, unit and total price, credits toggle, payment, lots list with remaining and expiry; non-eligible redirect to `/app/compras`.
**Where**: `apps/web/src/pages/app/compras/HorasExtrasPage.tsx`
**Depends on**: T31
**Reuses**: `CreditsToggle` (T33 via T30 hooks), nucleo `PaymentMethodPanel`
**Requirement**: REC-63, REC-69

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] 5 h shows "5 × R$ 80,00 = R$ 400,00"; stepper cannot go below 1 or above 20
- [x] Lots render "300 min · vence em 08/02/2027"; ineligible fixture navigates to `/app/compras`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add extra hours page`

---

#### T41: Build Créditos and Histórico pages [P]

**What**: `/app/compras/creditos` (available total, lots with source label/remaining/expiry, ledger) and `/app/compras/historico` (charges list with description, method, amount, status label, refunded amount).
**Where**: `apps/web/src/pages/app/compras/CreditosHistoricoPages.tsx`
**Depends on**: T30
**Reuses**: nucleo `Table`; labels from core
**Requirement**: REC-114, REC-145

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Créditos fixture shows "R$ 205,33 disponíveis", "Compensação de dia fechado", expiry date
- [x] Histórico fixture shows "Pacote 20h mensal · Renovação", "Pix", "R$ 1.600,00", "Aprovado" and a partially refunded row
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add credits and purchase history pages`

---

### Phase 9 (Lane B): Admin screens

#### T42: Build Admin Cupons page

**What**: `/admin/cupons` list (columns of REC-128, enabled switch with optimistic toggle), "Novo cupom" button, uses drawer per coupon (REC-131); replaces the fundacao placeholder.
**Where**: `apps/web/src/pages/admin/cupons/CuponsPage.tsx`
**Depends on**: T30
**Reuses**: nucleo `Table`, `Drawer`; fundacao `AdminShell` route
**Requirement**: REC-128, REC-131

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fixture rows render "BRAVO10", "Desconto", "10%", "3/∞", "—"; first-booking row "Primeira reserva", "R$ 20,00", "1/10", "01/11/2026–30/11/2026"
- [x] Toggle calls `PATCH …/enabled`; failure reverts the switch with a toast
- [x] Drawer lists uses with "Reservado", "Usado", "Liberado"
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add admin coupons list`

---

#### T43: Build coupon form modal

**What**: Create/edit modal with the fields of §5.3.4 using `couponInput` (zodResolver): code, type, kind (%/R$), value, applies to (locked to reservas for first booking), max uses (ilimitado/N), per-customer limit, validity, enabled; server `details[]` mapped to fields.
**Where**: `apps/web/src/pages/admin/cupons/CouponFormModal.tsx`
**Depends on**: T42
**Reuses**: T2 schema; fundacao form components
**Requirement**: REC-129

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Percent "10" submits `discountValue: 1000`; "R$ 20,00" submits 2000; first booking forces "Reservas"
- [x] Invalid code, `valid_from ≥ valid_until`, and a server 409 duplicate code show field errors
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add coupon form`

---

#### T44: Build package category forms [P]

**What**: Forms for `hour_package` (name, price, included hours, period, status, visibility; live "R$ 80,00/h") and `fixed_schedule` (weekdays, window, period, price per occurrence; live "R$ 112,00/h" and estimate) registered in nucleo's slot `admin.categories.forms`; locked-field error from 409 shown.
**Where**: `apps/web/src/features/admin-categories/PackageCategoryForms.tsx`
**Depends on**: T30, T3
**Reuses**: T3 `estimateFixedPeriod`; nucleo `averageHourlyCents`, category table
**Requirement**: REC-03, REC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Typing 1.600,00 and 20 h shows "R$ 80,00/h"; Mon–Fri 07:00–09:30 at R$ 280,00 shows "R$ 112,00/h" and "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00"
- [x] 409 response shows the REC-05 message above the form
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add package category forms`

---

#### T45: Build slot discount dialog and calendar markers [P]

**What**: `SlotDiscountDialog` (rooms multi-select, date, start/end from hover or drag range, percent) with created/skipped summary; registration of the "Aplicar desconto (%)" action in slot `admin.calendar.freeSlotActions`, "−{p}%" markers and "Remover desconto" in slot `admin.calendar.overlays`, opening from `WeekCalendar` `onRangeSelect`; public `SlotGrid` `discountPercent` passthrough is nucleo's.
**Where**: `apps/web/src/features/admin-reservas/SlotDiscountDialog.tsx`
**Depends on**: T30
**Reuses**: nucleo `WeekCalendar` (`onRangeSelect`, `markers`), admin calendar slots
**Requirement**: REC-136, REC-137

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Opening from a 19:00–22:00 drag pre-fills the range; submit sends `{ roomIds, date, startMinute:1140, endMinute:1320, percent }`
- [x] Result fixture with a skipped part shows "Sala Principal: 20:00–21:30 ocupado, sem desconto"; 409 shows "Já existe desconto neste horário"
- [x] Overlay fixture renders "−15%" on the free slot and "Remover desconto" calls DELETE
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add slot discount dialog and markers`

---

#### T46: Build Assinaturas tab with detail drawer

**What**: Gestão de Reservas → Assinaturas tab (registered in nucleo's slot `admin.reservations.tabs`): table with filters/search, detail drawer with periods, `LedgerTable`, `AdjustBalanceDialog`, `GrantCreditDialog` (exported for gestao), cancel with justification, resend link; admin-only actions hidden for reception.
**Where**: `apps/web/src/features/admin-reservas/AssinaturasTab.tsx`
**Depends on**: T32
**Reuses**: nucleo `Table`, `Drawer`, `admin.reservations.tabs` slot; core `access.ts` role
**Requirement**: REC-148, REC-149

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Rows show customer, category, base date, next charge, status label and "12h 30min" balance; filters update the query key
- [x] Adjust dialog requires justification and sends signed minutes; grant credit sends cents from "R$ 50,00"
- [x] Reception role fixture shows no Ajustar/Cancelar/Conceder/Vender buttons
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add admin subscriptions tab`

---

#### T47: Build Vender assinatura dialog

**What**: Header action "Vender assinatura" (nucleo slot `admin.reservations.headerActions`): customer search (nucleo `useCustomerSearch`), category (incl. admin-only), base date, `FixedSchedulePicker` for fixed, optional coupon, payment mode link (hold hours, default 24) or manual (justification), quote summary, submit with Idempotency-Key.
**Where**: `apps/web/src/features/admin-reservas/SellSubscriptionDialog.tsx`
**Depends on**: T46, T36
**Reuses**: T36 picker, T33 coupon field
**Requirement**: REC-150

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Link mode sends `{ payment: { mode:'link', holdHours:24 } }`; manual mode requires a 5+ char justification
- [x] Fixed category shows the picker; conflict disables submit; success toast "Assinatura criada. Link enviado ao cliente."
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add sell subscription dialog`

---

### Phase 10 (Integration): End-to-end flows

#### T48: E2E: buy an hour package and book with it

**What**: Playwright spec + receita e2e helpers (seed categories, run jobs through `jobs/cli.ts`): sign up → `/precos` → Assinar Pacote 20h → sandbox Pix approve → `/app/compras` shows 20h → book Wed 19:00–20:00 with the package ("vai debitar 78 min") → extrato shows "60 min + 18 min de excedente = 78 min" → buy 5 extra hours (R$ 400,00).
**Where**: `apps/web/e2e/receita-hour-package.spec.ts`
**Depends on**: T29, T37, T38, T34
**Reuses**: nucleo Playwright config and sandbox checkout page
**Requirement**: REC-14, REC-16, REC-24, REC-29, REC-41, REC-63, REC-66

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Flow passes on a phone viewport (390×844) and counts ≤ 4 visible steps in the purchase
- [ ] Gate check passes: `npm run e2e -w apps/web`
- [ ] Test count: ≥ 1 e2e spec with ≥ 6 assertions passes

**Tests**: e2e
**Gate**: E2E

**Commit**: `test(e2e): cover hour package purchase and package booking`

---

#### T49: E2E: coupon, slot discount and credits in checkout

**What**: Admin creates coupon R$ 20 limited to 1 use and a 10% discount on Tue 14:00–16:00; tenant books it with the coupon → summary shows the larger-discount note and deposit R$ 70,00; second tenant gets "Cupom esgotado"; the public grid shows "−10%" on the remaining discounted slot.
**Where**: `apps/web/e2e/receita-discounts.spec.ts`
**Depends on**: T48, T33, T45
**Reuses**: T48 helpers
**Requirement**: REC-120, REC-122, REC-123, REC-136

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All assertions above pass against the running API
- [ ] Gate check passes: `npm run e2e -w apps/web`
- [ ] Test count: ≥ 1 e2e spec passes

**Tests**: e2e
**Gate**: E2E

**Commit**: `test(e2e): cover coupons, slot discounts and credits`

---

#### T50: E2E: fixed-schedule purchase, admin sale and renewal jobs

**What**: Tenant buys Meio turno mensal (conflict date blocked first → suggestion used → 22 occurrences, R$ 6.160,00); admin sells Turno mensal with a link to another customer who pays it; `jobs/cli.ts` runs renewals/rollover/suspensions at 2026-11-30 and 2026-12-02 with a declining sandbox card → subscription "Suspensa" in the Admin Assinaturas tab.
**Where**: `apps/web/e2e/receita-fixed-and-renewals.spec.ts`
**Depends on**: T48, T47
**Reuses**: T48 helpers
**Requirement**: REC-85, REC-88, REC-150, REC-54

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All assertions above pass; Admin calendar shows next period occurrences as "Pré-reservada (renovação)" before the suspension and released after
- [ ] Gate check passes: `npm run e2e -w apps/web`
- [ ] Test count: ≥ 1 e2e spec passes

**Tests**: e2e
**Gate**: E2E

**Commit**: `test(e2e): cover fixed schedule, admin sale and renewals`

---

## Phase Execution Map

Lane A phases run in order; Lane B phases run in order in their own worktree once Phase 1 is merged; Phase 10 runs last on `main`.

```
Lane A:      Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
Lane B:      (after Phase 1) Phase 7 → Phase 8 → Phase 9
Integration: (after Phase 6 and Phase 9) Phase 10
```

Batch packing (~7 tasks, whole phases): Lane A — B1 = P1 + P2 (7), B2 = P3 (6), B3 = P4 (5), B4 = P5 (6), B5 = P6 (5). Lane B — B6 = P7 (5), B7 = P8 (7), B8 = P9 (6). Integration — B9 = P10 (3). Model tier: B1–B4 high-reasoning (money/minute domain, concurrency); B5–B9 implementation tier.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Status machines + labels | 1 module + label additions | ⚠️ OK (cohesive) |
| T2: Contract schemas | 1 file | ✅ Granular |
| T3: Fixed occurrences | 1 file | ✅ Granular |
| T4: Discounts | 1 file | ✅ Granular |
| T5: Debit | 1 file | ✅ Granular |
| T6: Conversion + compensation | 2 small pure files, one concern (package math) | ⚠️ OK (cohesive) |
| T7: Period + allocation | 2 small pure files, one concern (balance rules) | ⚠️ OK (cohesive) |
| T8: Schema + migrations + factories | one schema change set (merge-forward of schema and its tests) | ⚠️ OK (cohesive) |
| T9: Credits service + routes | route + its service | ⚠️ OK (cohesive) |
| T10: Minutes service | 1 file | ✅ Granular |
| T11: Coupons service + routes | route + its service | ⚠️ OK (cohesive) |
| T12: Slot discounts service + routes | route + its service | ⚠️ OK (cohesive) |
| T13: Package payment service | 1 file | ✅ Granular |
| T14: E-mail templates | 1 file | ✅ Granular |
| T15: Compensation service | 1 file | ✅ Granular |
| T16: Revenue steps + registration | 1 file + registration lines | ⚠️ OK (cohesive) |
| T17: Category extension | 1 file + schema union entry | ⚠️ OK (cohesive) |
| T18: Quote service + public routes | route + its service | ⚠️ OK (cohesive) |
| T19: Purchase service | 1 file | ✅ Granular |
| T20: Period service | 1 file | ✅ Granular |
| T21: Charge handlers | 1 file | ✅ Granular |
| T22: Switch service | 1 file | ✅ Granular |
| T23: Cancel service | 1 file | ✅ Granular |
| T24: Extra hours service + routes | route + its service | ⚠️ OK (cohesive) |
| T25: Tenant subscription routes | 1 file | ✅ Granular |
| T26: Admin subscription routes | 1 file | ✅ Granular |
| T27: Renewals job | 1 file | ✅ Granular |
| T28: Rollover + suspensions jobs | 2 job files sharing the period service | ⚠️ OK (cohesive) |
| T29: Expiry job + registration | 1 job + registration lines | ⚠️ OK (cohesive) |
| T30: Types, fixtures, hooks | one data layer | ⚠️ OK (cohesive) |
| T31: PackageCard + BalanceMeter | 2 small presentational components | ⚠️ OK (cohesive) |
| T32: LedgerTable | 1 component | ✅ Granular |
| T33: CouponField + CreditsToggle | 1 file, 2 small controls | ⚠️ OK (cohesive) |
| T34: PackagePaymentOption | 1 component | ✅ Granular |
| T35: PackagesSection | 1 component | ✅ Granular |
| T36: FixedSchedulePicker | 1 component | ✅ Granular |
| T37: SubscribePage | 1 page | ✅ Granular |
| T38: ComprasPage | 1 page (+ its card/dialog) | ⚠️ OK (cohesive) |
| T39: Switch + cancel dialogs | 1 file, 2 dialogs | ⚠️ OK (cohesive) |
| T40: HorasExtrasPage | 1 page | ✅ Granular |
| T41: Créditos + Histórico | 1 file, 2 read-only pages | ⚠️ OK (cohesive) |
| T42: CuponsPage | 1 page (+ drawer) | ⚠️ OK (cohesive) |
| T43: CouponFormModal | 1 component | ✅ Granular |
| T44: Package category forms | 1 file, 2 forms | ⚠️ OK (cohesive) |
| T45: SlotDiscountDialog | 1 component + registration | ⚠️ OK (cohesive) |
| T46: AssinaturasTab | 1 tab (+ its dialogs) | ⚠️ OK (cohesive) |
| T47: SellSubscriptionDialog | 1 component | ✅ Granular |
| T48: E2E hour package | 1 spec (+ helpers) | ✅ Granular |
| T49: E2E discounts | 1 spec | ✅ Granular |
| T50: E2E fixed + renewals | 1 spec | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (same-phase arrows) | Status |
| --- | --- | --- | --- |
| T1 | None | - | ✅ Match |
| T2 | T1 | T1 | ✅ Match |
| T3 | None | - | ✅ Match |
| T4 | T2 (earlier phase) | - | ✅ Match |
| T5 | T1 (earlier phase) | - | ✅ Match |
| T6 | T5 | T5 | ✅ Match |
| T7 | T1 (earlier phase) | - | ✅ Match |
| T8 | T1 (earlier phase) | - | ✅ Match |
| T9 | T8 | T8 | ✅ Match |
| T10 | T8 | T8 | ✅ Match |
| T11 | T8; T4 (earlier) | T8 | ✅ Match |
| T12 | T8; T4 (earlier) | T8 | ✅ Match |
| T13 | T10; T5, T7 (earlier) | T10 | ✅ Match |
| T14 | T2 (earlier) | - | ✅ Match |
| T15 | T14; T9, T10, T6 (earlier) | T14 | ✅ Match |
| T16 | T15; T9, T11, T12, T13 (earlier) | T15 | ✅ Match |
| T17 | T14 | T14 | ✅ Match |
| T18 | T3, T4, T7, T9, T11 (earlier) | - | ✅ Match |
| T19 | T18, T11, T9, T14 (earlier) | - | ✅ Match |
| T20 | T19; T10, T15 (earlier) | T19 | ✅ Match |
| T21 | T19, T20 | T19, T20 | ✅ Match |
| T22 | T21; T6 (earlier) | T21 | ✅ Match |
| T23 | T20, T21 | T20, T21 | ✅ Match |
| T24 | T9, T10, T14 (earlier) | - | ✅ Match |
| T25 | T19, T22, T23 (earlier) | - | ✅ Match |
| T26 | T19, T23, T10 (earlier) | - | ✅ Match |
| T27 | T20, T21 (earlier) | - | ✅ Match |
| T28 | T20, T23 (earlier) | - | ✅ Match |
| T29 | T27, T28; T24 (earlier) | T27, T28 | ✅ Match |
| T30 | T2 (earlier, cross-lane) | - | ✅ Match |
| T31 | T30 | T30 | ✅ Match |
| T32 | T30 | T30 | ✅ Match |
| T33 | T30 | T30 | ✅ Match |
| T34 | T30 | T30 | ✅ Match |
| T35 | T31 (earlier) | - | ✅ Match |
| T36 | T30, T3 (earlier) | - | ✅ Match |
| T37 | T36; T33 (earlier) | T36 | ✅ Match |
| T38 | T31 (earlier) | - | ✅ Match |
| T39 | T38, T36 | T38, T36 | ✅ Match |
| T40 | T31 (earlier) | - | ✅ Match |
| T41 | T30 (earlier) | - | ✅ Match |
| T42 | T30 (earlier) | - | ✅ Match |
| T43 | T42 | T42 | ✅ Match |
| T44 | T30, T3 (earlier) | - | ✅ Match |
| T45 | T30 (earlier) | - | ✅ Match |
| T46 | T32 (earlier) | - | ✅ Match |
| T47 | T46; T36 (earlier) | T46 | ✅ Match |
| T48 | T29, T37, T38, T34 (earlier) | - | ✅ Match |
| T49 | T48; T33, T45 (earlier) | T48 | ✅ Match |
| T50 | T48; T47 (earlier) | T48 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1–T7 | `packages/core` receita modules | unit | unit | ✅ OK |
| T8 | Migrations and constraints (+ schema declarations, merge-forward) | integration | integration | ✅ OK |
| T9–T13, T15–T24 | `apps/api` services / routes | integration | integration | ✅ OK |
| T14 | `apps/api` e-mail templates | unit | unit | ✅ OK |
| T25, T26 | `apps/api` routes | integration | integration | ✅ OK |
| T27–T29 | `apps/api` jobs (+ `neon.ts`, build gate) | integration | integration | ✅ OK |
| T30–T47 | `apps/web` components, hooks, pages | unit | unit | ✅ OK |
| T48–T50 | Integrated flows | e2e | e2e | ✅ OK |
