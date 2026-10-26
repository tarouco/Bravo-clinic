# Núcleo Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/nucleo/design.md`
**Spec**: `.specs/features/nucleo/spec.md`
**Blueprint**: `docs/architecture.md`
**Status**: Draft

Worker rules specific to this feature:

- Fundação must be complete (all its phases merged) before Phase 1 starts.
- Before installing any package run `npm view <pkg>@<line> version` and pin the newest patch of the line in `docs/architecture.md` §1 (`msw` line `^2` for web tests).
- Never print secret values. Never put real gateway credentials in tests; adapters are tested with stubbed `fetch`.
- Tests assert the spec's worked-example values verbatim (W-CL, W-CC, W-PR, W-SP, W-CA, W-RS, W-ST, W-AV). Inject `now`; never read the clock in core.
- Phase 13 T50 deploys to production: it runs only after the user gives an explicit go-ahead in chat for that task (skill blast-radius rule).

---

## Test Coverage Matrix

> Generated from project guidelines and spec - confirm before Execute. Guidelines found: `.specs/STATE.md` AD-010 (Vitest everywhere; Playwright smoke for the booking flow), AD-018 (API tests on `DATABASE_URL_TEST`, serial, truncation), `docs/architecture.md` §11, and the fundação matrix (same layers, same commands). Strong defaults applied on top.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `packages/core` domain modules (grid, pricing, split, policies, status) | unit | All branches; 1:1 to spec ACs; every worked-example row asserted verbatim | `packages/core/src/**/*.test.ts` | `npm test -w packages/core` |
| `packages/core/contracts` zod schemas | unit | Each schema accepts one valid fixture and rejects one invalid field per required key group | `packages/core/src/contracts/*.test.ts` | `npm test -w packages/core` |
| `apps/api` pure libs (ics, gateway adapters with stubbed fetch, registry defaults, csv) | unit | All branches; request shapes and signature checks asserted byte-level | `apps/api/src/**/*.test.ts` | `npm test -w apps/api` |
| `apps/api` routes, services, jobs, migrations | integration (`app.request()` / job functions + real Postgres) | Every route: happy path + each listed error code + role checks; persisted rows asserted; responses parsed with core contracts | `apps/api/src/**/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` Drizzle schema files | none | - (merge-forward: the migration task's integration tests exercise them) | - | build gate only |
| `apps/web` components, hooks, pages | unit (Testing Library + jsdom + MSW) | Every AC of the component: text, roles, attributes, interactions, error states; fixtures parsed by core contracts | `apps/web/src/**/*.test.tsx` | `npm test -w apps/web` |
| Booking and admin flows end to end | e2e (Playwright against local API + web + test DB) | Spec success criteria scenarios | `apps/web/e2e/*.spec.ts` | `npm run e2e -w apps/web` |
| Deploy config (`neon.ts` triggers) | unit | Trigger list asserted by value | `neon.test.ts` (root, run by `npm test -w apps/api`) | `npm test -w apps/api` |
| Production rollout | e2e smoke | health, one booking flow page, one `job_runs` row per trigger | `scripts/smoke.mjs` | `node scripts/smoke.mjs <siteUrl>` |

## Gate Check Commands

> Same commands as fundação; lane B uses a build variant that never touches the shared API test database.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test -w packages/core` (core) or `npm test -w apps/web` (web) or `npm test -w apps/api` (API pure libs) |
| Full | After tasks with integration tests | `npm run typecheck && npm test -w apps/api` |
| Build | After phase completion (Phase 1 and lane A phases, Phase 13) | `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build` |
| Build-B | After lane B phase completion | `npm run typecheck && npm run lint && npm test -w packages/core && npm test -w apps/web && API_PROXY_ORIGIN=https://example.invalid npm run build` |
| E2E | Phase 13 | `npm run e2e -w apps/web` |

---

## Parallel lanes

| Lane | Phases | Worktree branch | Scope |
| --- | --- | --- | --- |
| Shared | Phase 1 (T1–T4) | `main` (or `nucleo/core`, merged before lanes start) | `packages/core` only |
| A · backend | Phases 2–6 (T5–T28) | `nucleo/backend` | `apps/api`, `neon.ts` |
| B · frontend | Phases 7–12 (T29–T48) | `nucleo/frontend` | `apps/web` |
| Integration | Phase 13 (T49–T50) | `main` after both lanes merge | e2e + rollout |

Rules:

1. Lanes start only after Phase 1 is merged to `main`; both worktrees branch from that commit.
2. Lane B codes against the core contracts (T1) and design.md §API contract, using MSW fixtures validated by those schemas. It never calls a running API until Phase 13.
3. Lane B never runs `npm test -w apps/api` (the API harness truncates the shared `DATABASE_URL_TEST`); its phase gate is **Build-B**. Only lane A runs API integration tests.
4. Neither lane edits `packages/core`. A contract change discovered in a lane is made in a small core commit on `main`, both lanes rebase, and the change is noted in design.md §API contract.
5. File ownership: lane A owns `apps/api/**` and `neon.ts`; lane B owns `apps/web/**`. Neither edits the other's tree.
6. Cross-lane dependencies: Phase 13 depends on T28 (last of lane A) and T48 (last of lane B). Within lanes, B's data hooks map 1:1 to A's routes of the same name; mismatches surface in T49.
7. Merge order into `main`: lane A, then lane B (rebased), then Phase 13.

---

## Execution Plan

Phases are ordered; dependencies point backward only. Lanes A (Phases 2–6) and B (Phases 7–12) may run in parallel worktrees per §Parallel lanes; inside each lane, phases and tasks run in order. `[P]` marks a task with no dependency inside its phase.

### Phase 1: Core domain (shared)

```
T1 → T4
T2 → T3
```

### Phase 2: Booking data model and read paths (lane A)

```
T5 → T6 → T7 → T9
T6 → T8
```

### Phase 3: Calendar administration API (lane A)

```
T10 → T11
T12 [P]
T13 [P]
```

### Phase 4: Payments (lane A)

```
T15 → T16
T15 → T17 → T18 → T19
T14 → T18
```

### Phase 5: Booking lifecycle (lane A)

```
T20 → T21 → T22
T21 → T23
T21 → T25
T20 → T24
```

### Phase 6: Scheduled jobs (lane A)

```
T26 → T27
T26 → T28
```

### Phase 7: Web foundations (lane B)

```
T29 [P]
T30 [P]
T31 [P]
T32 → T33
```

### Phase 8: Public site (lane B)

```
T34 → T35
T36 [P]
```

### Phase 9: Booking and checkout flow (lane B)

```
T37 → T38 → T39
```

### Phase 10: Tenant app (lane B)

```
T40 → T41
T42 [P]
```

### Phase 11: Admin Calendário (lane B)

```
T43 [P]
T44 [P]
T45 [P]
```

### Phase 12: Admin Gestão de Reservas (lane B)

```
T46 → T47
T48 [P]
```

### Phase 13: Integration

```
T49 → T50
```

---

## Task Breakdown

### Phase 1: Core domain (shared)

#### T1: Define booking vocabulary and API contracts

**What**: Booking status machine (`canTransition`, `assertTransition`, status groups incl. AD-032 transitions), pt-BR labels, `paymentStatusOf`, and zod request/response schemas for every row of design.md §API contract (`public.ts`, `app.ts`, `admin.ts`, `common.ts` under `contracts/`), re-exported from `src/index.ts`.
**Where**: `packages/core/src/contracts/app.ts`
**Also**: `packages/core/src/contracts/{public,admin,common}.ts`, `packages/core/src/status/booking.ts`, `packages/core/src/labels.ts`
**Depends on**: None (fundação complete)
**Reuses**: settings catalog types, `LocalDate`
**Requirement**: NUC-01, NUC-02, NUC-03, NUC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test enumerates all 121 (from, to) pairs and asserts `canTransition` true exactly for architecture §3.1 plus `expired→confirmed`, `expired→paid`, `paid→confirmed`
- [x] Test asserts every status label of NUC-02 and every `paymentStatusOf` branch of NUC-03
- [x] Each contract schema has one passing fixture and one failing fixture (missing/invalid key) test
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 30 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add booking status machine, labels and api contracts`

---

#### T2: Implement business window and slot grid with cleanup [P]

**What**: `resolveDayType`, `businessWindow` (architecture §7.3), `validateInterval`, `generateSlotGrid`, `rejectMessage` (§7.4), `findCleanupConflicts`, `occupiedFromBooking`, `occupiedFromBlock`.
**Where**: `packages/core/src/slots/grid.ts`
**Also**: `packages/core/src/calendar/day-type.ts`
**Depends on**: None
**Reuses**: `localToUtc`, `utcToLocal`, `addDays`, `weekdayOf` (fundação time.ts)
**Requirement**: NUC-07, NUC-08, NUC-09, NUC-10, NUC-11, NUC-12, NUC-13, NUC-14, NUC-15, NUC-16, NUC-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] One test per W-CL row (CL-1..CL-10) and W-CC row (CC-1..CC-4) with the exact expected reasons, cells and `maxEndMinute`
- [x] Tests for every reject reason and its pt-BR message (NUC-17), window null cases (closed day clinic/room, closed holiday, closed weekday) and holiday hours
- [x] Test asserts the conflict predicate equals `[S, E+c) && [o.start, o.occupiedUntil)` over a randomized table of 200 intervals
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 35 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add business window and slot grid with cleanup rules`

---

#### T3: Implement pricing engine

**What**: `selectHourlyCategory`, `priceHourlyBooking`, `priceBlockBooking`, `averageHourlyCents`, `categoryAverageHourlyCents`, `vSlotForInterval`, `coverageBands`, `fromPriceCents` per architecture §7.5 and design.md.
**Where**: `packages/core/src/pricing/price.ts`
**Also**: `packages/core/src/pricing/categories.ts`
**Depends on**: T2
**Reuses**: `resolveDayType` (T2), `mulDivRoundHalfUp` (fundação)
**Requirement**: NUC-18, NUC-19, NUC-20, NUC-21, NUC-22, NUC-23, NUC-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] One test per W-PR row (PR-1..PR-8) and W-AV row (AV-1..AV-4) with exact segments and cents
- [x] Tests for tie-break by display order, inactive categories ignored, rounding 9701 × 90 min = 14552, block applies/doesn't apply on weekday and holiday
- [x] Tests for `coverageBands` with factory categories (no uncovered) and with "1 hora — noite" inactive (19:00–00:00 uncovered on Tuesday); `fromPriceCents` = 8000
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 20 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add category pricing engine with segments and averages`

---

### Phase 2: Booking data model and read paths (lane A)

```
T5 → T6 → T7 → T9
T6 → T8
```

### Phase 3: Calendar administration API (lane A)

```
T10 → T11
T12 [P]
T13 [P]
```

### Phase 4: Payments (lane A)

```
T15 → T16
T15 → T17 → T18 → T19
T14 → T18
```

### Phase 5: Booking lifecycle (lane A)

```
T20 → T21 → T22
T21 → T23
T21 → T25
T20 → T24
```

### Phase 6: Scheduled jobs (lane A)

```
T26 → T27
T26 → T28
```

### Phase 7: Web foundations (lane B)

```
T29 [P]
T30 [P]
T31 [P]
T32 → T33
```

### Phase 8: Public site (lane B)

```
T34 → T35
T36 [P]
```

### Phase 9: Booking and checkout flow (lane B)

```
T37 → T38 → T39
```

### Phase 10: Tenant app (lane B)

```
T40 → T41
T42 [P]
```

### Phase 11: Admin Calendário (lane B)

```
T43 [P]
T44 [P]
T45 [P]
```

### Phase 12: Admin Gestão de Reservas (lane B)

```
T46 → T47
T48 [P]
```

### Phase 13: Integration

```
T49 → T50
```

---

## Task Breakdown

### Phase 1: Core domain (shared)

#### T1: Define booking vocabulary and API contracts

**What**: Booking status machine (`canTransition`, `assertTransition`, status groups incl. AD-032 transitions), pt-BR labels, `paymentStatusOf`, and zod request/response schemas for every row of design.md §API contract (`public.ts`, `app.ts`, `admin.ts`, `common.ts` under `contracts/`), re-exported from `src/index.ts`.
**Where**: `packages/core/src/contracts/app.ts`
**Also**: `packages/core/src/contracts/{public,admin,common}.ts`, `packages/core/src/status/booking.ts`, `packages/core/src/labels.ts`
**Depends on**: None (fundação complete)
**Reuses**: settings catalog types, `LocalDate`
**Requirement**: NUC-01, NUC-02, NUC-03, NUC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test enumerates all 121 (from, to) pairs and asserts `canTransition` true exactly for architecture §3.1 plus `expired→confirmed`, `expired→paid`, `paid→confirmed`
- [x] Test asserts every status label of NUC-02 and every `paymentStatusOf` branch of NUC-03
- [x] Each contract schema has one passing fixture and one failing fixture (missing/invalid key) test
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 30 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add booking status machine, labels and api contracts`

