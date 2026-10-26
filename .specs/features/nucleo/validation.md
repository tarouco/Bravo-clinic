# Núcleo Validation

## Validation verdict: FAIL

**Date**: 2026-10-26 (iteration 1 of 3)
**Spec**: `.specs/features/nucleo/spec.md` (NUC-01..NUC-210)
**Diff range**: núcleo on `main` at `c54c858` — core `nucleo/core` (T1–T4), backend lane merges (`ab75ba7` and earlier phase merges, T5–T28), frontend lane merges (T29–T48, interleaved with receita/gestao web merges), integration fixes `8ae1fc7`, `ce1171d`, `faaafc1`, `345623a`, `b029188` merged by `8247807`, rollout `c54c858`. `main` also carries receita and gestao; only NUC ACs are judged here.
**Verifier**: independent sub-agent (author ≠ verifier), worktree branch `worktree-agent-a2ee4bb60722b0684`
**Test DB**: a fresh empty database `nucleo_verify` created for this run on the Neon verify branch (`DATABASE_URL_VERIFY`); every API test ran with `DATABASE_URL_TEST` overridden to it (checked: vite `loadEnv` returns the shell override, path `/nucleo_verify`). Not production, not the dev branch. Dropped at the end of the run.

Núcleo is functionally complete and every gate is green: typecheck, lint, 1191 core, 1191 web and 663 API tests (on `nucleo_verify`), the build and the production smoke. 204 of 210 ACs have exact `file:line` evidence. The verdict is FAIL because 4 of 20 sensor mutants survived. Each one marks an AC whose test does not pin the spec outcome:

- NUC-153: the customer notice of a clinic cancellation (A6).
- NUC-70: the `BOOKING_NOT_OPEN` message (A10).
- NUC-91: the consent IP (A11).
- NUC-113: the first webhook dedupe layer (A3). Money effects stay exactly-once.

Two ACs differ from the spec text because of documented later decisions. They need spec amendments, not code: NUC-01 gained `awaiting_payment → cancelled_by_clinic` (`8ae1fc7`), and gestao GES-134/135 superseded NUC-206.

All fixes are test assertions or docs. No production code change is needed.

---

## Iteration history

| Iteration | Verdict | Summary |
| --------- | ------- | ------- |
| 1 (2026-10-26, this report) | FAIL | Gates green (3045 tests). 204/210 ACs fully evidenced; 16/20 mutants killed. Gaps: NUC-153, NUC-70, NUC-91, NUC-113 (survivors A6, A10, A11, A3); spec amendments for NUC-01 and NUC-206 |

---

## Task Completion

50 tasks (T1–T50). Every Done-when box is checked except T4.

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T3, T5–T50 | ✅ Done | - |
| T4 | ⚠️ Boxes unchecked | `tasks.md:468-472`: the five Done-when boxes of T4 are `[ ]`, but the work exists and passes (`core/payments/split.test.ts`, `core/policy/cancellation.test.ts`, `core/policy/reschedule.test.ts`, `core/policy/policy-text.test.ts`). Bookkeeping only. `tasks.md` also repeats the T1–T3 blocks twice (`:183-260` and `:365-480`) |
| T49 | ✅ Done (not re-run) | `npm run e2e` was not run by the verifier (it resets `DATABASE_URL_TEST`); specs reviewed statically below |
| T50 | ✅ Done | `node scripts/smoke.mjs https://bravo-clinic.netlify.app` exit 0 (verifier run, GET only) |

---

## Spec-Anchored Acceptance Criteria