---

#### T2: Implement business window and slot grid with cleanup [P]

**What**: `resolveDayType`, `businessWindow` (architecture §7.3), `validateInterval`, `generateSlotGrid`, `rejectMessage` (§7.4), `findCleanupConflicts`, `occupiedFromBooking`, `occupiedFromBlock`.
**Where**: `packages/core/src/slots/grid.ts`
**Also**: `packages/core/src/calendar/day-type.ts`
**Depends on**: None
**Reuses**: `localToUtc`, `utcToLocal`, `addDays`, `weekdayOf` (fundação time.ts)
**Requirement**: NUC-07, NUC-08, NUC-09, NUC-10, NUC-11, NUC-12, NUC-13, NUC-14, NUC-15, NUC-16, NUC-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] One test per W-CL row (CL-1..CL-10) and W-CC row (CC-1..CC-4) with the exact expected reasons, cells and `maxEndMinute`
- [x] Tests for every reject reason and its pt-BR message (NUC-17), window null cases (closed day clinic/room, closed holiday, closed weekday) and holiday hours
- [x] Test asserts the conflict predicate equals `[S, E+c) && [o.start, o.occupiedUntil)` over a randomized table of 200 intervals
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 35 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add business window and slot grid with cleanup rules`

---

#### T3: Implement pricing engine

**What**: `selectHourlyCategory`, `priceHourlyBooking`, `priceBlockBooking`, `averageHourlyCents`, `categoryAverageHourlyCents`, `vSlotForInterval`, `coverageBands`, `fromPriceCents` per architecture §7.5 and design.md.
**Where**: `packages/core/src/pricing/price.ts`
**Also**: `packages/core/src/pricing/categories.ts`
**Depends on**: T2
**Reuses**: `resolveDayType` (T2), `mulDivRoundHalfUp` (fundação)
**Requirement**: NUC-18, NUC-19, NUC-20, NUC-21, NUC-22, NUC-23, NUC-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] One test per W-PR row (PR-1..PR-8) and W-AV row (AV-1..AV-4) with exact segments and cents
- [x] Tests for tie-break by display order, inactive categories ignored, rounding 9701 × 90 min = 14552, block applies/doesn't apply on weekday and holiday
- [x] Tests for `coverageBands` with factory categories (no uncovered) and with "1 hora — noite" inactive (19:00–00:00 uncovered on Tuesday); `fromPriceCents` = 8000
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 20 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add category pricing engine with segments and averages`

---

#### T4: Implement payment split and booking policies

**What**: `splitPayment` (§7.6), `evaluateCancellation`, `evaluateReschedule`, `rescheduleDifference` (§7.12), `settleReschedule`, `policySnapshot`, `renderPolicyText`.
**Where**: `packages/core/src/policy/cancellation.ts`
**Also**: `packages/core/src/payments/split.ts`, `packages/core/src/policy/reschedule.ts`, `packages/core/src/policy/policy-text.ts`
**Depends on**: T1
**Reuses**: `percentOfCents`, settings catalog, `PaymentMode` (T1)
**Requirement**: NUC-25, NUC-26, NUC-27, NUC-28, NUC-29, NUC-30, NUC-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] One test per W-SP (SP-1..SP-6), W-CA (CA-1..CA-10), W-RS (RS-1..RS-5) and W-ST (ST-1..ST-5) row with exact values and instants
- [ ] Tests assert the factory policy text contains every phrase of NUC-29 and the refundable variant of NUC-30
- [ ] Test asserts `policySnapshot` key set equals all `payment.*`, `policy.*`, `credits.validity_days` catalog keys
- [ ] Gate check passes: `npm test -w packages/core` (phase end: Build gate)
- [ ] Test count: ≥ 32 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(core): add signal split, cancellation and reschedule policies`

---

### Phase 2: Booking data model and read paths (lane A)

#### T5: Add booking schema, nucleo migrations and category seed

**What**: Drizzle tables of architecture §5.3 plus design.md refinements (`booking_reschedule_requests`, `bookings` token/cleanup-override columns, `refunds` attempts/error/booking_id); generated migration `<n>_nucleo`; custom `<n>_nucleo_constraints` (checks, partial uniques, `booking_events` append-only trigger); seed the 8 factory categories; test factories `createCategory`, `createBooking` (with occupancy).
**Where**: `apps/api/src/db/schema/booking.ts`
**Also**: `apps/api/src/db/schema/payments.ts`, `apps/api/drizzle/<n>_nucleo*.sql`, `apps/api/src/db/seed.ts`, `apps/api/test/factories.ts`
**Depends on**: T1
**Reuses**: fundação schema patterns, `forbid_update_delete()`, `runSeed`
**Requirement**: NUC-04 (status check), NUC-05 (events table)

**Tools**:

- MCP: NONE
- Skill: `neon-postgres` (migrations)

**Done when**:

- [x] Integration test: migrations apply on an empty DB and a second run applies nothing
- [x] Tests: invalid booking status rejected by CHECK; second `is_reference` row rejected; `booking_events` UPDATE/DELETE raise `append_only_table`; duplicate pending reschedule request per booking rejected; duplicate payment-link hash rejected
- [x] Test: seed inserts the 8 categories of design.md §Seeds (names, types, windows, rates, `is_reference` only on "1 hora"); rerun after editing a price keeps the edit
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 9 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add booking and payment schema with factory categories`

---

#### T6: Add extension registry with default ports

**What**: Registry types and `createRegistry(overrides)` per design.md §Extension registry (incl. `chargeHandlers`, `CategoryHandler.onUpdate`, `release` receiving the cancellation result, the 7 `StaffEvent` names); núcleo defaults (deferred credit port, zero compensation, no-op notifier, null media, mode handlers `deposit_balance`/`full_upfront`/`manual`, no charge handlers); `extensions/index.ts` wiring into `AppDeps`; helper `notifyStaffAfterCommit` that logs and swallows notifier errors.
**Where**: `apps/api/src/extensions/registry.ts`
**Also**: `apps/api/src/extensions/defaults.ts`, `apps/api/src/extensions/index.ts`
**Depends on**: T5
**Reuses**: `createApp(deps)` (fundação), logger
**Requirement**: NUC-201, NUC-104 (step contract), NUC-145 (deferred credit), NUC-205, NUC-209 (types), NUC-210 (types)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit tests assert every default of NUC-201 and that `createRegistry` sorts checkout steps by `order`
- [x] Unit test asserts a throwing notifier is logged with requestId and never rethrown
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add booking extension registry with default ports`

---

#### T7: Implement availability service and public availability endpoints

**What**: `loadCalendarInputs`, `getDayAvailability`, `getMonthAvailability`, `getAdminDay`, `findAffectedBookings`, exported helpers `loadDayContexts` and `getReferenceCategory` (receita B6); routes `GET /public/rooms/:slug/availability` and `/availability/month` with the 120/min/IP limit; decorators applied to public cells.
**Where**: `apps/api/src/modules/availability/availability.service.ts`
**Also**: `apps/api/src/modules/calendar/calendar.repo.ts`, `apps/api/src/routes/public/availability.ts`
**Depends on**: T6
**Reuses**: `businessWindow`, `generateSlotGrid` (T2), `priceBlockBooking` (T3), `consumeRateLimit`
**Requirement**: NUC-77, NUC-78, NUC-79, NUC-80, NUC-81, NUC-82, NUC-83, NUC-202 (API half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests seed bookings/blocks on 2026-10-27 and assert cells for CL-1/CL-9 shapes with no admin fields, names or tags in the JSON (parsed by `availabilityDaySchema`)
- [x] Tests: holiday flags on 2026-11-02; closed day returns `closed: true` and no cells; month statuses `past`, `full`, `closed`, `out_of_range`; stale hold treated as free; block option `available` false when partially occupied
- [x] Tests: malformed date → 422; 121st request in a minute → 429 with `Retry-After`; registered fake decorator adds `discountPercent`
- [x] Tests: `loadDayContexts` for two dates returns window, occupied intervals and closed flag per date; `getReferenceCategory` returns "1 hora"
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add public day and month availability`

---

#### T8: Add public rooms, catalog, clinic and policies endpoints

**What**: `GET /public/rooms`, `/rooms/:slug`, `/catalog`, `/clinic`, `/policies` per contract; photo URLs via `RoomMediaPort` (null → cover null).
**Where**: `apps/api/src/routes/public/catalog.ts`
**Also**: `apps/api/src/modules/catalog/catalog.service.ts`
**Depends on**: T6
**Reuses**: `fromPriceCents`, `categoryAverageHourlyCents` (T3), `renderPolicyText` (T4)
**Requirement**: NUC-74, NUC-75, NUC-76, NUC-84, NUC-85

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: rooms ordered with `fromPriceCents` 8000; inactive room absent and 404 on detail; catalog excludes inactive and `admin_only`; clinic returns 8 hour rows; policies returns version 1 and the rendered sections
- [x] All responses parsed by their core schemas
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add public rooms, catalog, clinic and policies endpoints`

---

#### T9: Implement quote pipeline and quote endpoint

**What**: `buildQuote` (validate → price hourly or block → registered checkout steps → `splitPayment` → memory lines) and `POST /public/bookings/quote` with rate limit and optional session; `request.addons` is passed untouched to steps (gestao `extras` step).
**Where**: `apps/api/src/modules/booking/quote.service.ts`
**Also**: `apps/api/src/routes/public/quote.ts`
**Depends on**: T7
**Reuses**: `loadCalendarInputs` (T7), registry (T6), core T2–T4
**Requirement**: NUC-86, NUC-87, NUC-88, NUC-104, NUC-81 (quote half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: PR-3 interval returns two segment lines, gross 21900, deposit 10950 (SP-1 timing), no rows written
- [x] Tests: CL-1 interval → 422 `SLOT_UNAVAILABLE` with reason `in_cleanup` and "Sala em limpeza"; PR-8 → 422 `NO_CATEGORY`; block with wrong window → 422 path `startMinute`
- [x] Test registers two fake steps (orders 400 and 100) and asserts they run in order 100 → 400 before the split
- [x] Test: a fake `extras` step (order 300) adding 16000 raises `netCents` by 16000, the deposit is split on the new net, and its `draft.extensions.extras` appears unchanged in `Quote.extensions`; `creditAvailableCents` comes from the credit port
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api` (phase end: Build gate)
- [x] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(api): add quote pipeline with checkout steps`

---

### Phase 3: Calendar administration API (lane A)

#### T10: Implement calendar config and policy settings endpoints

**What**: `GET /admin/calendar/config`, `PUT /admin/calendar/business-hours` (affected bookings), `PUT /admin/calendar/settings` (validation, non-multiple warning, cleanup conflicts, apply cleanup to future bookings without override), `GET/PUT /admin/settings/policies` (cross-field validation, version bump), all audited.
**Where**: `apps/api/src/modules/calendar/calendar-config.service.ts`
**Also**: `apps/api/src/modules/settings/policies.service.ts`, `apps/api/src/routes/admin/calendar.ts`, `apps/api/src/routes/admin/settings.ts`
**Depends on**: T9
**Reuses**: `findAffectedBookings` (T7), `findCleanupConflicts` (T2), `parseSetting`, `audit`
**Requirement**: NUC-32, NUC-33, NUC-34, NUC-35, NUC-36, NUC-37, NUC-38, NUC-172, NUC-173, NUC-174

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: reception → 403 on every route; hours with close ≤ open or 07:15 with slot 30 → 422 path; hours excluding a seeded 08:00 booking → 409 with that booking in `details.bookings`
- [x] Tests: default 45 with slot 30 → 422; cleanup 45 → warning `lostMinutesPerBooking: 15`; CC-1 data + cleanup 45 → 409 `CLEANUP_CONFLICTS`; CC-2 + 60 → future bookings get 60 and occupancy upper bound moves, a past booking and an overridden booking keep 30; audit rows exist
- [x] Tests: policies deadline 48 / charge 48 → 422 both paths; reminders [26, 36] → 422; a change increments `policy.version` to 2 with audit; identical PUT keeps version
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 13 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add calendar config and policy settings endpoints`

---

#### T11: Implement holidays and closed days endpoints

**What**: Holiday list/create/patch/delete/import (`importNationalHolidays` exported, BrasilAPI with 10 s timeout), closed-day list/preview/create/delete with affected bookings and `ClosedDayCompensationPort`; `lockCalendarDate` helper.
**Where**: `apps/api/src/modules/calendar/exceptions.service.ts`
**Also**: `apps/api/src/modules/calendar/holiday-import.ts`, `apps/api/src/modules/calendar/calendar-lock.ts`, `apps/api/src/routes/admin/calendar-exceptions.ts`
**Depends on**: T10
**Reuses**: `findAffectedBookings`, registry ports, `audit`
**Requirement**: NUC-43, NUC-44, NUC-45, NUC-46, NUC-47, NUC-48, NUC-49, NUC-50, NUC-51 (lock helper), NUC-204

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: `alert` true only within 30 days (injected now); closing a holiday with a booking → 409; manual create, duplicate 409, delete manual ok, delete seed 422
- [x] Tests with stubbed `fetch`: import 2027 inserts missing nationals, renames an existing one keeping `isClosed`; with `{ renameExisting: false }` the existing name is kept; year 2030 → 422; timeout/500/garbage → 502 and no row changed
- [x] Tests: preview returns affected bookings (a seeded `fixed_occurrence` booking is excluded and left to the port) and the fake port's numbers incl. `fixedOccurrencesCancelled`; create clinic-wide and per-room rows with audit and port `apply` called; past date → 422; delete reopens and availability shows cells again
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add holidays import and closed days with affected bookings`

---

#### T12: Implement manual blocks and recurrences [P]

**What**: Block create/list/delete (staff, all-or-nothing across rooms; services `createBlocks`, `deleteBlock` reused by gestao MCP), recurrence create/list/delete (admin, materialization to horizon, `skipConflicts`), `materializeRecurrences(db, now)` for the daily job, system-block helper `createHoldBlock` used by reschedule.
**Where**: `apps/api/src/modules/calendar/blocks.service.ts`
**Also**: `apps/api/src/routes/admin/blocks.ts`
**Depends on**: T7
**Reuses**: `room_occupancy`, exclusion constraint, `audit`
**Requirement**: NUC-54, NUC-55, NUC-56, NUC-57, NUC-58, NUC-59

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: two-room block creates 2 blocks + 2 occupancies `[start,end)`; overlap with a booking's cleanup in one room → 409 naming the booking code and zero blocks created
- [x] Tests: weekly Monday rule materializes to today+90; conflict date → 409 `details.dates`; `skipConflicts` returns `skipped`; second `materializeRecurrences` creates 0 duplicates and extends after `now` advances
- [x] Tests: block delete deactivates occupancy; recurrence delete cancels future blocks and keeps past ones; reception creating a recurrence → 403
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add tagged manual blocks and weekly recurrences`

---

#### T13: Implement categories admin and onboarding endpoints [P]

**What**: `GET/POST/PATCH /admin/categories`, `/:id/reference`, `/reorder`, `POST /admin/onboarding/prices-reviewed`; hourly and block validation; other types via `categoryHandlers` (422 when absent; `onUpdate` called before persisting); version bump and audit.
**Where**: `apps/api/src/modules/catalog/categories.service.ts`
**Also**: `apps/api/src/routes/admin/categories.ts`
**Depends on**: T6
**Reuses**: `categoryAverageHourlyCents` (T3), contracts (T1), `audit`
**Requirement**: NUC-61, NUC-62, NUC-63, NUC-64, NUC-65, NUC-66, NUC-67, NUC-68, NUC-69

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: list returns 8 seeded categories with averages (AV-1 8000) and `editable` only on hourly/block; create hourly ok and each invalid rule → 422 path; create block ok; `hour_package` → 422 "Tipo de categoria gerenciado em Pacotes"
- [x] Tests: price PATCH bumps version and audit before/after while an existing booking's segment keeps 9700; set reference moves the flag atomically; non-hourly reference → 422; deactivating reference → 422 message; reorder with a missing id → 422
- [x] Test: prices-reviewed sets the setting and writes audit; reception → 403
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api` (phase end: Build gate)
- [x] Test count: ≥ 12 tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(api): add category administration and onboarding review`

---

### Phase 4: Payments (lane A)

#### T14: Add ICS builder and booking mailer [P]

**What**: RFC 5545 `buildIcs(events[])` (one or more VEVENTs) and the 14 pt-BR templates of design.md §Mail and ICS, named as in the gestao notification catalog, with `bookingMailer` helpers that queue outbox rows (attachments for confirmed/rescheduled/cancelled).
**Where**: `apps/api/src/lib/ics.ts`
**Also**: `apps/api/src/emails/templates/booking.ts`, `apps/api/src/modules/booking/booking-mailer.ts`
**Depends on**: T5
**Reuses**: `queueEmail` + layout (fundação), `formatDateTimeBR`, `formatBRL`
**Requirement**: NUC-136 (content), NUC-137 (content), NUC-139

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit tests: ICS has CRLF only, folds a 100-char SUMMARY at 75 octets, escapes `,;\`, `METHOD:REQUEST` and `METHOD:CANCEL`, UTC `DTSTART`/`DTEND` equal to booking times (cleanup excluded), `SEQUENCE` value
- [x] Unit tests: subject "Reserva confirmada — BRV-ABC123" and each template's subject; html contains code, room, local date/time, amounts
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 10 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add rfc 5545 ics builder and booking email templates`

---

#### T15: Add payment gateway interface, resolver and sandbox adapter

**What**: `PaymentGateway` types, `resolveGateway` (setting `payment.active_gateway`, per-charge provider, `GATEWAY_NOT_CONFIGURED`, decrypt `integration_settings`), `listGatewayAdapters()` metadata, sandbox adapter (no network, signed sandbox webhook builder/parser, `verifyCredentials` always ok).
**Where**: `apps/api/src/payments/gateway.ts`
**Also**: `apps/api/src/payments/resolver.ts`, `apps/api/src/payments/adapters/sandbox.ts`
**Depends on**: T5
**Reuses**: `decryptSecret`, `sha256Hex` (fundação crypto)
**Requirement**: NUC-105, NUC-106, NUC-125, NUC-128, NUC-208

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit tests: sandbox `createCharge` returns `sbx_` id, checkout URL and Pix copy-paste; `parseWebhook` accepts its own signature and rejects a tampered body; `verifyCredentials` ok; `listGatewayAdapters()` lists sandbox and mercadopago with their credential fields
- [x] Unit tests: resolver picks the active gateway for new charges and the stored provider for an old charge; mercadopago without credentials throws `GATEWAY_NOT_CONFIGURED`
- [x] Test asserts adapters' logged payloads never contain keys `cardNumber`, `cvv`, `securityCode`
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add generic payment gateway with sandbox adapter`

---

#### T16: Implement Mercado Pago adapter

**What**: Mercado Pago REST adapter: Pix payment, Checkout Pro preference for card, saved-card charge (card token from `card_id` + customer payer), status by id or `external_reference`, cancel, refund, customers/cards, webhook signature + re-fetch, `verifyCredentials` (`GET /users/me`). First step: verify request shapes against current official docs (design.md §Payments, uncertain items) and note differences in the commit.
**Where**: `apps/api/src/payments/adapters/mercadopago.ts`
**Depends on**: T15
**Reuses**: gateway types (T15)
**Requirement**: NUC-105, NUC-114, NUC-122, NUC-123, NUC-124, NUC-208

**Tools**:

- MCP: `firecrawl` / Context7 (docs check)
- Skill: `firecrawl-developer-index`

**Done when**:

- [x] Unit tests with stubbed `fetch` assert URL, method, headers (`Authorization: Bearer`, `X-Idempotency-Key`) and JSON body for Pix (amount in reais, `payment_method_id: 'pix'`, `date_of_expiration`, `external_reference`) and preference (`expiration_date_to`, back URLs)
- [x] Unit tests: status mapping table (approved, pending, in_process, rejected, cancelled, refunded, charged_back); 10 s timeout → typed error; refund partial body
- [x] Unit tests: valid `x-signature` accepted, wrong `v1` or missing `ts` rejected; webhook result re-fetches `GET /v1/payments/{id}` and uses its status
- [x] Gate check passes: `npm test -w apps/api`
- [x] Test count: ≥ 12 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add mercado pago gateway adapter`