Paths: `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `core/` = `packages/core/src/`. Every cited test file was read at `c54c858`. Line numbers point to the `it(` (or `describe(`) whose assertions carry the spec value.

### P1 Booking vocabulary and contracts

| AC | Spec-defined outcome | Evidence | Result |
| -- | -------------------- | -------- | ------ |
| NUC-01 | exactly arch §3.1 + `expired→confirmed/paid`, `paid→confirmed` | `core/status/booking.test.ts:14-42` (literal allow-list), `:54-56` all 121 pairs, `:58`; sensor M8 killed | ⚠️ Deviation: the allow-list also has `awaiting_payment→cancelled_by_clinic` (`:41`, `core/status/booking.ts:52-55`, fix `8ae1fc7`). Recorded in `design.md:447` only; spec "exactly" (`spec.md:188`) and `docs/architecture.md:177` not amended, no `// SPEC_DEVIATION` |
| NUC-02 | 11 pt-BR labels | `core/status/booking.test.ts:67-85`; `web/components/booking/StatusBadge.test.tsx:23` | ✅ |
| NUC-03 | 7 payment status codes + labels | `core/status/booking.test.ts:87-138` | ✅ |
| NUC-04 | zod schema per body; API validates; tests parse responses | `core/contracts/{admin,app,common,public}.test.ts` (`admin.test.ts:154`, `public.test.ts:98`); 50 distinct `*Schema.parse(` in `api/**/*.int.test.ts` (e.g. `bookingDetailSchema` ×17, `availabilityDaySchema` ×12) | ✅ |
| NUC-05 | guarded update + one event; 0 rows → 409 `INVALID_TRANSITION` | `api/modules/booking/transition.int.test.ts:50`, `:80`, `:96`, `:148` | ✅ |
| NUC-06 | terminal → occupancy inactive, same tx | `transition.int.test.ts:123`; sensor A4 killed | ✅ |

### P1 Slot grid with cleanup

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-07 | null on clinic/room closed day, closed holiday, closed weekday | `core/calendar/day-type.test.ts:66`, `:71`, `:83`, `:88` | ✅ |
| NUC-08 | holiday row hours, `isHoliday` | `day-type.test.ts:39`, `:47`, `:55` | ✅ |
| NUC-09 | Sat/Sun/holiday `weekend_holiday` | `day-type.test.ts:21-33` | ✅ |
| NUC-10 | CL-1..CL-8, CL-10 exact | `core/slots/grid.test.ts:70-116` (`toEqual(rejected('in_cleanup'))` etc.); sensors M4, M5 killed | ✅ |
| NUC-11 | misaligned / too_short / outside_hours / closed | `grid.test.ts:169-185` (midnight crossing `:175`) | ✅ |
| NUC-12 | in_past / too_far (SP dates) | `grid.test.ts:187-199` | ✅ |
| NUC-13 | predicate = exclusion constraint | `grid.test.ts:230-277` (200 generated rows); DB side `api/db/migrations.int.test.ts` (FND-32) | ✅ |
| NUC-14 | CL-9 leftover cells, 14:30 available | `grid.test.ts:120-131`; `api/modules/availability/availability.int.test.ts:78`, `:307` | ✅ |
| NUC-15 | CL-4 11:30 `maxEndMinute: 810` | `grid.test.ts:133-142` | ✅ |
| NUC-16 | CC-1..CC-4 | `grid.test.ts:290-310` | ✅ |
| NUC-17 | 10 pt-BR messages | `grid.test.ts:212-228` | ✅ |

### P1 Pricing engine

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-18 | largest min duration ≤ booking, tie lowest order | `core/pricing/price.test.ts:192`, `:201`, `:215`; sensor M7 killed | ✅ |
| NUC-19 | PR-1..PR-7 segments + gross | `price.test.ts:94-154` (`toEqual` on segments and `grossCents`) | ✅ |
| NUC-20 | PR-8 `no_category` + first uncovered | `price.test.ts:156`, `:164` | ✅ |
| NUC-21 | 9701 × 90 min = 14552 | `price.test.ts:179-186`; sensor M6 killed | ✅ |
| NUC-22 | AV-1..AV-4 = 8000/11200/5600/9700 | `price.test.ts:266-308` | ✅ |
| NUC-23 | block fixed price/window or null | `price.test.ts:243`, `:251`, `:255` | ✅ |
| NUC-24 | bands; no gap at 60 min; 19:00–00:00 uncovered without noite | `price.test.ts:316`, `:343-353`, `:356-360` | ✅ |

### P1 Payment split and booking policies

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-25 | SP-1..SP-6 + instants | `core/payments/split.test.ts:25-92`; sensors M1, M2 killed | ✅ |
| NUC-26 | CA-1..CA-10 | `core/policy/cancellation.test.ts:61-114` (`it.each`), CA-9 options `:116`; sensor M3 killed | ✅ |
| NUC-27 | RS-1..RS-5 | `core/policy/reschedule.test.ts:32-60` | ✅ |
| NUC-28 | ST-1..ST-5 | `reschedule.test.ts:62-131`; sensor M9 killed | ✅ |
| NUC-29 | 4 sections, 5 phrases | `core/policy/policy-text.test.ts:35`, `:44-52` | ✅ |
| NUC-30 | "O sinal é reembolsável" | `policy-text.test.ts:54-58` | ✅ |
| NUC-31 | snapshot key set | `policy-text.test.ts:11-31` | ✅ |

### P1 Business hours and calendar parameters

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-32 | 200 config; reception 403 | `api/routes/admin/calendar-config.int.test.ts:65`, `:90` | ✅ |
| NUC-33 | save + audit; 422 row path | `calendar-config.int.test.ts:115`, `:139`; `core/contracts/admin.test.ts:525` | ✅ |
| NUC-34 | 409 `AFFECTED_BOOKINGS`, nothing saved | `calendar-config.int.test.ts:163` | ✅ |
| NUC-35 | 422 field path | `calendar-config.int.test.ts:201`; `admin.test.ts:520` | ✅ |
| NUC-36 | warning, lost 15 | `calendar-config.int.test.ts:214-219` | ✅ |
| NUC-37 | 409 `CLEANUP_CONFLICTS`, no change | `calendar-config.int.test.ts:232` | ✅ |
| NUC-38 | future bookings updated, past/overridden kept, audit | `calendar-config.int.test.ts:246` | ✅ |
| NUC-39 | cleanup exception; 422; 403 | `api/routes/admin/bookings.int.test.ts:386`, `:412`, `:432` | ✅ |
| NUC-40 | week grid + Feriados + shortcuts | `web/features/admin-calendar/WeekHoursEditor.test.tsx:41`, `:52`, `:75`; `web/pages/admin/calendar/CalendarConfigPage.test.tsx:39` | ✅ |
| NUC-41 | exact warning sentence; conflict modals | `CalendarConfigPage.test.tsx:86-104`, `:67`, `:109` | ✅ |

### P2 Drag-edit business hours

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-42 | snap; Arrow keys one slot | `WeekHoursEditor.test.tsx:106`, `:121` | ✅ |

### P1 Holidays and closed days

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-43 | ordered, alert only today..+30 | `api/routes/admin/calendar-exceptions.int.test.ts:105`, `:132` | ✅ |
| NUC-44 | 409 with bookings; else audit | `calendar-exceptions.int.test.ts:147`, `:164` | ✅ |
| NUC-45 | manual create, 409 `CONFLICT`, delete; seed 422 | `calendar-exceptions.int.test.ts:182`, `:204` | ✅ |
| NUC-46 | import inserts/renames, keeps `isClosed`; 422 other year | `calendar-exceptions.int.test.ts:229`, `:254`, `:269` | ✅ |
| NUC-47 | 502 `EXTERNAL_UNAVAILABLE` + message, no row | `calendar-exceptions.int.test.ts:284-311` (timeout, non-2xx, bad body) | ✅ |
| NUC-48 | preview excludes fixed occurrences, port numbers | `calendar-exceptions.int.test.ts:315`, `:329` | ✅ |
| NUC-49 | 201, one row or per room, port apply, audit; 409; 422 past | `calendar-exceptions.int.test.ts:357`, `:378`, `:392`, `:409` | ✅ |
| NUC-50 | delete, audit, bookable again | `calendar-exceptions.int.test.ts:427`, `:444` | ✅ |
| NUC-51 | advisory lock serializes closing vs booking | `api/routes/app/bookings.int.test.ts:339` | ✅ |
| NUC-52 | exceptions month view + closed-day modal | `web/features/admin-calendar/ExceptionsMonth.test.tsx:25-107`; `ClosedDayModal.test.tsx:32`, `:62`, `:80` | ✅ |

### P2 Holiday review banner

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-53 | banner from 1 Oct | `web/features/admin-calendar/HolidayReviewBanner.test.tsx:30`, `:39`, `:46`, `:61` | ✅ |

### P1 Manual blocks

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-54 | block + occupancy per room, audit, 201 | `api/routes/admin/blocks.int.test.ts:80` | ✅ |
| NUC-55 | 409 `SLOT_TAKEN` naming code, no block | `blocks.int.test.ts:111` | ✅ |
| NUC-56 | recurrence to horizon; 409 dates; skip | `blocks.int.test.ts:178`, `:205`, `:216`; reception 403 `:160` | ✅ |
| NUC-57 | rerun creates only missing, counts skips | `blocks.int.test.ts:228`, `:243`; `api/jobs/expire-holds.int.test.ts:233` | ✅ |
| NUC-58 | cancel block / rule; past kept | `blocks.int.test.ts:127`, `:252` | ✅ |
| NUC-59 | occupancy exactly `[start, end)` | `blocks.int.test.ts:80`; `core/slots/grid.test.ts:206-209` | ✅ |
| NUC-60 | Bloquear modal presets, rooms, weekly (admin only) | `web/features/admin-blocks/BlockModal.test.tsx:36`, `:60`, `:86`, `:94` | ✅ |

### P1 Booking categories and price table

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-61 | list 4 types, average, editable | `api/routes/admin/categories.int.test.ts:83`, `:99` | ✅ |
| NUC-62 | hourly create + audit; 422 paths | `categories.int.test.ts:119`, `:137` | ✅ |
| NUC-63 | block with period `single` | `categories.int.test.ts:151` | ✅ |
| NUC-64 | 422 `type` "Tipo de categoria gerenciado em Pacotes" | `categories.int.test.ts:162-171` | ✅ |
| NUC-65 | version + audit; frozen segment 9700 | `categories.int.test.ts:227`, `:257` | ✅ |
| NUC-66 | single reference, audit; 422 non-hourly | `categories.int.test.ts:286`, `:301` | ✅ |
| NUC-67 | exact 422 message | `categories.int.test.ts:270-280` | ✅ |
| NUC-68 | reorder 1..n; 422 | `categories.int.test.ts:312`, `:322` | ✅ |
| NUC-69 | prices_reviewed + audit | `categories.int.test.ts:335` | ✅ |
| NUC-70 | tenant 409 `BOOKING_NOT_OPEN` "As reservas online abrem em breve."; staff succeeds | `api/routes/app/bookings.int.test.ts:90-99` (code only); staff path: `api/routes/admin/bookings.int.test.ts:56` runs with the factory `onboarding.prices_reviewed = false` (`core/settings/catalog.ts:84`) | ⚠️ Partial: the spec message is never asserted (only at `api/modules/booking/create-booking.service.ts:246`); sensor A10 survived |
| NUC-71 | live average, V_ref, toggles, Nova categoria | `web/features/admin-calendar/CategoriesTable.test.tsx:77-92`, `:124`, `:170`, `:196` | ✅ |
| NUC-72 | colored bands + "Horário sem categoria" | `CategoryBandOverlay.test.tsx:58`, `:71`; `CalendarConfigPage.test.tsx:133` | ✅ |
| NUC-73 | checklist + button | `CalendarConfigPage.test.tsx:161`, `:168` | ✅ |

### P1 Public availability and catalog

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-74 | rooms by order, `fromPriceCents` 8000, cover null | `api/routes/public/catalog.int.test.ts:42`; `core/pricing/price.test.ts:376` | ✅ |
| NUC-75 | detail with photos; 404 | `catalog.int.test.ts:55`, `:67` | ✅ |
| NUC-76 | public catalog excludes inactive/admin_only | `catalog.int.test.ts:107`, `:128` | ✅ |
| NUC-77 | public cells only | `api/modules/availability/availability.int.test.ts:78`, `:95`; `core/contracts/public.test.ts:232`; `web/test/fixtures/nucleo.test.ts:20` | ✅ |
| NUC-78 | holiday flags; closed day no cells | `availability.int.test.ts:113`, `:121` | ✅ |
| NUC-79 | month statuses | `availability.int.test.ts:212`, `:235` | ✅ |
| NUC-80 | stale holds free | `availability.int.test.ts:135`; sensor A2 killed | ✅ |
| NUC-81 | 429 + `Retry-After` at 121/min | `availability.int.test.ts:250-269`; `api/modules/booking/quote.int.test.ts:295-316` | ✅ |
| NUC-82 | 422 malformed date/month | `availability.int.test.ts:182`, `:242` | ✅ |
| NUC-83 | `blockOptions[]` availability | `availability.int.test.ts:152` | ✅ |
| NUC-84 | clinic contact + 8 rows | `catalog.int.test.ts:163` | ✅ |
| NUC-85 | policies version + sections | `catalog.int.test.ts:185` | ✅ |

### P1 Book and pay the sinal

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-86 | quote PR-3 + SP-1, no rows | `api/modules/booking/quote.int.test.ts:54`, `:97` | ✅ |
| NUC-87 | 422 `SLOT_UNAVAILABLE` + text; `NO_CATEGORY` | `quote.int.test.ts:127`, `:146` | ✅ |
| NUC-88 | block interval mismatch → path `startMinute` | `quote.int.test.ts:158` | ✅ |
| NUC-89 | 403 `EMAIL_NOT_VERIFIED` | `api/routes/app/bookings.int.test.ts:70` | ✅ |
| NUC-90 | 422 `PROFILE_INCOMPLETE` + message | `bookings.int.test.ts:80-88` | ✅ |
| NUC-91 | 422 no acceptance; 409 `POLICY_CHANGED`; consent `policy-v1`, IP, ref | `bookings.int.test.ts:101`, `:111`, `:192-198` | ⚠️ Partial: consent kind/version/ref asserted, the IP is not (code at `api/modules/booking/create-booking.service.ts:363`); sensor A11 survived |
| NUC-92 | 409 `PRICE_CHANGED` + fresh quote | `bookings.int.test.ts:122-133` | ✅ |
| NUC-93 | 201 awaiting, hold +15 min, occupancy +cleanup, snapshot, `BRV-`, `ics_uid` | `bookings.int.test.ts:150-203`; `ics_uid` unique in `api/db/schema/booking.ts:135`; sensor A9 killed | ✅ |
| NUC-94 | 409 `SLOT_TAKEN` message; 1 of 10 concurrent wins | `bookings.int.test.ts:205-219`, `:275-294` | ✅ |
| NUC-95 | 400 no key; replay; 422 mismatch | `api/routes/app/payments.int.test.ts:111`, `:123`, `:140`, `:154`, `:171` | ✅ |
| NUC-96 | 429 4th hold + message | `bookings.int.test.ts:221-237` | ✅ |
| NUC-207 | pay-now 0 → confirmed, mail | `bookings.int.test.ts:298` | ✅ |
| NUC-97 | stale holds expired in same tx | `bookings.int.test.ts:239-273` | ✅ |
| NUC-98 | four steps, URL selection, both routes | `web/features/booking/BookingFlowPage.test.tsx:41`, `:56`, `:89`, `:140` | ✅ |
| NUC-99 | startable cells, durations to `maxEndMinute`, blocks | `web/components/calendar/SlotGrid.test.tsx:34`, `:54`, `:79` | ✅ |
| NUC-100 | memory line, sinal/saldo dates, unchecked acceptance | `web/features/booking/SummaryStep.test.tsx:67`; `web/components/booking/BookingSummary.test.tsx:12`, `:21` | ✅ |
| NUC-101 | login/signup with `next`, selection intact | `SummaryStep.test.tsx:86`; `web/pages/auth/next-links.test.tsx:13`, `:38` | ✅ |
| NUC-102 | countdown + "Tempo esgotado…" | `web/pages/public/CheckoutPage.test.tsx:55` | ✅ |
| NUC-103 | poll 2 s, "Reserva confirmada" | `CheckoutPage.test.tsx:72`; e2e `apps/web/e2e/booking.spec.ts:145-148` | ✅ |
| NUC-104 | steps ascending order, persist in tx | `quote.int.test.ts:190`, `:225`; `bookings.int.test.ts:298`; `api/extensions/registry.test.ts:99` | ✅ |

### P1 Gateway-independent payments

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-105 | 9 interface methods, 2 adapters | `api/payments/gateway.ts:75-108`; `api/payments/adapters/sandbox.test.ts:38-166`; `mercadopago.test.ts:420-571` | ✅ |
| NUC-106 | active gateway for new, stored provider for old | `api/payments/resolver.int.test.ts:38`, `:46` | ✅ |
| NUC-107 | deposit/full charge for payNow, Pix expiry = hold | `payments.int.test.ts:187`, `:219` | ✅ |
| NUC-108 | 409 `HOLD_EXPIRED`; 409 `INVALID_TRANSITION`; 404 | `payments.int.test.ts:258`, `:277`, `:246` | ✅ |
| NUC-109 | reuse same method, replace other | `payments.int.test.ts:287` | ✅ |
| NUC-110 | 422 `POLICY_ACCEPTANCE_REQUIRED`, consent recorded | `payments.int.test.ts:354`, `:367`, `:385`, `:400` | ✅ |
| NUC-111 | 502 `GATEWAY_ERROR` + message, charge pending; 10 s | `payments.int.test.ts:432-454`; `mercadopago.test.ts:215`, `:231` | ✅ |
| NUC-112 | 401 invalid signature, no row; 404 provider | `api/routes/webhooks/pagamentos.int.test.ts:162`, `:176`, `:190` | ✅ |
| NUC-113 | duplicate → 200 without reprocessing | `pagamentos.int.test.ts:202`, `:217` (one event row, one booking event, one e-mail) | ⚠️ Partial: effects are exactly-once, but sensor A3 survived, so the "without reprocessing" claim layer is not pinned (see Fix 4) |
| NUC-114 | MP re-fetches, ignores payload | `mercadopago.test.ts:314` | ✅ |
| NUC-115 | confirmed/paid, paid_cents, onConfirmed, notifyStaff after commit | `pagamentos.int.test.ts:246`, `:295`, `:310`, `:330` | ✅ |
| NUC-116 | amount mismatch: unchanged, audit, staff | `pagamentos.int.test.ts:385` | ✅ |
| NUC-117 | late approval reinstates or refunds + 3 slots | `pagamentos.int.test.ts:404`, `:431`; `api/modules/availability/suggest-free-slots.int.test.ts:35-82` | ✅ |
| NUC-118 | rejected, hold kept, page message | `pagamentos.int.test.ts:352`; `CheckoutPage.test.tsx:105` | ✅ |
| NUC-119 | pending refund, gateway after commit, attempts/last_error | `api/modules/payments/refunds.int.test.ts:107`, `:145`, `:197`, `:210`, `:226` | ✅ |
| NUC-120 | sandbox page emits signed webhook | `api/routes/public/sandbox.int.test.ts:124`, `:156`; `sandbox.test.ts:66-113`; `web/pages/public/SandboxCheckoutPage.test.tsx:33` | ✅ |
| NUC-121 | production: MFA staff only | `sandbox.int.test.ts:195`, `:206`, `:225` | ✅ |
| NUC-122 | MP Pix request shape | `mercadopago.test.ts:84`, `:116` | ✅ |
| NUC-123 | MP Checkout Pro preference | `mercadopago.test.ts:139`, `:181` | ✅ |
| NUC-124 | MP `x-signature` HMAC manifest | `mercadopago.test.ts:314-418` | ✅ |
| NUC-125 | 503 `GATEWAY_NOT_CONFIGURED` | `resolver.int.test.ts:56`, `:60`; `payments.int.test.ts:419` | ✅ |
| NUC-126 | save card + consent; 422 | `api/routes/app/cards.int.test.ts:36`, `:75` | ✅ |
| NUC-127 | delete card, never charged | `cards.int.test.ts:158`, `:175`, `:189` | ✅ |
| NUC-128 | no PAN/CVV accepted or logged | `cards.int.test.ts:90`; `sandbox.test.ts:182`, `:192`, `:208`; `web/pages/app/CardsPage.test.tsx:44` | ✅ |
| NUC-129 | payment-config, sandbox key null | `sandbox.int.test.ts:247`, `:258` | ✅ |
| NUC-208 | `listGatewayAdapters`, `verifyCredentials` | `sandbox.test.ts:128`, `:168`; `mercadopago.test.ts:574`, `:590`; `resolver.int.test.ts:98` | ✅ |

### P1 Balance charge, reminders and deadline

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-130 | saved card else Pix at `balance_due_at` + mail | `api/jobs/charge-balances.int.test.ts:83`, `:102`, `:145` | ✅ |
| NUC-131 | declined card → Pix + `balance_card_failed` | `charge-balances.int.test.ts:125` | ✅ |
| NUC-132 | deadline → `cancelled_nonpayment`, sinal kept | `charge-balances.int.test.ts:162`, `:197` | ✅ |
| NUC-133 | reminders 48/36/26 dedupe keys | `api/jobs/reminders.int.test.ts:61-88`, `:91` | ✅ |
| NUC-134 | pay-balance charge | `payments.int.test.ts:472`, `:512`, `:533` | ✅ |
| NUC-135 | purpose `booking_difference` after approved balance | `payments.int.test.ts:489` | ✅ |

### P1 Confirmation e-mails with .ics

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-136 | `booking.confirmed` subject, REQUEST .ics, UID/SEQUENCE/DTSTART/SUMMARY/LOCATION | `api/modules/booking/booking-mailer.int.test.ts:52`, `:75`; `booking-mailer.test.ts:14`, `:24`; `api/lib/ics.test.ts:75`; `api/emails/templates/booking.test.ts:109`; e2e `booking.spec.ts:150-157` | ✅ |
| NUC-137 | reschedule/cancel bump SEQUENCE, CANCEL same UID | `ics.test.ts:96`; `booking-mailer.int.test.ts:85`; `api/routes/app/reschedule.int.test.ts:320`; `api/routes/app/cancel.int.test.ts:146` | ✅ |
| NUC-138 | 24 h / 2 h reminders once | `reminders.int.test.ts:111`, `:128`; `booking-mailer.int.test.ts:99` | ✅ |
| NUC-139 | CRLF, 75-octet folding, escaping | `ics.test.ts:21-70` | ✅ |
| NUC-140 | `GET …/ics` text/calendar | `api/routes/app/bookings-reads.int.test.ts:226`, `:244` | ✅ |

### P1 Reschedule and cancel

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-141 | `actions` block | `bookings-reads.int.test.ts:173`, `:196` | ✅ |
| NUC-142 | reschedule quote (allowed, reason, settlement) | `reschedule.int.test.ts:116`, `:143`, `:160`, `:178`, `:207`, `:220`; `web/pages/app/BookingDetailPage.test.tsx:162`; sensor A1 killed | ✅ |
| NUC-143 | 422 `POLICY_VIOLATION` reasons / `SLOT_UNAVAILABLE` | `reschedule.int.test.ts:243`, `:259`, `:270`, `:178` | ✅ |
| NUC-144 | cheaper/equal moves at once | `reschedule.int.test.ts:320`, `:360`, `:376`, `:386` | ✅ |
| NUC-145 | deferred `creditGrant` | `reschedule.int.test.ts:320` | ✅ |
| NUC-146 | dearer: hold block, request, difference charge, 202 | `reschedule.int.test.ts:429`, `:476`, `:567`, `:586` | ✅ |
| NUC-147 | expiry releases hold; late approval refunds | `reschedule.int.test.ts:510`, `:549`, `:627`; `expire-holds.int.test.ts:183` | ✅ |
| NUC-148 | package/subscription → handler or 422 `unsupported_payment_mode` | `reschedule.int.test.ts:284`; `cancel.int.test.ts:308` | ✅ |
| NUC-149 | admin exception, `add_to_balance` / `waive` | `api/routes/admin/booking-reschedule.int.test.ts:60`, `:94`, `:119`, `:146`, `:158` | ✅ |
| NUC-150 | cancellation preview = W-CA, snapshot | `cancel.int.test.ts:85`, `:106`, `:130` | ✅ |
| NUC-151 | tenant cancel: refunds newest first, release, mail, staff | `cancel.int.test.ts:146`, `:211`, `:239` | ✅ |
| NUC-152 | cancel awaiting: no refund, pending charges cancelled | `cancel.int.test.ts:258`, `:283` | ✅ |
| NUC-153 | clinic cancel: refund all / credit (live only, else 422), audit, customer notified | `api/routes/admin/booking-cancel.int.test.ts:90`, `:119`, `:153`, `:167`, `:197` (awaiting_payment, fix `8ae1fc7`), `:245` | ⚠️ Partial: no test asserts the customer e-mail of a clinic cancellation (no `emailOutbox` read in the file); sensor A6 survived |
| NUC-154 | hide Reagendar, WhatsApp link | `BookingDetailPage.test.tsx:74-86` | ✅ |
| NUC-155 | credit / difference sentence | `BookingDetailPage.test.tsx:91-111`, `:114-145` | ✅ |
| NUC-156 | "Fica retido" / "Será devolvido" | `BookingDetailPage.test.tsx:218-234` | ✅ |

### P1 Gestão de Reservas operations

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-157 | events feed ≤ 42 days; 422 at 43 | `api/routes/admin/booking-queries.int.test.ts:55`, `:113`, `:120` | ✅ |
| NUC-158 | week/month view, filters, shading | `web/pages/admin/reservations/ReservationsPage.test.tsx:65`, `:77`, `:103` | ✅ |
| NUC-159 | hover popup + role actions | `ReservationsPage.test.tsx:116`, `:129`, `:141`, `:154`, `:172` | ✅ |
| NUC-160 | free-slot menu + slot actions | `ReservationsPage.test.tsx:203`, `:237` | ✅ |
| NUC-161 | staff awaiting booking, link token, mail | `api/routes/admin/bookings.int.test.ts:56` | ✅ |
| NUC-162 | pre-reservation hold 24 h default / 48 h; `/pre-reserva/<token>` | `bookings.int.test.ts:87`, `:278-312` | ✅ |
| NUC-163 | manual confirmation; reception 403 | `bookings.int.test.ts:120`, `:136`, `:197`, `:244`; `web/features/admin-bookings/CreateBookingDrawer.test.tsx:166`, `:172` | ✅ |
| NUC-164 | resend rotates token | `bookings.int.test.ts:295` | ✅ |
| NUC-165 | token resolves; 404 unknown/expired | `bookings.int.test.ts:277`, `:317` | ✅ |
| NUC-166 | pre-reservation expiry mail + staff | `expire-holds.int.test.ts:147` | ✅ |
| NUC-167 | check-in window + message | `bookings.int.test.ts:342-352`, `:366` | ✅ |
| NUC-168 | no-show / completed | `api/jobs/no-shows.int.test.ts:59`, `:79`, `:87` | ✅ |
| NUC-169 | customer search ≥2 chars; create; duplicates | `api/routes/admin/customers.int.test.ts:46`, `:53`, `:87`, `:115`, `:137` | ✅ |
| NUC-170 | create drawer | `CreateBookingDrawer.test.tsx:42`, `:73`, `:102`, `:129`, `:138` | ✅ |
| NUC-171 | `/pre-reserva/:token` page | `web/pages/public/PreReservationPage.test.tsx:35`, `:49`, `:61`, `:69` | ✅ |

### P1 Policies panel

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-172 | every key, no `policy.version`; reception 403 | `calendar-config.int.test.ts:65`, `:281` | ✅ |
| NUC-173 | 422 cross-field paths | `calendar-config.int.test.ts:290`, `:306`; `core/contracts/admin.test.ts:503` | ✅ |
| NUC-174 | version +1 on change only | `calendar-config.int.test.ts:315` | ✅ |
| NUC-175 | rules from snapshot | `cancel.int.test.ts:106`; `bookings-reads.int.test.ts:212` | ✅ |
| NUC-176 | six groups, version, live preview | `web/pages/admin/reservations/PoliciesPanel.test.tsx:27`, `:37`, `:48` | ✅ |

### P1 Bookings list and CSV

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-177 | 50-row pages, `q` case-insensitive | `booking-queries.int.test.ts:185`, `:224` | ✅ |
| NUC-178 | BOM, header, SP dates, `1600,00`; 422 > 5 000 | `booking-queries.int.test.ts:308-326`, `:354-383` | ✅ |
| NUC-179 | URL filters, Carregar mais, Exportar CSV | `web/pages/admin/reservations/BookingsListPage.test.tsx:55`, `:79`, `:96`, `:107`, `:142` | ✅ |

### P1 Public site pages

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-180 | RoomCards, placeholder, "A partir de R$ 80,00/h" | `web/pages/public/rooms/RoomsPage.test.tsx:27`, `:43` | ✅ |
| NUC-181 | Home uses catalog API + `priceHourlyBooking` | `web/pages/public/home/PricingSimulatorSection.test.tsx:137`; `RoomsSection.test.tsx:88` | ✅ |
| NUC-182 | room page, calendar holiday marker, link, 404 | `web/pages/public/rooms/RoomPage.test.tsx:29`, `:60`, `:85`, `:97`, `:106` | ✅ |
| NUC-183 | Preços + `pricing.packages` slot | `web/pages/public/PublicPages.test.tsx:30`, `:42`, `:55` | ✅ |
| NUC-184 | Políticas sections | `PublicPages.test.tsx:68` | ✅ |
| NUC-185 | Contato + exact Maps URL | `PublicPages.test.tsx:80-89`, `:97`, `:120` | ✅ |
| NUC-186 | "Versão terms-2026-10" / "privacy-2026-10" | `PublicPages.test.tsx:132-146` | ✅ |
| NUC-187 | banner + disabled button while not reviewed | `SummaryStep.test.tsx:227-238` | ✅ |

### P1 Minhas reservas, agenda and profile

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-188 | tabs, order, `paymentStatus`, `group` | `bookings-reads.int.test.ts:57`, `:114`, `:149` | ✅ |
| NUC-189 | tabs, rows, group header | `web/pages/app/MyBookingsPage.test.tsx:30`, `:49`, `:60` | ✅ |
| NUC-190 | month/week/day, no cleanup | `web/pages/app/AgendaPage.test.tsx:34`, `:59`, `:71`; `web/components/calendar/Schedule.test.tsx:64` | ✅ |
| NUC-191 | next 3 + Reservar | `web/pages/app/AppHomePage.test.tsx:23` | ✅ |
| NUC-192 | PATCH me; document rules | `api/routes/app/me-profile.int.test.ts:24-82` | ✅ |
| NUC-193 | `completar=1` highlight, back to `next` | `web/pages/app/ProfilePage.test.tsx:40`, `:50`, `:59` | ✅ |
| NUC-194 | cards list/remove/add with consent text | `CardsPage.test.tsx:27`, `:33`, `:70` (consent label `CONSENT_TEXT` = spec text at `web/pages/app/CardsPage.tsx:19`) | ✅ |

### P1 Scheduled jobs

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-195 | 401 unverified; `job_runs` ok/error | `api/routes/jobs.int.test.ts:52`, `:59`, `:86`, `:99` | ✅ |
| NUC-196 | second run `{ skipped: true }` | `jobs.int.test.ts:120` | ✅ |
| NUC-197 | expire-holds singles only, release, charges, steps | `expire-holds.int.test.ts:80`, `:120`, `:169`; sensor A7 killed | ✅ |
| NUC-198 | reconcile 2 min / 10 min / 5 refund attempts | `api/jobs/reconcile-payments.int.test.ts:77`, `:107`, `:139`, `:159`, `:193`, `:232` | ✅ |
| NUC-199 | 6 triggers by value | `api/neon.test.ts:40`; production `job_runs` per T50 (`tasks.md:1802`) | ✅ |
| NUC-200 | purge idempotency keys / job_runs > 30 d | `expire-holds.int.test.ts:215`, `:233` | ✅ |

### P1 Extension points

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-201 | registry defaults | `api/extensions/registry.test.ts:20`, `:29`, `:35`, `:53`, `:72` | ✅ |
| NUC-202 | decorator `discountPercent`, "−<n>%" | `availability.int.test.ts:190`; `SlotGrid.test.tsx:69` | ✅ |
| NUC-203 | 11 web slots, empty by default | `web/extensions/slots.test.tsx:10`, `:27`, `:33` | ✅ |
| NUC-204 | `importNationalHolidays(db, year, deps)` exported, used by route | `api/modules/calendar/holiday-import.ts:50`; `api/routes/admin/calendar-exceptions.ts:55`; direct call `calendar-exceptions.int.test.ts:257` | ✅ |
| NUC-205 | notifyStaff after commit, errors logged | `registry.test.ts:116`, `:144`; `pagamentos.int.test.ts:365`; `bookings.int.test.ts:298` | ✅ |
| NUC-209 | charge handlers; booking-less charges | `payments.int.test.ts:550`, `:589`; `pagamentos.int.test.ts:496`, `:512`, `:524` | ✅ |
| NUC-210 | `release` gets the cancellation result | `cancel.int.test.ts:211` | ✅ |

### P2 Booking funnel analytics

| AC | Outcome | Evidence | Result |
| -- | ------- | -------- | ------ |
| NUC-206 | `VITE_GA4_ID` alone loads GA4; `purchase` with booking code | `web/lib/analytics.test.tsx:48`, `:69`; `CheckoutPage.test.tsx:88` | ⚠️ Superseded by gestao GES-134/GES-135 (`.specs/features/gestao/spec.md:437`): GA4 needs `VITE_ANALYTICS_PROVIDER`, and `purchase` carries no booking code by design. Test `analytics.test.tsx:69` says so. The núcleo spec line `spec.md:693` was not amended |

**Status**: ❌ Gaps present. 204/210 ✅. Partial: NUC-70, NUC-91, NUC-113, NUC-153. Spec text to amend: NUC-01, NUC-206.

---

## Success criteria (spec.md:953-959)

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| Every W-* row is a unit test with exact values | W-CL `core/slots/grid.test.ts:70-131`, W-CC `:290-310`, W-PR `core/pricing/price.test.ts:94-162`, W-SP `core/payments/split.test.ts:25-92`, W-CA `core/policy/cancellation.test.ts:61-121`, W-RS/W-ST `core/policy/reschedule.test.ts:32-131`, W-AV `price.test.ts:266-308`; all green (core gate) | ✅ |
| Playwright smoke: signup → verify → book Tue 17:30–20:00 → sandbox approve → "Reserva confirmada" + `booking.confirmed` with `.ics`; admin pre-reservation → manual confirm → check-in | Static review: `apps/web/e2e/booking.spec.ts:52-158` (asserts R$ 219,00 / R$ 109,50 at `:88-89`, "Reserva confirmada" `:145`, outbox `.ics` `:150-157`); `apps/web/e2e/admin.spec.ts:31-91` (pre_reserved `:77`, check-in `:88`, `confirmed_manually_by` `:90`); 180 s test timeout `apps/web/playwright.config.ts:12`; desktop and 375 px projects `:26-32`. Seed `apps/api/test/e2e-seed.ts`. Not re-run by the verifier (it resets `DATABASE_URL_TEST`); integration author reported 8/8 | ✅ (static) |
| 10 parallel bookings → exactly one 201 | `api/routes/app/bookings.int.test.ts:205-219` (`toEqual([201, 409 ×9])`), green on `nucleo_verify` | ✅ |
| Availability p95 ≤ 300 ms, 500 bookings, warm DB | `apps/web/e2e/booking.spec.ts:214-242` (`expect(p95).toBeLessThanOrEqual(300)`), 500 rows from `e2e-seed.ts:47`, `:323-345`. Not re-run by the verifier | ✅ (static) |
| Every NUC verified with file:line | Table above | ❌ 204/210 |

---

## Discrimination Sensor

Run in a scratch worktree (`git worktree add --detach node_modules/.cache/sensor HEAD`, `node_modules` junctioned to the real install), never in the real tree. Each mutation was applied with `perl`, the named test files run with vitest (API files on `nucleo_verify`), then the file restored byte for byte from a copy and compared with `cmp` against the real tree. `git status --porcelain` of the real worktree was empty before and after. Sensor depth: P0 (money, concurrency, state machine).

| # | File:line | Mutation | Tests run | Result |
| - | --------- | -------- | --------- | ------ |
| M1 | `core/payments/split.ts:36` | full-upfront threshold `<` → `<=` | `split.test.ts` | ✅ Killed (1 failed: SP-4) |
| M2 | `core/payments/split.ts:37` | deposit `percentOfCents` (half up) → `Math.floor` | `split.test.ts` | ✅ Killed (1 failed: SP-2) |
| M3 | `core/policy/cancellation.ts:66` | refund threshold `<` → `<=` | `cancellation.test.ts` | ✅ Killed (1 failed: CA-4) |
| M4 | `core/slots/grid.ts:95` | cleanup after an occupant ignored (`s < o.until` → `s < o.end`) | `grid.test.ts` | ✅ Killed (4 failed) |
| M5 | `core/slots/grid.ts:96` | own cleanup before next ignored (`e + cleanupMs` → `e`) | `grid.test.ts` | ✅ Killed (69 failed) |
| M6 | `core/pricing/price.ts:107` | segment amount half up → `Math.floor` | `price.test.ts` | ✅ Killed (1 failed: 14552) |
| M7 | `core/pricing/categories.ts:78` | category min duration `>` → `>=` | `price.test.ts` | ✅ Killed (14 failed) |
| M8 | `core/status/booking.ts:55` | remove `awaiting_payment → cancelled_by_clinic` | `booking.test.ts` | ✅ Killed (1 failed) |
| M9 | `core/policy/reschedule.ts:66` | credit `paid − newNet` → `oldNet − newNet` | `reschedule.test.ts` | ✅ Killed (2 failed: ST-2, ST-5) |
| A1 | `api/modules/calendar/calendar.repo.ts:108-111` | reschedule own-slot exclusion dropped (`excludeBookingId` ignored) | `reschedule.int.test.ts` | ✅ Killed (8 failed, e.g. `:207` own slot `available: true`) |
| A2 | `api/modules/calendar/calendar.repo.ts:159` | stale holds no longer free (`hold_expires_at <= now` → `<= 2000-01-01`) | `availability.int.test.ts` | ✅ Killed (1 failed: `:135`, NUC-80) |
| A3 | `api/modules/payments/webhooks.service.ts:86-87` | webhook dedupe claim always re-claims a processed event (removed `isNull(processed_at)` and the stale/error filter) | `pagamentos.int.test.ts` | ❌ Survived (21/21 pass). Effects stay single because the guarded charge update in `applyProviderStatus` absorbs the replay, so `:202`/`:217` cannot see that the first layer is gone. NUC-113 "without reprocessing" is not pinned |
| A4 | `api/modules/booking/transition.ts:75` | `isTerminalStatus(to)` → `!isTerminalStatus(to)` | `transition.int.test.ts` | ✅ Killed (2 failed: `:50`, `:123`) |
| A5 | `api/modules/booking/cancel.service.ts:64` | clinic may no longer cancel `awaiting_payment` (fix `8ae1fc7` reverted) | `booking-cancel.int.test.ts` | ✅ Killed (1 failed: `:197`, 409 ≠ 200) |
| A6 | `api/modules/booking/cancel.service.ts:304-305` | `booking.cancelled` e-mail queued only when `actor === 'tenant'` | `booking-cancel.int.test.ts` | ❌ Survived (6/6 pass). NUC-153 "customer notified at once" is unasserted |
| A7 | `api/jobs/expire-holds.ts:38` | `kind = 'single'` filter removed (fixed occurrences expired) | `expire-holds.int.test.ts` | ✅ Killed (1 failed: `:120`) |
| A8 | `api/modules/booking/create-booking.service.ts:265` | hold limit `>= 3` → `> 3` | `bookings.int.test.ts` | ✅ Killed (1 failed: `:221`) |
| A9 | `api/modules/booking/create-booking.service.ts:68` | occupancy without cleanup (`end + cleanup` → `end`) | `bookings.int.test.ts` | ✅ Killed (1 failed: `:190`, 23:00 ≠ 23:30) |
| A10 | `api/modules/booking/create-booking.service.ts:246` | `BOOKING_NOT_OPEN` message → "Reservas fechadas." | `bookings.int.test.ts` | ❌ Survived (14/14 pass). NUC-70 message unasserted |
| A11 | `api/modules/booking/create-booking.service.ts:363` | consent `ip` → `null` | `bookings.int.test.ts` | ❌ Survived (14/14 pass). NUC-91 IP unasserted |

Every killed mutant failed on an `AssertionError` in the named test (checked in each run log), not on a crash. A10 and A11 were aimed at gaps found in the AC review, to confirm them empirically.

**Sensor depth**: P0 manual fault injection, 20 mutants (9 core, 11 API) over pricing/segments, proportional (half-up) amounts, sinal split, cancellation refund threshold, cleanup buffer in both directions, category selection, state machine incl. clinic cancellation of pending bookings, terminal occupancy release, hold expiry (availability and job), hold limit, reschedule own-slot exclusion and settlement, idempotent webhooks.
**Result**: 16/20 killed - FAIL ❌ (A3, A6, A10, A11 survived)

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ Pure engines in `packages/core`, thin services; no speculative abstraction found in the files read |
| Surgical changes | ✅ Integration fixes (`8ae1fc7`, `ce1171d`, `faaafc1`, `345623a`) touch only the files their messages name |
| No scope creep | ✅ receita/gestao features live under their own specs |
| Matches patterns | ✅ Same route/service/test layout as fundação |
| Spec-anchored outcome check | ⚠️ NUC-70 message, NUC-91 IP, NUC-153 customer notice and the NUC-113 claim layer are not pinned; NUC-01 and NUC-206 differ from the spec text |
| Per-layer coverage (domain 1:1; routes happy + edge + error) | ✅ Every W-* row has its own test; every route file covers happy, error codes and role checks |
| Every test maps to a requirement | ✅ Test titles carry NUC ids or W-* row names (194 of 210 ids tagged directly, the rest by range tags such as `NUC-89..NUC-92`) |
| Documented guidelines followed | ✅ `.specs/STATE.md` AD-010/AD-018 and the tasks.md Test Coverage Matrix |

---

## Edge Cases (spec.md:697-712)

- [x] Late Pix after another tenant took the slot → refund + `booking.late_approval_refund`: `pagamentos.int.test.ts:431`
- [x] Two concurrent webhooks → one effect: `pagamentos.int.test.ts:217`
- [x] Expiry job vs webhook race → row lock, late-approval path: `pagamentos.int.test.ts:404`, `expire-holds.int.test.ts:80` (lock in `api/jobs/expire-holds.ts:47-49`)
- [x] Fake webhook first, real one still processed: `pagamentos.int.test.ts:162` (no row stored for invalid signatures)
- [x] Booking across midnight → `outside_hours`: `grid.test.ts:175`
- [x] DST via `localToUtc` IANA: fundação FND-12 (`core/time.test.ts`)
- [x] Price change on Resumo → `PRICE_CHANGED`: `bookings.int.test.ts:122`; web `SummaryStep.test.tsx:169`
- [x] Policy change on Resumo → `POLICY_CHANGED`, re-accept: `bookings.int.test.ts:111`; `SummaryStep.test.tsx:206`
- [x] Closed day with a recurring block → block stays: by construction, `findAffectedBookings` reads only `bookings` (`api/modules/calendar/calendar-config.service.ts:134`), so blocks never count as affected. No dedicated test
- [x] All hourly categories inactive → cells shown, `NO_CATEGORY`, overlay hatched: `quote.int.test.ts:146`, `CategoryBandOverlay.test.tsx:58`
- [x] BrasilAPI renames a seeded holiday, keeps `isClosed`: `calendar-exceptions.int.test.ts:229`
- [x] Dearer reschedule slot taken while paying → refund, booking unchanged: `reschedule.int.test.ts:510`
- [x] Card deleted while a balance charge is pending: `cards.int.test.ts:189`
- [x] Reception on admin-only routes → 403: `calendar-config.int.test.ts:65`, `bookings.int.test.ts:120`, `:412`, `booking-cancel.int.test.ts:245`

---

## Gate Check

All commands run by the verifier in this worktree at `c54c858` after a fresh `npm install` (exit 0, `package-lock.json` unchanged).

| Gate | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `npm run typecheck` | ✅ exit 0 (web, api, core) |
| Lint | `npm run lint` | ✅ exit 0 |
| Core | `npm test -w packages/core` | ✅ 32 files, 1191 tests passed |
| Web | `npm test -w apps/web -- --maxWorkers=2` | ✅ 137 files, 1191 tests passed (899 s). The first run with default workers died with `FATAL ERROR: Zone Allocation failed - process out of memory` while the API suite ran in parallel; this is host memory, not a test failure |
| API | `DATABASE_URL_TEST=<verify>/nucleo_verify npm test -w apps/api` | ✅ 65 files, 663 tests passed (2241 s). `nucleo_verify` held 30 migrated tables afterwards, confirming the override |
| Build | `API_PROXY_ORIGIN=https://example.invalid npm run build` | ✅ exit 0 (`apps/web/dist`, PWA `sw.js`) |
| Production smoke (T50) | `node scripts/smoke.mjs https://bravo-clinic.netlify.app` | ✅ exit 0: api health via proxy, public config, public rooms, principal availability, home page |
| E2E | `npm run e2e -w apps/web` | ⏭️ Not run by instruction (resets `DATABASE_URL_TEST`); reviewed statically |

- **Total**: 3045 unit/integration tests passed, 0 failed, 0 skipped.
- **Test count before the feature**: not re-measured by the verifier (main also carries receita and gestao, so a núcleo-only delta is not meaningful). No test is skipped or focused: `grep -E "(it|test|describe)\.(skip|todo|only)|xit\("` over `apps/api/src`, `apps/web/src`, `apps/web/e2e` and `packages/core/src` finds nothing.
- **Skipped tests**: none.

---

## Fix Plans

### Fix 1: NUC-153 clinic cancellation never asserts the customer notice (A6 survived)

- **Root cause**: `api/routes/admin/booking-cancel.int.test.ts:119-151` checks refunds, audit and status but never reads `emailOutbox`.
- **Fix task**: in that test (and in `:197` for the awaiting case) assert one `booking.cancelled` outbox row for the customer with a `METHOD:CANCEL` `.ics` (same pattern as `api/routes/app/cancel.int.test.ts:146`).
- **Done when**: A6 (`if (actor === 'tenant')` around `bookingMailer.cancelled`, `cancel.service.ts:304`) fails the file.
- **Priority**: Major

### Fix 2: NUC-70 message unasserted (A10 survived)

- **Root cause**: `api/routes/app/bookings.int.test.ts:90-99` asserts only `code`.
- **Fix task**: add `expect(res.error?.message).toBe('As reservas online abrem em breve.')`.
- **Done when**: A10 fails the file.
- **Priority**: Minor

### Fix 3: NUC-91 consent IP unasserted (A11 survived)

- **Root cause**: `api/routes/app/bookings.int.test.ts:192-198` matches kind, version and ref, not `ip`.
- **Fix task**: send the request with a known client IP header (as `api/routes/public/auth/login.int.test.ts` does for its IP limits) and assert `consent.ip`.
- **Done when**: A11 (`ip: null` at `create-booking.service.ts:363`) fails the file.
- **Priority**: Minor

### Fix 4: NUC-113 first dedupe layer not observable (A3 survived)

- **Root cause**: duplicates are caught twice, by the `webhook_events` claim and by the guarded charge update. The tests use a fixed clock and assert only the effects, so removing the claim filter changes nothing visible.
- **Fix task**: in `api/routes/webhooks/pagamentos.int.test.ts:202`, deliver the second copy with a later `now` (or spy on `applyProviderStatus` / the gateway) and assert the event row keeps its first `received_at`/`processed_at` and that the status is not applied a second time.
- **Done when**: A3 fails the file.
- **Priority**: Minor (money effects already exactly-once)

### Fix 5: spec text behind the implementation (NUC-01, NUC-206), docs only

- **NUC-01**: amend `spec.md:188` ("plus `awaiting_payment → cancelled_by_clinic`, PRD §5.5/§7.5") and `docs/architecture.md:177`, matching `design.md:447` and `core/status/booking.ts:52-55`.
- **NUC-206**: amend `spec.md:693` to point at GES-134/GES-135 (provider flag, no booking code in `purchase`), or mark it superseded in the traceability table.
- **Bookkeeping**: tick T4's Done-when boxes (`tasks.md:468-472`) and drop the duplicated T1–T3 blocks (`tasks.md:365-480`).
- **Priority**: Minor

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| NUC-01 | Implementing | ⚠️ Needs spec amendment |
| NUC-70, NUC-91, NUC-113, NUC-153 | Implementing | ❌ Needs fix (assertion) |
| NUC-206 | In Tasks | ⚠️ Superseded by GES-134/GES-135 (amend spec) |
| All other NUC-02..NUC-210 | Implementing / In Tasks | ✅ Verified |

---

## Summary

**Overall**: ❌ Not Ready (test-strength and spec-text gaps; no functional defect found)

**Spec-anchored check**: 204/210 ACs matched the spec outcome. 4 partial (NUC-70, NUC-91, NUC-113, NUC-153). 2 spec-text deviations (NUC-01, NUC-206)
**Sensor**: 16/20 mutations killed (survived: A3, A6, A10, A11)
**Gate**: 3045 passed, 0 failed, 0 skipped. Build and production smoke exit 0

**What works**: every worked example (W-CL, W-CC, W-PR, W-SP, W-CA, W-RS, W-ST, W-AV) verbatim. Exclusion-constraint concurrency (1 of 10). Hold expiry, both lazily and in the job. Reschedule own-slot handling. Clinic cancellation of pending bookings. Idempotency keys, webhooks, late approval and refunds. All admin, tenant and public routes with their error codes and role checks. All web ACs. Live production smoke.

**Issues found**: Fix 1 to Fix 5 above. Fixes 1–4 add assertions. Fix 5 amends the spec and tasks docs.

**Next steps**: route Fix 1–5 to an implementer, then re-verify (iteration 2 of 3). Re-run sensors A3, A6, A10 and A11 at that point.