---

#### T17: Implement idempotency middleware, charge service and pay endpoints

**What**: `lib/idempotency.ts` middleware; generic `createCharge`/`submitCharge`/`cancelCharge` (booking-less charges allowed) with `createChargeForBooking` on top (after commit, 10 s timeout → 502 keeping charge pending); `POST /app/bookings/:id/pay` and `/pay-balance` with owner check, hold check, pending-charge reuse/replace, policy acceptance when missing, purpose rule (`booking_deposit`/`booking_full`/`booking_balance`/`booking_difference`).
**Where**: `apps/api/src/modules/payments/charges.service.ts`
**Also**: `apps/api/src/lib/idempotency.ts`, `apps/api/src/routes/app/payments.ts`
**Depends on**: T15
**Reuses**: `resolveGateway` (T15), consents table, `withTransaction`
**Requirement**: NUC-95 (middleware), NUC-107, NUC-108, NUC-109, NUC-110, NUC-111, NUC-134, NUC-135, NUC-209

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: missing key → 400; replay → same status/body; same key other body → 422 `IDEMPOTENCY_MISMATCH`
- [x] Tests (factory booking awaiting_payment): Pix pay → charge `booking_deposit` amount = payNow, `expires_at = hold_expires_at`, response parsed by `chargeIntentSchema`; under 48 h → `booking_full`; other user → 404; expired hold → 409 `HOLD_EXPIRED`; same method reuses, other method cancels previous
- [x] Tests: staff-created booking without consent → 422 `POLICY_ACCEPTANCE_REQUIRED`, with acceptance → consent row with snapshot version; gateway stub throwing → 502 and charge still pending
- [x] Tests: pay-balance creates `booking_balance`; after an approved balance charge a new one is `booking_difference`; `createCharge` with purpose `extra_hours` and no booking creates a pending charge and `submitCharge` calls the gateway
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 12 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add idempotent charge creation and pay endpoints`

---

#### T18: Implement webhook pipeline, payment effects and refunds

**What**: `POST /webhooks/pagamentos/:provider` (signature before insert, dedupe), `applyProviderStatus` (lock charge then booking; deposit/full/balance/difference effects; `onConfirmed` steps; first-confirmation mail with ICS; amount mismatch; late approval reinstate or refund + `booking.late_approval_refund` with 3 suggestions; reschedule-request application hook), `requestRefund` + `processPendingRefunds`.
**Where**: `apps/api/src/modules/payments/payment-effects.service.ts`
**Also**: `apps/api/src/modules/payments/refunds.service.ts`, `apps/api/src/routes/webhooks/pagamentos.ts`
**Depends on**: T14, T17
**Reuses**: `transitionBooking` helper (created here in `modules/booking/transition.ts`), mailer (T14), registry notifier
**Requirement**: NUC-112, NUC-113, NUC-114, NUC-115, NUC-116, NUC-117, NUC-118, NUC-119, NUC-136, NUC-205, NUC-209

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: invalid signature → 401 and 0 `webhook_events`; unknown provider → 404; duplicate delivery processed once (also with two concurrent requests)
- [x] Tests: approved deposit → booking `confirmed`, `paid_cents` += amount, one `booking.confirmed` outbox row with an `.ics` attachment, `booking_events` row, notifier called after commit with `new_booking` and `payment_received` (each with `entityId`); approved full → `paid`; rejected → charge `rejected`, booking still `awaiting_payment`
- [x] Tests: amount mismatch → booking unchanged + audit `payment.amount_mismatch`; late approval on expired booking with free slot → `confirmed` reason `late_approval`; with slot taken → refund row + `booking.late_approval_refund` listing 3 slots
- [x] Tests: refund success → charge `partially_refunded`/`refunded`, refund `approved` with `completed_at`; gateway failure → refund `pending` with `attempts = 1` and `last_error`; approved charges have `approved_at` and `fee_cents` (0 for sandbox)
- [x] Test: an approved `extra_hours` charge calls a registered fake `chargeHandlers.extra_hours.onApproved` once inside the transaction; a rejected one calls `onFailed`
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add idempotent payment webhooks with late approval and refunds`

---

#### T19: Add sandbox hosted checkout endpoints and saved cards

**What**: `GET /public/sandbox/charges/:id`, `POST .../approve|reject` (production guard: MFA staff only on `NEON_BRANCH=production`) routed through the signed sandbox webhook; `GET /public/payment-config`; `GET/POST/DELETE /app/cards` with `ensureCustomer`, `saveCard`, recurring consent.
**Where**: `apps/api/src/routes/public/sandbox.ts`
**Also**: `apps/api/src/routes/app/cards.ts`, `apps/api/src/modules/payments/cards.service.ts`
**Depends on**: T18
**Reuses**: `applyProviderStatus` (T18), sandbox adapter (T15)
**Requirement**: NUC-120, NUC-121, NUC-126, NUC-127, NUC-128, NUC-129

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: approve on dev → booking confirmed through a `webhook_events` row of provider `sandbox`; approve twice → 409; with `NEON_BRANCH=production` anonymous/tenant → 403, MFA staff → 200
- [x] Tests: payment-config returns `sandbox` and `publicKey: null`; save card without consent → 422; with consent → row with last4/brand, consent `recurring_charge`; delete → `deleted_at`; another user's card → 404; a body with a 16-digit `cardNumber` field → 422
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api` (phase end: Build gate)
- [x] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(api): add sandbox hosted checkout and saved cards`

---

### Phase 5: Booking lifecycle (lane A)

#### T20: Implement create booking endpoint

**What**: `createBooking` service + `POST /app/bookings` (IK), with exported helpers `insertBookingWithOccupancy` and `newBookingCode`; zero pay-now → confirmed/paid without charge; verified e-mail, document, prices-reviewed gate (tenants), policy acceptance/version, expected total, 3-hold limit, date advisory locks, lazy stale-hold expiry, occupancy `[S, E+c)`, segments, snapshot, code, `ics_uid`, consent, checkout-step `persist`, staff notifier.
**Where**: `apps/api/src/modules/booking/create-booking.service.ts`
**Also**: `apps/api/src/routes/app/bookings.ts` (POST only)
**Depends on**: T9 (phase 2), T11, T17 (phase 4)
**Reuses**: `buildQuote` (T9), `lockCalendarDate` (T11), `idempotent` (T17), `requireVerifiedEmail`
**Requirement**: NUC-05, NUC-13, NUC-51, NUC-70, NUC-89, NUC-90, NUC-91, NUC-92, NUC-93, NUC-94, NUC-95, NUC-96, NUC-97, NUC-207

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: unverified → 403; no document → 422 `PROFILE_INCOMPLETE`; prices not reviewed → 409 `BOOKING_NOT_OPEN` for tenant; policy false → 422; old version → 409 `POLICY_CHANGED`; wrong expected total → 409 `PRICE_CHANGED` with quote
- [x] Test: PR-3 booking → 201 parsed by `bookingDetailSchema`, status `awaiting_payment`, hold = now + 15 min, occupancy upper = 20:30, 2 segments, snapshot version 1, code matches `^BRV-[A-Z2-7]{6}$`, consent `booking_policy` `policy-v1`
- [x] Test: 10 concurrent requests for the same slot → exactly one 201 and nine 409 `SLOT_TAKEN`; 4th awaiting hold → 429; stale hold overlapping the slot is expired in the same transaction and the new booking succeeds
- [x] Test: a fake credit step making `payNowCents` 0 → booking `confirmed` with no charge row and a `booking.confirmed` outbox row
- [x] Test: closing the date concurrently with a booking yields either the booking in `AFFECTED_BOOKINGS` or the booking rejected `closed`, never both missing
- [x] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [x] Test count: ≥ 14 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add booking creation with checkout hold`

---

#### T21: Implement tenant booking reads, .ics download and profile update

**What**: `GET /app/bookings?tab`, `GET /app/bookings/:id` (detail serializer with `actions`, policy sections from snapshot, `pendingReschedule`), `GET /app/bookings/:id/ics`, `PATCH /app/me`.
**Where**: `apps/api/src/modules/booking/booking-serializer.service.ts`
**Also**: `apps/api/src/routes/app/bookings.ts` (GET routes), `apps/api/src/routes/app/me.ts` (PATCH)
**Depends on**: T20
**Reuses**: `paymentStatusOf` (T1), `evaluateReschedule` (T4), `buildIcs` (T14), `parseDocument`
**Requirement**: NUC-140, NUC-141, NUC-188, NUC-192

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: tabs split upcoming/past/cancelled with the ordering of NUC-188 and `paymentStatus` labels; cursor pagination; other user's booking → 404
- [ ] Tests: `actions.canReschedule` false with reason `too_late` at 23 h; `canPayBalance` true for deposit-paid booking; `.ics` content type `text/calendar` and UID = `ics_uid`
- [ ] Tests: PATCH name/phone ok; document set when null; second document → 422; taken document → 409 `DOCUMENT_TAKEN`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add tenant booking list, detail, ics and profile update`

---

#### T22: Implement reschedule for tenant and admin

**What**: `quoteReschedule`, `applyReschedule` (cheaper/equal immediate move with credit via `CreditPort`; more expensive → hold block + `booking_reschedule_requests` + `booking_difference` charge, 202), `applyRescheduleRequest` (called by payment effects), admin route with `exception`, `differenceHandling`, justification; package modes delegated to handlers; e-mail `booking.rescheduled`.
**Where**: `apps/api/src/modules/booking/reschedule.service.ts`
**Also**: `apps/api/src/routes/app/reschedule.ts`, `apps/api/src/routes/admin/booking-reschedule.ts`
**Depends on**: T21
**Reuses**: `settleReschedule` (T4), `createHoldBlock` (T12), `createChargeForBooking` (T17), registry
**Requirement**: NUC-137, NUC-142, NUC-143, NUC-144, NUC-145, NUC-146, NUC-147 (apply/refund half), NUC-148, NUC-149

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: quote returns settlement for ST-1 and ST-3; RS-2/RS-3/RS-4 → 422 `POLICY_VIOLATION` with reason; target in cleanup → 422 `SLOT_UNAVAILABLE`
- [ ] Tests: ST-2 move → occupancy moved, `reschedule_count` 1, `ics_sequence` +1, response `creditCents` 2300, `booking_events.data.creditGrant` `{ amountCents: 2300, status: 'deferred' }`, outbox `booking.rescheduled`
- [ ] Tests: ST-3 → 202 with charge 14300, hold block on the new slot, booking unchanged; approving the charge applies the move (paid 19151, balance 4849); approving after the slot was taken refunds 14300
- [ ] Tests: admin exception bypasses RS-5 with audit; `waive` writes `booking.difference_waived`; `add_to_balance` on a paid booking → `confirmed` with balance; package mode without handler → 422 `unsupported_payment_mode`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 14 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add policy-checked reschedule with difference payment`

---

#### T23: Implement cancellation for tenant and clinic

**What**: `previewCancellation` (snapshot policy), `cancelBooking` (tenant: refunds newest charges first; awaiting: cancel pending charges; clinic: refund or credit-when-live; minutes via handlers), checkout-step `release`, occupancy release, `booking.cancelled` with `METHOD:CANCEL`, notifier; routes app + admin.
**Where**: `apps/api/src/modules/booking/cancel.service.ts`
**Also**: `apps/api/src/routes/app/cancel.ts`, `apps/api/src/routes/admin/booking-cancel.ts`
**Depends on**: T21
**Reuses**: `evaluateCancellation` (T4), `requestRefund` (T18), `transitionBooking`
**Requirement**: NUC-05, NUC-06, NUC-137, NUC-148, NUC-150, NUC-151, NUC-152, NUC-153, NUC-175, NUC-205, NUC-210

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: preview equals CA-1, CA-2, CA-3, CA-4 for seeded bookings; a booking with snapshot `deposit_refundable=true` keeps CA-10 after the setting is changed to false (snapshot wins)
- [ ] Tests: CA-1 cancel → `cancelled_by_tenant`, one refund of 8000 on the balance charge, occupancy inactive, outbox with `METHOD:CANCEL`; awaiting cancel → pending charge cancelled, no refund
- [ ] Test: a fake step's `release` receives the cancellation result (`refundCents` 8000) on CA-1
- [ ] Tests: clinic `refund` → refunds total paid with audit; clinic `credit` with deferred port → 422; with a fake live port → port called with 16000; reception → 403
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add tenant and clinic cancellation with refunds`

---

#### T24: Implement staff booking operations

**What**: `POST /admin/bookings` (`kind` booking/pre-reservation, expiry, `confirmManually` admin-only), `confirm-manual`, `resend-link` (token rotation), `check-in` window, `PATCH cleanup` exception, `GET /public/pre-reservations/:token`; e-mail `booking.pre_reservation_link`.
**Where**: `apps/api/src/modules/booking/staff-booking.service.ts`
**Also**: `apps/api/src/routes/admin/bookings.ts`, `apps/api/src/routes/public/pre-reservations.ts`
**Depends on**: T20
**Reuses**: `createBooking` (T20), `randomToken`/`sha256Hex`, `audit`
**Requirement**: NUC-39, NUC-161, NUC-162, NUC-163, NUC-164, NUC-165, NUC-167

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: reception creates `awaiting_payment` (hold 15 min) and `pre_reserved` (hold 24 h default, 48 h when given) with source `admin` and outbox link `/pre-reserva/<token>`; reception `confirmManually` → 403; admin → `confirmed`, `payment_mode = 'manual'`, audit `booking.confirm_manual`, no balance schedule
- [ ] Tests: resend rotates the token (old → 404, new → summary); expired hold token → 404
- [ ] Tests: check-in at start − 61 min → 409 message; at start − 30 min → `checked_in_at` + audit; cleanup exception 0 with justification → occupancy upper = end; no justification → 422; reception → 403
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 12 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add staff bookings, pre-reservations and check-in`

---

#### T25: Implement admin read models and customer endpoints

**What**: `GET /admin/calendar/events` (≤ 42 days, filters), `GET /admin/rooms/:roomId/availability`, `GET /admin/bookings` (+ `q`), `GET /admin/bookings/export.csv`, `GET /admin/bookings/:id`, `GET /admin/customers/search`, `POST /admin/customers` (+ `account.set_password` 72 h).
**Where**: `apps/api/src/modules/admin/booking-queries.service.ts`
**Also**: `apps/api/src/modules/admin/customers.service.ts`, `apps/api/src/routes/admin/booking-queries.ts`, `apps/api/src/routes/admin/customers.ts`
**Depends on**: T21
**Reuses**: serializer (T21), `getAdminDay` (T7), password-reset token helpers (fundação)
**Requirement**: NUC-157, NUC-169, NUC-177, NUC-178

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: events for a week return first/full names, cleanup end, blocks with tag, holidays; 43-day range → 422; status/room/category filters narrow results
- [ ] Tests: list `q` by code, name (case-insensitive) and e-mail; page size 50 with `nextCursor`
- [ ] Test: CSV bytes start with BOM, header exactly as NUC-178, `;` separator, "27/10/2026 17:30", "219,00"; 5 001 matching rows → 422 message
- [ ] Tests: search needs ≥ 2 chars; create customer → tenant without password, verified e-mail, outbox `account.set_password`; duplicate e-mail → 409
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api` (phase end: Build gate)
- [ ] Test count: ≥ 11 tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(api): add admin calendar feed, bookings list, csv and customers`

---

### Phase 6: Scheduled jobs (lane A)

#### T26: Add job runner, triggers and hold expiry

**What**: `routes/jobs.ts` with `registerJob(name, job)`, `verifyTriggerRequest` (wrapping `parseTriggerDelivery`), `runJob` (advisory lock, `job_runs`), jobs `expire-holds` (holds, pre-reservations with e-mails and staff event, reschedule requests, idempotency purge) and `materialize-blocks` (recurrences + `job_runs` purge); triggers in `neon.ts`.
**Where**: `apps/api/src/routes/jobs.ts`
**Also**: `apps/api/src/jobs/{runner,expire-holds,materialize-blocks}.ts`, `apps/api/src/lib/trigger-auth.ts`, `neon.ts`, `neon.test.ts`
**Depends on**: T22, T24 (phase 5)
**Reuses**: `materializeRecurrences` (T12), `transitionBooking`, mailer, gateway `cancelCharge`
**Requirement**: NUC-06, NUC-57, NUC-147 (expiry half), NUC-166, NUC-195, NUC-196, NUC-197, NUC-199, NUC-200, NUC-205

**Tools**:

- MCP: NONE
- Skill: `neon-functions` (trigger delivery verification)

**Done when**:

- [ ] Tests: unverified request → 401 and no `job_runs`; verified (stubbed) → `job_runs` `ok` with stats; a job throwing → `error` row; concurrent second run → `{ skipped: true }`
- [ ] Tests: a held `fixed_occurrence` booking past its hold is left untouched; expired awaiting booking → `expired`, occupancy inactive, pending charge `cancelled`, a fake step's `release` called; pre-reservation → `expired` + outbox `booking.pre_reservation_expired` + notifier event; pending reschedule request → `expired` with its hold block cancelled; expired idempotency rows deleted
- [ ] Unit test (`neon.test.ts`) asserts the 6 triggers of NUC-199 with schedules and `functionPath`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 10 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add job runner, triggers and hold expiry`

---

#### T27: Implement balance and reminder jobs

**What**: `charge-balances` (saved card or Pix, card-declined fallback, deadline cancel `cancelled_nonpayment`) and `reminders` (balance reminders at configured hours, booking reminders 24 h/2 h, dedupe keys).
**Where**: `apps/api/src/jobs/charge-balances.ts`
**Also**: `apps/api/src/jobs/reminders.ts`
**Depends on**: T26
**Reuses**: `createChargeForBooking`, `chargeSavedCard`, mailer, `runJob`
**Requirement**: NUC-130, NUC-131, NUC-132, NUC-133, NUC-138

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (injected now = start − 48 h): saved card with consent → `booking_balance` saved_card charge; none → Pix expiring at start − 24 h + `booking.balance_charge`; declined card → Pix + `booking.balance_card_failed`; rerun creates no second charge
- [ ] Test (now = start − 24 h, unpaid): `cancelled_nonpayment`, `paid_cents` unchanged (sinal retained), occupancy inactive, pending charge cancelled, outbox `booking.cancelled_nonpayment`
- [ ] Tests: reminders at 48/36/26 h produce 3 rows total over repeated runs; booking reminders 24 h and 2 h once each; cancelled booking gets none
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 9 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add balance charging, deadline and reminder jobs`

---

#### T28: Implement attendance and payment reconciliation jobs

**What**: `no-shows` (no-show after `policy.no_show_after_minutes`, completed after end when checked in) and `reconcile-payments` (refresh pending charges via `getStatus` through `applyProviderStatus`, cancel stale charges without external id, expire past `expires_at`, `processPendingRefunds` up to 5 attempts then `failed` + `payment_issue`).
**Where**: `apps/api/src/jobs/reconcile-payments.ts`
**Also**: `apps/api/src/jobs/no-shows.ts`
**Depends on**: T26
**Reuses**: `applyProviderStatus`, `processPendingRefunds` (T18)
**Requirement**: NUC-119 (retries), NUC-168, NUC-198

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests: confirmed booking at start + 31 min without check-in → `no_show`; checked-in after end → `completed`; at start + 29 min unchanged
- [ ] Tests: pending sandbox charge whose stub status is approved → booking confirmed exactly as the webhook path; pending without external id at 11 min → `cancelled`; refund failing 5 times → `failed` + notifier `payment_issue`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api` (phase end: Build gate)
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: build

**Commit**: `feat(api): add no-show and payment reconciliation jobs`

---

### Phase 7: Web foundations (lane B)

#### T29: Add contract fixtures, MSW handlers, extension slots and analytics [P]

**What**: `msw@^2` dev dependency and Vitest setup; fixtures for every contract (parsed by core schemas at import); default handlers for all núcleo routes; `extensions/slots.tsx` with `<Slot>` and the 11 slot names of design.md §Web; `features/*/api.ts` hook files exporting typed TanStack Query hooks listed in design.md §Web; `lib/analytics.ts` `track()`.
**Where**: `apps/web/src/test/msw/handlers.ts`
**Also**: `apps/web/src/test/fixtures/nucleo.ts`, `apps/web/src/extensions/slots.tsx`, `apps/web/src/lib/analytics.ts`, `apps/web/src/features/*/api.ts`
**Depends on**: T1 (phase 1)
**Reuses**: `lib/api.ts`, `queryClient` (fundação), core contracts
**Requirement**: NUC-203, NUC-206 (track)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test: every slot name of NUC-203 renders nothing by default and renders a registered component
- [x] Test: a hook (`useDayAvailability`) returns the MSW fixture; a fixture violating its schema throws at import (test with a deliberately broken copy)
- [x] Tests: `track()` is a no-op without `VITE_GA4_ID`; with it, pushes the event to `window.dataLayer` and injects one gtag script
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add contract fixtures, msw handlers and extension slots`

---

#### T30: Implement Popover, HoverCard, Drawer and Stepper [P]

**What**: Accessible overlay and flow primitives (focus management, Esc, `aria-*`), design tokens per DESIGN.md.
**Where**: `apps/web/src/components/ui/Popover.tsx`
**Also**: `apps/web/src/components/ui/{HoverCard,Drawer,Stepper}.tsx`
**Depends on**: None (fundação UI kit)
**Reuses**: `Modal` focus-trap logic, `Button`, tokens
**Requirement**: NUC-98 (Stepper), NUC-159 (HoverCard)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: HoverCard opens on hover and on keyboard focus, closes on Esc and pointer leave; Drawer traps focus and returns it; Stepper renders 4 labelled steps with `aria-current="step"` on the active one
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add popover, hover card, drawer and stepper`

---

#### T31: Implement Table, StatusBadge, PriceTag, BookingSummary and PolicyAcceptance [P]

**What**: Sortable `Table` with sticky header and `useCsvDownload`; `StatusBadge` (status colors + `paymentStatus`); `PriceTag` ("R$ 80,00/h"); `BookingSummary` (memory lines of a `Quote` or `BookingDetail`); `PolicyAcceptance` (sections + required checkbox).
**Where**: `apps/web/src/components/ui/Table.tsx`
**Also**: `apps/web/src/components/booking/{StatusBadge,PriceTag,BookingSummary,PolicyAcceptance}.tsx`
**Depends on**: None
**Reuses**: `formatBRL`, labels (core), `Badge`, `Checkbox`
**Requirement**: NUC-100 (summary lines), NUC-179 (table)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: BookingSummary renders PR-3 fixture lines exactly "17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00" and "19:00–20:00 · 2 horas ou mais — noite · 1h × R$ 99,00 = R$ 99,00", total R$ 219,00, sinal and saldo with dates
- [x] Tests: StatusBadge label per status; PolicyAcceptance calls `onChange(true)` only when checked; Table sorts by column and triggers download with given filename
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add table and booking display components`

---

#### T32: Implement MonthCalendar and SlotGrid

**What**: `MonthCalendar` (picker with day statuses, holiday marker, disabled past/out-of-range) and `SlotGrid` (40 px slots, available/selected/unavailable styles, `−n%` discount marker, start selection then duration choice up to `maxEndMinute`).
**Where**: `apps/web/src/components/calendar/SlotGrid.tsx`
**Also**: `apps/web/src/components/calendar/MonthCalendar.tsx`
**Depends on**: None
**Reuses**: `minuteToHHMM`, tokens
**Requirement**: NUC-99, NUC-202 (marker)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: CL-4 fixture → clicking 11:30 offers durations 1h, 1h30, 2h (end ≤ 13:30) only; unavailable cells are `aria-disabled`; a cell with `discountPercent: 10` shows "−10%"
- [x] Tests: MonthCalendar disables `past`/`out_of_range`, shows "Feriado: Finados" title on 2026-11-02, arrow-key navigation moves focus by day/week
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add month calendar and slot grid`

---

#### T33: Implement WeekCalendar, MonthCalendarView and DayView

**What**: Schedule views shared by Admin and tenant Agenda: events positioned by minute, optional cleanup shading, block tags, holiday/closed markers, `markers` overlay prop, free-slot render prop, `onRangeSelect` (drag across free cells), prev/next/today navigation.
**Where**: `apps/web/src/components/calendar/WeekCalendar.tsx`
**Also**: `apps/web/src/components/calendar/{MonthCalendarView,DayView}.tsx`
**Depends on**: T32
**Reuses**: MonthCalendar grid helpers (T32), `utcToLocal`
**Requirement**: NUC-158 (rendering), NUC-190 (views)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: dragging from 10:00 to 11:30 over free cells calls `onRangeSelect` with 600–720; an event 17:30–20:00 spans 5 half-hour rows; `showCleanup` adds a shaded 20:00–20:30 band and `showCleanup={false}` omits it; block shows its tag; navigation emits the new range
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add week, month and day schedule views`

---

### Phase 8: Public site (lane B)

#### T34: Wire Home to live data and build Salas page

**What**: `/salas` with RoomCards from `useRooms`; Home RoomsSection and simulator switched to `useCatalog` + `priceHourlyBooking`; analytics `view_room` on card click.
**Where**: `apps/web/src/pages/public/rooms/RoomsPage.tsx`
**Also**: `apps/web/src/pages/public/home/RoomsSection.tsx`, `apps/web/src/pages/public/home/PricingSimulatorSection.tsx`
**Depends on**: T29, T31 (phase 7)
**Reuses**: `RoomCard`, home sections (fundação)
**Requirement**: NUC-180, NUC-181

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: `/salas` shows 3 cards with "A partir de R$ 80,00/h" and placeholder image when `cover` is null
- [x] Tests: simulator keeps FND-100 values with factory fixture, and shows R$ 180,00 for 2 h weekday when the fixture rate is 9000
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): wire home to live catalog and add salas page`

---

#### T35: Build Página da Sala with availability calendar

**What**: `/salas/:slug`: gallery, description, equipment, categories with average hourly value, MonthCalendar → SlotGrid, "Reservar este horário" link; 404 page for unknown slug.
**Where**: `apps/web/src/pages/public/rooms/RoomPage.tsx`
**Depends on**: T34
**Reuses**: MonthCalendar/SlotGrid (T32), hooks (T29)
**Requirement**: NUC-182

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: renders gallery placeholder, equipment list and "R$ 97,00/h" category; clicking 2026-10-27 then 17:30 and 2h30 produces link `/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200`; holiday marker visible; unknown slug (MSW 404) shows the 404 page
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add room page with availability calendar`

---

#### T36: Build Preços, Políticas, Contato, Termos and Privacidade pages [P]

**What**: `/precos` (hourly + block tables, `pricing.packages` slot), `/politicas` (API sections), `/contato` (address, WhatsApp, e-mail, hours, Maps link), `/termos` and `/privacidade` from `content/legal/*.md` with version lines.
**Where**: `apps/web/src/pages/public/PricingPage.tsx`
**Also**: `apps/web/src/pages/public/{PoliciesPage,ContactPage,LegalPage}.tsx`, `apps/web/src/content/legal/{termos,privacidade}.md`
**Depends on**: T29 (phase 7)
**Reuses**: `PriceTag` (T31), `useClinic`, `usePolicies`
**Requirement**: NUC-183, NUC-184, NUC-185, NUC-186

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: pricing lists 4 hourly categories with weekday/weekend rates and a registered fake `pricing.packages` slot renders after them; políticas renders the fixture section titles; contato has the exact Maps URL and per-day hours; legal pages show "Versão terms-2026-10" / "Versão privacy-2026-10"
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add pricing, policies, contact and legal pages`

---

### Phase 9: Booking and checkout flow (lane B)

#### T37: Build booking flow steps Sala e data and Horário

**What**: `BookingFlowPage` for `/reservar` and `/app/reservar`: Stepper (4 steps), state in URL, room select + MonthCalendar, SlotGrid with durations and block options; `select_slot` event.
**Where**: `apps/web/src/features/booking/BookingFlowPage.tsx`
**Also**: `apps/web/src/features/booking/{DateStep,TimeStep}.tsx`
**Depends on**: T35 (phase 8)
**Reuses**: Stepper (T30), MonthCalendar/SlotGrid (T32)
**Requirement**: NUC-98, NUC-99

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: stepper shows exactly "Sala e data · Horário · Resumo · Pagamento"; URL params prefill and skip to Horário; choosing a block option sets `bloco=<id>`; back keeps selection
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add booking flow date and time steps`

---

#### T38: Build Resumo step with auth interstitial and booking creation

**What**: Resumo with `useQuote`, BookingSummary, extension slots (`checkout.summary.*`), PolicyAcceptance, prices-not-reviewed banner, login/signup redirect with `next`, profile-incomplete redirect, create booking with Idempotency-Key, handling of `SLOT_TAKEN`, `PRICE_CHANGED`, `POLICY_CHANGED`; `begin_checkout` event.
**Where**: `apps/web/src/features/booking/SummaryStep.tsx`
**Depends on**: T37
**Reuses**: `useSession`, `useCreateBooking` (T29)
**Requirement**: NUC-100, NUC-101, NUC-187, NUC-206 (begin_checkout)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: button disabled until policy checked; anonymous click navigates to `/login?next=<same resumo url>`; `PROFILE_INCOMPLETE` navigates to `/app/perfil?completar=1&next=...`
- [x] Tests: 409 `SLOT_TAKEN` shows "Este horário acabou de ser reservado." and returns to Horário; `PRICE_CHANGED` re-renders new total and unchecks acceptance; `pricesReviewed: false` shows the banner and disables the button; success navigates to `/checkout/<id>`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add booking summary with policy acceptance`

---

#### T39: Build checkout, sandbox payment and pre-reservation pages

**What**: reusable `PaymentMethodPanel` (method choice Pix/card/saved card given a pay callback or a `ChargeIntent`) used by `/checkout/:bookingId` ( Pix QR + copy, card redirect, countdown, 2 s polling, rejected message, confirmation, `purchase` event, policy acceptance for staff-created bookings), `/pagamento/sandbox/:chargeId` (buttons with accessible names "Aprovar pagamento" and "Recusar pagamento", demo banner), `/pre-reserva/:token` (login/ownership routing).
**Where**: `apps/web/src/pages/public/CheckoutPage.tsx`
**Also**: `apps/web/src/pages/public/{SandboxCheckoutPage,PreReservationPage}.tsx`
**Depends on**: T38
**Reuses**: `usePay`, `useBooking({ poll })`, `CopyField` pattern, `Toast`
**Requirement**: NUC-102, NUC-103, NUC-118, NUC-120, NUC-171

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests (fake timers): countdown reaches 0 → "Tempo esgotado. O horário foi liberado."; status fixture switching to `confirmed` on the 2nd poll → "Reserva confirmada" with code; rejected charge → "Pagamento recusado. Tente outro método."
- [x] Tests: Pix shows QR image and copy button; sandbox page approve calls the endpoint and links back to checkout; pre-reserva anonymous → login redirect, other owner → "Este link pertence a outra conta.", owner → navigates to checkout
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add checkout, sandbox payment and pre-reservation pages`

---

### Phase 10: Tenant app (lane B)

#### T40: Build Minhas reservas, Agenda and app home

**What**: `/app/minhas-reservas` tabs with grouping by `group.id`, `/app/agenda` month/week/day without cleanup, `/app` next 3 bookings + Reservar.
**Where**: `apps/web/src/pages/app/MyBookingsPage.tsx`
**Also**: `apps/web/src/pages/app/{AgendaPage,AppHomePage}.tsx`
**Depends on**: T33 (phase 7)
**Reuses**: `Tabs`, `StatusBadge`, schedule views (T33)
**Requirement**: NUC-189, NUC-190, NUC-191

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: three tabs fetch their `tab` param; rows show payment status "Sinal pago · saldo pendente"; two rows with the same `group` render under one header; agenda switches views and shows no cleanup band; home lists 3 items
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add my bookings, agenda and app home`

---

#### T41: Build booking detail with pay, reschedule and cancel

**What**: `/app/minhas-reservas/:id`: summary, charges/refunds, `.ics` download, pay balance (reuses checkout payment panel), reschedule modal (MonthCalendar + SlotGrid + quote: credit or pay-now with charge intent), cancel modal (preview), "Fale com a recepção" fallback, `booking.detail.extra` slot.
**Where**: `apps/web/src/pages/app/BookingDetailPage.tsx`
**Also**: `apps/web/src/features/booking/{RescheduleModal,CancelModal}.tsx`
**Depends on**: T40
**Reuses**: payment panel (T39), SlotGrid (T32), `useClinicConfig`
**Requirement**: NUC-154, NUC-155, NUC-156

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: `canReschedule: false` hides Reagendar and shows the WhatsApp link; ST-2 quote fixture shows "Você recebe R$ 23,00 em créditos"; ST-3 shows "Diferença a pagar agora: R$ 143,00" and opens the payment panel on confirm (202)
- [x] Tests: cancel modal shows "Fica retido: R$ 80,00 (sinal)" and "Será devolvido: R$ 80,00" for CA-1 and calls cancel with an Idempotency-Key
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add booking detail with reschedule and cancel`

---

#### T42: Build profile completion and saved cards pages [P]

**What**: `/app/perfil` (edit name, phone, profession, registry; CPF/CNPJ when missing; `completar=1` highlight + `next` return) and `/app/perfil/cartoes` (list, remove, add via provider tokenizer from `payment-config`, consent required).
**Where**: `apps/web/src/pages/app/ProfilePage.tsx`
**Also**: `apps/web/src/pages/app/CardsPage.tsx`, `apps/web/src/features/payments/tokenizers.ts`
**Depends on**: T29 (phase 7)
**Reuses**: `DocumentInput`, `PhoneInput`, `Modal`
**Requirement**: NUC-193, NUC-194

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: `completar=1` focuses and highlights the document field; save then navigate to `next`; document field read-only when already set; 409 shows message under the field
- [x] Tests: cards list "Visa final 4242 · 12/2029"; add disabled until consent checked; sandbox tokenizer posts only `cardToken` (request body asserted to contain no card number); remove asks confirmation
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add profile completion and saved cards`

---

### Phase 11: Admin Calendário (lane B)

#### T43: Build hours editor, calendar parameters and first-access checklist [P]

**What**: `/admin/calendario` page shell; `WeekHoursEditor` (Mon–Sun + Feriados, inputs, shortcuts, P2 drag/keyboard handles); parameters panel with non-multiple warning and conflict modal (`CLEANUP_CONFLICTS`, `AFFECTED_BOOKINGS`); onboarding checklist.
**Where**: `apps/web/src/pages/admin/calendar/CalendarConfigPage.tsx`
**Also**: `apps/web/src/features/admin-calendar/{WeekHoursEditor,CalendarSettingsPanel,AffectedBookingsModal,OnboardingChecklist}.tsx`
**Depends on**: T30 (phase 7)
**Reuses**: `Modal`, `Field`, `useCalendarConfig` (T29)
**Requirement**: NUC-40, NUC-41, NUC-42, NUC-73

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: shortcut "Aplicar a seg–sex" copies Monday's hours to Tue–Fri; save sends 8 rows; cleanup 45 response shows the exact warning sentence; 409 fixtures open the modal listing booking codes with links
- [x] Tests: drag handle with ArrowDown moves end by 30 min (P2); checklist visible when `pricesReviewed: false` and the button calls the endpoint
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add calendar hours editor and parameters panel`

---

#### T44: Build categories table and category overlay [P]

**What**: Tabela de valores (all types, editable hourly/block rows, live average, V_ref radio, activate, reorder, "Nova categoria" form) and `CategoryBandOverlay` on the week grid with uncovered hatching.
**Where**: `apps/web/src/features/admin-calendar/CategoriesTable.tsx`
**Also**: `apps/web/src/features/admin-calendar/{CategoryForm,CategoryBandOverlay}.tsx`
**Depends on**: T31 (phase 7)
**Reuses**: `categoryAverageHourlyCents`, `coverageBands` (core), `Table`
**Requirement**: NUC-71, NUC-72

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: typing "1.600,00" with 20 h shows "R$ 1.600,00 → R$ 80,00/h" before saving; package rows read-only with "Gerenciado em Pacotes"; V_ref radio calls the reference endpoint; 422 shows field errors
- [x] Tests: overlay with "1 hora — noite" unchecked as inactive fixture hatches 19:00–00:00 with "Horário sem categoria"
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add categories table and category overlay`

---

#### T45: Build exceptions month view and block modal [P]

**What**: Monthly exceptions view (closed days, holidays with scope/alert, recurring blocks), holiday open/close toggle, add manual holiday, import year, closed-day modal (preview list + compensation), P2 holiday review banner, and the `BlockModal` (presets, free text, rooms, single or weekly for admins) reused by Gestão.
**Where**: `apps/web/src/features/admin-calendar/ExceptionsMonth.tsx`
**Also**: `apps/web/src/features/admin-calendar/{ClosedDayModal,HolidayForm,HolidayReviewBanner}.tsx`, `apps/web/src/features/admin-blocks/BlockModal.tsx`
**Depends on**: T33 (phase 7)
**Reuses**: MonthCalendarView (T33), `Modal`, hooks (T29)
**Requirement**: NUC-52, NUC-53, NUC-60

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: holiday with `alert` shows the alert icon; toggling closed with 409 opens the affected list; import shows `{ inserted, updated }` toast; closed-day modal shows "3 assinantes · 120 min · R$ 205,33" from fixture and confirm posts
- [x] Tests: BlockModal preset "Limpeza" and free text; weekly option hidden for reception; 409 shows conflicting code; banner shown with now = 2026-10-01 and next-year `needsReview` fixture (P2)
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add calendar exceptions view and block modal`

---

### Phase 12: Admin Gestão de Reservas (lane B)

#### T46: Build reservations calendar with hover popups and quick actions

**What**: `/admin/reservas` (sub-tabs calendario, lista, politicas + `admin.reservations.tabs` slot) and calendar sub-tab: week/month toggle, filters, legend, events with first name + room, blocks, cleanup, HoverCard popup with role/status actions (confirm, resend, reschedule, cancel, check-in), free-slot menu (pré-reserva, reserva, bloquear + slot actions).
**Where**: `apps/web/src/pages/admin/reservations/ReservationsCalendar.tsx`
**Also**: `apps/web/src/pages/admin/reservations/ReservationsPage.tsx`, `apps/web/src/features/admin-bookings/{BookingPopup,FreeSlotMenu}.tsx`
**Depends on**: T45 (phase 11)
**Reuses**: WeekCalendar/MonthCalendarView (T33), HoverCard (T30), BlockModal (T45)
**Requirement**: NUC-158, NUC-159, NUC-160

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: event shows "Ana · Sala Principal"; popup shows full name, "R$ 109,50 de R$ 219,00", times, category, badge; reception sees Check-in and Reenviar link but not Confirmar/Reagendar/Cancelar
- [x] Tests: free slot menu lists the 3 actions plus a registered slot action; Bloquear opens BlockModal prefilled; filters update the events query params; politicas tab hidden for reception
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add reservations calendar with popups and actions`

---

#### T47: Build create booking and pre-reservation drawer

**What**: Drawer opened from the free-slot menu or a button: customer search + "Novo cliente" inline form, room/date/times validated with admin availability, quote via BookingSummary, kind and expiry, admin-only "Confirmar sem pagamento" with justification, success state with copyable payment link.
**Where**: `apps/web/src/features/admin-bookings/CreateBookingDrawer.tsx`
**Also**: `apps/web/src/features/admin-bookings/CustomerPicker.tsx`
**Depends on**: T46
**Reuses**: Drawer (T30), BookingSummary (T31), SlotGrid (T32)
**Requirement**: NUC-170

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: search after 2 chars lists customers; new customer form posts and selects the result; pre-reservation default expiry 24 h editable; reception never sees "Confirmar sem pagamento"; admin manual confirm requires justification; success shows link with copy button
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add staff create booking and pre-reservation drawer`

---

#### T48: Build bookings list, CSV export and policies panel [P]

**What**: Lista sub-tab (search, filters in URL, sortable table, "Carregar mais", "Exportar CSV") and Políticas sub-tab (grouped fields, version, live `renderPolicyText` preview, cross-field errors).
**Where**: `apps/web/src/pages/admin/reservations/BookingsListPage.tsx`
**Also**: `apps/web/src/pages/admin/reservations/PoliciesPanel.tsx`
**Depends on**: T31 (phase 7)
**Reuses**: `Table` (T31), `renderPolicyText` (core), hooks (T29)
**Requirement**: NUC-176, NUC-179

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests: typing "BRV-" updates `?q=` and refetches; "Carregar mais" appends the next cursor page; "Exportar CSV" requests `export.csv` with current filters
- [x] Tests: panel shows the 6 group titles of NUC-176 and "Versão 1"; changing the sinal to 30 updates the preview to "sinal de 30%"; 422 fixture shows errors on both deadline fields
- [x] Gate check passes: `npm test -w apps/web` (phase end: Build-B gate)
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add bookings list with csv export and policies panel`

---

### Phase 13: Integration

#### T49: Add Playwright end-to-end suite against the real API

**What**: Merge both lanes; `apps/web/playwright.config.ts` starting API (on `DATABASE_URL_TEST`, migrated and seeded by `apps/api/test/e2e-seed.ts`: verified tenant, MFA admin with known TOTP secret, prices reviewed) and web; specs: (1) visitor signup → verify via outbox token → book Tue 17:30–20:00 → sandbox approve → "Reserva confirmada" + outbox `booking.confirmed`; (2) admin pre-reservation → manual confirm → check-in; (3) tenant reschedule cheaper and cancel with preview values; availability p95 measurement over 50 calls with 500 seeded bookings. Fix any contract mismatch found (core change on `main` per lane rule 4).
**Where**: `apps/web/e2e/booking.spec.ts`
**Also**: `apps/web/e2e/admin.spec.ts`, `apps/web/playwright.config.ts`, `apps/api/test/e2e-seed.ts`
**Depends on**: T28 (lane A end), T48 (lane B end)
**Reuses**: all núcleo code
**Requirement**: NUC-93, NUC-103 (end to end); spec Success Criteria

**Tools**:

- MCP: NONE
- Skill: `run`

**Done when**:

- [ ] The three specs pass headless in Chromium and at 375 px width (mobile project)
- [ ] Logged availability p95 ≤ 300 ms with the warm local/dev database
- [ ] Gate check passes: `npm run e2e -w apps/web` and the Build gate
- [ ] Test count: ≥ 3 e2e specs pass; total workspace test count not lower than before the merge

**Tests**: e2e
**Gate**: build

**Commit**: `test(e2e): add booking, payment and admin flows`

---

#### T50: Roll núcleo out to production (explicit go-ahead required)

**What**: After the user's go-ahead: apply núcleo migrations and seed to the Neon `production` branch, deploy the `api` function with triggers from `neon.ts`, deploy the web to Netlify, run the smoke script extended with `/api/public/rooms` and `/api/public/rooms/principal/availability`, and confirm one `job_runs` row per 5-minute trigger within 10 minutes. Update `.specs/STATE.md` Handoff.
**Where**: `scripts/smoke.mjs`
**Depends on**: T49
**Reuses**: fundação deploy runbook (fundação T76–T78)
**Requirement**: NUC-199 (live triggers)

**Tools**:

- MCP: `Neon`, `netlify`
- Skill: `neon-functions`, `netlify-deploy`

**Done when**:

- [ ] User gave explicit go-ahead in chat for this task
- [ ] `node scripts/smoke.mjs https://<site>` exits 0 including the two new checks
- [ ] Neon logs show each of the 5 frequent jobs ran with status `ok`
- [ ] Gate check passes: `node scripts/smoke.mjs <siteUrl>`

**Tests**: e2e
**Gate**: build

**Commit**: `chore(release): deploy nucleo to production`

---

## Phase Execution Map

```
Phase 1 (shared core)
├── Lane A: Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
└── Lane B: Phase 7 → Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12
Both lanes merged → Phase 13
```

Batch packing (~7 tasks, whole phases): B1 = P1 (4) · lane A: B2 = P2 (5) · B3 = P3 (4) · B4 = P4 (6) · B5 = P5 (6) · B6 = P6 (3) · lane B: B7 = P7 (5) · B8 = P8 + P9 (6) · B9 = P10 + P11 (6) · B10 = P12 (3) · B11 = P13 (2, T50 operator-approved). Model tier: B1, B4, B5 high-reasoning (core rules, money, concurrency); B2, B3, B6 and lane B implementation tier; B11 implementation tier with operator approval.

Tasks: 50 total · Phase 1: 4 · Lane A: 24 (Phases 2–6: 5, 4, 6, 6, 3) · Lane B: 20 (Phases 7–12: 5, 3, 3, 3, 3, 3) · Integration: 2.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | contracts + status + labels: one vocabulary concern, declarative | ⚠️ OK (cohesive) |
| T2 | grid + day type: one availability-math concern | ⚠️ OK (cohesive) |
| T3 | pricing (2 files, one engine) | ⚠️ OK (cohesive) |
| T4 | split + policies (4 small pure files, one policy concern) | ⚠️ OK (cohesive) |
| T5 | schema + migration + seed (merge-forward so schema is tested) | ⚠️ OK (cohesive) |
| T6 | registry (3 files, one seam) | ⚠️ OK (cohesive) |
| T7 | service + repo + route for availability | ⚠️ OK (route + its service) |
| T8 | route + service | ⚠️ OK (route + its service) |
| T9 | service + route | ⚠️ OK (route + its service) |
| T10 | two settings services + routes, same "settings edit" pattern | ⚠️ OK (cohesive) |
| T11 | exceptions service + import + lock + route | ⚠️ OK (cohesive) |
| T12 | service + route | ⚠️ OK (route + its service) |
| T13 | service + route | ⚠️ OK (route + its service) |
| T14 | ics lib + templates + mailer | ⚠️ OK (cohesive) |
| T15 | gateway types + resolver + sandbox adapter | ⚠️ OK (cohesive) |
| T16 | 1 adapter file | ✅ Granular |
| T17 | middleware + service + route | ⚠️ OK (route + its service) |
| T18 | effects + refunds + webhook route | ⚠️ OK (cohesive) |
| T19 | sandbox route + cards route/service | ⚠️ OK (cohesive) |
| T20 | service + route | ⚠️ OK (route + its service) |
| T21 | serializer + GET routes + PATCH me | ⚠️ OK (cohesive) |
| T22 | service + 2 routes | ⚠️ OK (route + its service) |
| T23 | service + 2 routes | ⚠️ OK (route + its service) |
| T24 | service + 2 routes | ⚠️ OK (route + its service) |
| T25 | 2 query services + 2 routes | ⚠️ OK (cohesive) |
| T26 | runner + 2 jobs + trigger config | ⚠️ OK (cohesive) |
| T27 | 2 job files | ⚠️ OK (cohesive) |
| T28 | 2 job files | ⚠️ OK (cohesive) |
| T29 | test infra + slots + hooks + analytics | ⚠️ OK (cohesive) |
| T30 | 4 small primitives | ⚠️ OK (cohesive) |
| T31 | table + 4 display components | ⚠️ OK (cohesive) |
| T32 | 2 calendar components | ⚠️ OK (cohesive) |
| T33 | 3 schedule views sharing layout | ⚠️ OK (cohesive) |
| T34 | page + 2 home sections | ⚠️ OK (cohesive) |
| T35 | 1 page | ✅ Granular |
| T36 | 4 mostly static pages | ⚠️ OK (cohesive) |
| T37 | page + 2 steps | ⚠️ OK (cohesive) |
| T38 | 1 step | ✅ Granular |
| T39 | 3 payment pages | ⚠️ OK (cohesive) |
| T40 | 3 pages over one list API | ⚠️ OK (cohesive) |
| T41 | page + 2 modals | ⚠️ OK (cohesive) |
| T42 | 2 pages + tokenizers | ⚠️ OK (cohesive) |
| T43 | page + 4 components | ⚠️ OK (cohesive) |
| T44 | table + form + overlay | ⚠️ OK (cohesive) |
| T45 | view + modals + block modal | ⚠️ OK (cohesive) |
| T46 | page + calendar + 2 popups | ⚠️ OK (cohesive) |
| T47 | drawer + picker | ⚠️ OK (cohesive) |
| T48 | 2 sub-tab pages | ⚠️ OK (cohesive) |
| T49 | e2e specs + config + seed | ⚠️ OK (cohesive) |
| T50 | operational step | ✅ Granular |

The task count was capped at 50 by the plan request; cohesive multi-file tasks are the trade-off. `validate_tasks.py` reads only the `Where` line (one primary file per task); companions are listed under `Also`.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (same-phase arrows) | Status |
| --- | --- | --- | --- |
| T1 | None | - | ✅ Match |
| T2 | None | - | ✅ Match |
| T3 | T2 | T2 | ✅ Match |
| T4 | T1 | T1 | ✅ Match |
| T5 | earlier phase: T1 | - | ✅ Match |
| T6 | T5 | T5 | ✅ Match |
| T7 | T6 | T6 | ✅ Match |
| T8 | T6 | T6 | ✅ Match |
| T9 | T7 | T7 | ✅ Match |
| T10 | earlier phase: T9 | - | ✅ Match |
| T11 | T10 | T10 | ✅ Match |
| T12 | earlier phase: T7 | - | ✅ Match |
| T13 | earlier phase: T6 | - | ✅ Match |
| T14 | earlier phase: T5 | - | ✅ Match |
| T15 | earlier phase: T5 | - | ✅ Match |
| T16 | T15 | T15 | ✅ Match |
| T17 | T15 | T15 | ✅ Match |
| T18 | T14, T17 | T14, T17 | ✅ Match |
| T19 | T18 | T18 | ✅ Match |
| T20 | earlier phases: T9, T11, T17 | - | ✅ Match |
| T21 | T20 | T20 | ✅ Match |
| T22 | T21 | T21 | ✅ Match |
| T23 | T21 | T21 | ✅ Match |
| T24 | T20 | T20 | ✅ Match |
| T25 | T21 | T21 | ✅ Match |
| T26 | earlier phase: T22, T24 | - | ✅ Match |
| T27 | T26 | T26 | ✅ Match |
| T28 | T26 | T26 | ✅ Match |
| T29 | earlier phase: T1 | - | ✅ Match |
| T30 | None | - | ✅ Match |
| T31 | None | - | ✅ Match |
| T32 | None | - | ✅ Match |
| T33 | T32 | T32 | ✅ Match |
| T34 | earlier phase: T29, T31 | - | ✅ Match |
| T35 | T34 | T34 | ✅ Match |
| T36 | earlier phase: T29 | - | ✅ Match |
| T37 | earlier phase: T35 | - | ✅ Match |
| T38 | T37 | T37 | ✅ Match |
| T39 | T38 | T38 | ✅ Match |
| T40 | earlier phase: T33 | - | ✅ Match |
| T41 | T40 | T40 | ✅ Match |
| T42 | earlier phase: T29 | - | ✅ Match |
| T43 | earlier phase: T30 | - | ✅ Match |
| T44 | earlier phase: T31 | - | ✅ Match |
| T45 | earlier phase: T33 | - | ✅ Match |
| T46 | earlier phase: T45 | - | ✅ Match |
| T47 | T46 | T46 | ✅ Match |
| T48 | earlier phase: T31 | - | ✅ Match |
| T49 | earlier phases: T28, T48 | - | ✅ Match |
| T50 | T49 | T49 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1–T4 | core domain / contracts | unit | unit | ✅ OK |
| T5 | API schema + migrations (merge-forward) | integration | integration | ✅ OK |
| T6 | API pure lib (registry) | unit | unit | ✅ OK |
| T7–T13 | API routes/services | integration | integration | ✅ OK |
| T14 | API pure lib (ics, templates) | unit | unit | ✅ OK |
| T15, T16 | API pure lib (gateway adapters, stubbed fetch) | unit | unit | ✅ OK |
| T17–T25 | API routes/services | integration | integration | ✅ OK |
| T26 | API jobs + deploy config | integration (+ unit for neon.ts) | integration | ✅ OK |
| T27, T28 | API jobs | integration | integration | ✅ OK |
| T29–T48 | web components/hooks/pages | unit | unit | ✅ OK |
| T49 | booking and admin flows | e2e | e2e | ✅ OK |
| T50 | production rollout | e2e smoke | e2e | ✅ OK |
