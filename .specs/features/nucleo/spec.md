# Núcleo Specification

## Problem Statement

Fundação delivers the shell: monorepo, auth, base tables, design system and a static Home. The clinic still cannot sell an hour. Núcleo (PRD §9 step 1) is the revenue core: the Administrador geral configures hours, slots, cleanup, holidays, closed days, blocks, hourly/block categories and policies; a professional finds a free slot on the phone, sees the exact price, accepts the policy and pays the sinal (or 100%) through a gateway-independent checkout; the balance is charged or reminded automatically; the tenant reschedules or cancels by clear rules; reception and the admin run the day in Gestão de Reservas. Every later feature (`receita`, `gestao`) plugs into the engines and extension points defined here.

## Goals

- [ ] A verified tenant books Sala Principal on a Tuesday 17:30–20:00 on a phone, sees two priced segments totalling R$ 219,00, pays the R$ 109,50 sinal in the sandbox gateway and receives a confirmation e-mail with a valid `.ics` in ≤ 4 visible checkout steps, median ≤ 3 minutes (PRD §3).
- [ ] No two active occupancies of a room overlap, cleanup included, under concurrent checkout (exclusion constraint + `SLOT_TAKEN`), proven by an integration test with parallel requests.
- [ ] Every PRD worked example (cleanup §5.2.1, category selection §5.3, split §5.4, cancellation §5.5) is a passing unit test with the exact values of this spec.
- [ ] The admin changes any §5.2/§5.4/§5.5 parameter, a category price or the V_ref without a deploy, and existing bookings keep their frozen price and policy.
- [ ] Availability for one room-day responds in ≤ 300 ms p95 with a warm database (PRD §8), measured on the `dev` branch with 500 bookings in the month.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Hour packages, fixed-schedule subscriptions, renewals, extra hours, package debit at checkout, Assinaturas tab, "Vender assinatura" | `receita` (AD-013); núcleo exposes `PaymentModeHandler` and checkout steps (AD-033) |
| Credits wallet (`credit_lots`/`credit_ledger`), paying with credits, Perfil → Compras | `receita`; núcleo calls `CreditPort` (AD-033) |
| Coupons, slot discounts ("Aplicar desconto (%)" action, "−10%" markers data) | `receita`; núcleo exposes the discount checkout step, `AvailabilityDecorator` and web slots |
| Create/edit forms for `hour_package` and `fixed_schedule` categories, estimated period price, renewal notices on price change | `receita`; núcleo lists them read-only |
| Closed-day compensation amounts (1/30 rule) | `receita` implements `ClosedDayCompensationPort`; núcleo shows its preview |
| Integrações screen (gateway credentials form, "Testar conexão", webhook URL copy), staff notification recipients and toggles, ICS feeds, MCP, Serviços Extras, Financeiro/DRE, Clientes/Salas/Usuários/Auditoria screens, room photo upload, web push | `gestao`; núcleo provides `PaymentGateway.ping()`, `NotificationPort`, `RoomMediaPort` |
| Weekly BrasilAPI import job and the 1 October holiday reminder e-mail | `gestao` jobs (architecture §8) calling núcleo's `importNationalHolidays` service |
| Room inactivation with future bookings | `gestao` (Salas screen) |
| Legal wording of Termos/Privacidade | Supplied by the clinic (PRD §11); núcleo ships a base text marked for legal review |
| NFS-e, WhatsApp notifications, two-way calendar sync | PRD §9 Fase 2 / out of MVP |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Credits for cheaper reschedule / clinic cancel, owned by `receita` whose tables do not exist yet | Núcleo never writes credit tables; it calls `CreditPort.grant`. The default port is `deferred`: the amount is recorded in `booking_events.data.creditGrant = { amountCents, status: 'deferred' }`; `receita` installs a `live` port and backfills deferred grants (AD-033) | Núcleo ships before `receita`; no credit is lost and no table ownership changes | n |
| Payment approved after the checkout hold expired | If the slot is still free, the booking is reinstated (`expired → confirmed/paid`); else the payment is refunded and the apology e-mail lists 3 alternative slots (AD-032) | PRD §7.6 only defines the "slot taken" case; reinstating serves the customer who paid | n |
| "Paga a diferença no ato" on a more expensive reschedule | The new slot is held by a system block for `payment.checkout_hold_minutes`, a `booking_difference` charge is created, and the move is applied when it is approved; unpaid → the request expires and the booking stays unchanged | Pays before moving; never loses the original slot; reuses blocks and the charge pipeline | n |
| Cheaper reschedule when only the sinal was paid | The price drop first reduces the unpaid balance; only money already paid above the new total becomes credit (`credit = max(0, paid − newNet)`) | Crediting unpaid money would create value from nothing | n |
| Sinal (`deposit_cents`) after reschedule | Kept, capped at the new total | Retention on cancellation stays predictable | n |
| Cleanup duration change and frozen `cleanup_minutes` | A change applies to every future active booking without a manual cleanup exception, after `findCleanupConflicts` returns no conflict; past and in-progress bookings never change | PRD §5.2.1 asks to list future conflicts, which only makes sense if the new value reaches them | n |
| Business-hours change that leaves future bookings outside the window | Rejected with 409 `AFFECTED_BOOKINGS` listing them, same rule as closed days | PRD §7.6 rule for closed days/holidays, applied consistently | n |
| When the checkout hold starts | When the booking is created by "Continuar para pagamento" at the end of Resumo | "Só o primeiro a entrar no checkout consegue reservar" (US-02) | n |
| "≤ 4 etapas visíveis" | Stepper "Sala e data · Horário · Resumo · Pagamento"; login/cadastro is an interstitial not counted as a step | PRD §8 + US-02 order | n |
| Hold squatting | A tenant may hold at most 3 `awaiting_payment` bookings at once | Prevents blocking the calendar with abandoned checkouts | n |
| "Checklist exige revisar a tabela antes de publicar o site" | While `onboarding.prices_reviewed = false`, tenant self-service booking returns 409 `BOOKING_NOT_OPEN` and the site shows "Reservas online abrem em breve"; staff bookings are allowed | Makes the checklist binding without hiding the site | n |
| Sandbox gateway on the production branch | Approve/reject on the fake hosted page requires an MFA-verified staff session there; elsewhere anyone can use it (AD-034) | The default gateway must not let the public self-approve payments | n |
| Reception permissions in Gestão de Reservas | Reception: create booking/pre-reservation, single blocks, check-in, resend link, read everything. Admin only: manual confirmation, reschedule/cancel from Admin, cleanup exception, recurring blocks, Calendário screen, policies | PRD §7.3 profile list; manual confirmation is "pelo Administrador geral" | n |
| Check-in window | From 60 min before start until the end of the booking | PRD only says check-in marks attendance | n |
| Completion | A checked-in booking becomes `completed` when it ends (no-shows job) | Architecture §3.1 "checked in and ended" | n |
| Booking reminders 24h and 2h (PRD §7.2) | E-mail only in núcleo; web push is `gestao` | AD-008 split | n |
| "Menor valor-hora entre as categorias visíveis" | Minimum of weekday and weekend rates over active public hourly categories (factory: R$ 80,00) | Blocks and packages are not "valor-hora" | n |
| Holiday "alerta antes da data" | Holidays dated today..today+30 days carry `alert: true` and show a banner in Admin and a marker on public calendars | PRD gives no window | n |
| BrasilAPI import | `GET https://brasilapi.com.br/api/feriados/v1/{year}`, national holidays only, years = current or next; existing rows keep their open/closed decision | SC/Itajaí are seeded (fundação) or manual | n |
| Room change on reschedule | Allowed (price is equal across rooms, PRD §5.1); tenant UI defaults to the same room | Closed-day resolution often needs another room | n |
| Admin reschedule to a more expensive slot | Admin chooses `add_to_balance` or `waive` (justification required) | Admin-initiated payment intents add no value at the counter | n |
| Clinic cancellation "crédito" option | Offered only when `CreditPort.mode = 'live'`; until then refund only | A deferred credit is not spendable yet | n |
| Staff-created booking and policy acceptance | The customer accepts the booking's frozen policy text when paying via the link; manually confirmed bookings record no acceptance | Acceptance must be the customer's own act (US-02) | n |
| Contato map | Static address + "Abrir no Google Maps" link, no iframe | Keeps fundação CSP unchanged | n |
| Legal pages | Base text in `apps/web/src/content/legal/*.md` with versions `terms-2026-10` / `privacy-2026-10` (fundação consent versions), flagged for legal review | Text is a clinic dependency (PRD §11) | n |
| Analytics provider (PRD §3) | Provider-agnostic `track()`; GA4 loads only when `VITE_GA4_ID` is set (P2) | No account exists yet | n |
| CSV export format | UTF-8 with BOM, `;` separator, pt-BR money and dates, max 5 000 rows | Opens correctly in Brazilian Excel | n |
| Pix and card expiry | Pix `date_of_expiration` and hosted card checkout expiry equal `hold_expires_at` | Minimizes late approvals | n |
| Mercado Pago saved-card charge without CVV | Adapter uses `POST /v1/card_tokens { card_id }` then `POST /v1/payments` with `payer.type = 'customer'`; the worker verifies against current MP docs before coding (flagged uncertain in design) | Behavior depends on MP account configuration | n |
| Refund failures | Retried by the reconcile job up to 5 attempts, then `failed` + staff notification | No silent money loss | n |
| Recurring blocks horizon | Materialized from `valid_from` to `today + calendar.max_advance_days`; a new daily trigger `/jobs/materialize-blocks` extends it | The exclusion constraint needs real rows | n |
| Admin calendar feed range | ≤ 42 days per request (6-week month view) | Bounded queries on the free tier | n |
| Public availability rate limit | 120 requests per minute per IP on availability and quote | Free-tier compute protection | n |
| Customer creation at the counter | Núcleo owns `GET /admin/customers/search` and `POST /admin/customers` (tenant without password + "Crie sua senha" link valid 72 h); `gestao` Clientes builds on them | Pre-reservation "exige cliente", often new | n |
| Hold-expiry latency (5-min cron) | Stale holds are treated as free by availability and expired lazily inside booking creation; the job only sweeps | Exact 15 min without a sub-minute scheduler | n |

**Open questions:** none - all resolved or logged above.

---

## Worked Examples (normative)

All examples: Sala Principal, factory settings (slot 30, default/minimum duration 60, cleanup 30, max advance 90 days, min advance 0), factory categories, `now = 2026-10-20T12:00:00Z` unless stated. Dates: 2026-10-27 is a Tuesday, 2026-10-28 Wednesday, 2026-10-31 Saturday, 2026-11-02 Monday (Finados, national holiday, open).

### W-CL · Cleanup buffer (PRD §5.2.1, architecture §7.4)

| # | Existing occupancy (2026-10-27) | Candidate | Expected |
| --- | --- | --- | --- |
| CL-1 | 09:00–11:00 | 11:00–12:00 | rejected `in_cleanup` ("Sala em limpeza") |
| CL-2 | 09:00–11:00 | 11:30–12:30 | accepted |
| CL-3 | 09:00–11:00 and 14:00–16:00 | 12:00–14:00 | rejected `no_cleanup_before_next` |
| CL-4 | 09:00–11:00 and 14:00–16:00 | 11:30–13:30 | accepted; grid cell 11:30 has `maxEndMinute = 810` |
| CL-5 | 08:00–10:00 fixed occurrence | 10:00–11:00 | rejected `in_cleanup`; 10:30–11:30 accepted |
| CL-6 | cleanup 45, booking 09:00–10:00 | 10:30–11:30 | rejected `in_cleanup`; 11:00–12:00 accepted; 10:45–11:45 rejected `misaligned` |
| CL-7 | none | 07:00–08:00 | accepted (no cleanup before the first booking) |
| CL-8 | none | 23:00–00:00 | accepted (cleanup may pass closing) |
| CL-9 | 09:00–11:00 and 12:30–14:00 | grid | cells 11:30 and 12:00 `leftover` (unavailable, no error); 14:30 available |
| CL-10 | block 15:00–16:00 | 14:00–15:00 | rejected `no_cleanup_before_next` (the candidate's own cleanup 15:00–15:30 overlaps the block); 13:30–14:30 accepted |

### W-CC · Cleanup change conflicts

| # | Future bookings (same room, frozen cleanup 30) | New cleanup | Expected conflicts |
| --- | --- | --- | --- |
| CC-1 | 09:00–11:00, 11:30–12:30 | 45 | one pair (first, second) |
| CC-2 | 09:00–11:00, 12:00–13:00 | 60 | none |
| CC-3 | 09:00–11:00, 12:00–13:00 | 90 | one pair |
| CC-4 | 09:00–11:00 in Sala Principal, 11:00–12:00 in Sala Secundária | 60 | none (different rooms) |

### W-PR · Category selection and price (PRD §5.3, architecture §7.5)

| # | Date | Interval | Expected segments | Gross (cents) |
| --- | --- | --- | --- | --- |
| PR-1 | Tue 2026-10-27 | 14:00–17:00 | 14:00–17:00 "2 horas ou mais", 180 min × 8000 | 24000 |
| PR-2 | Tue 2026-10-27 | 14:00–15:00 | "1 hora", 60 min × 9700 | 9700 |
| PR-3 | Tue 2026-10-27 | 17:30–20:00 | 17:30–19:00 "2 horas ou mais" 90 min = 12000; 19:00–20:00 "2 horas ou mais — noite" 60 min = 9900 | 21900 |
| PR-4 | Sat 2026-10-31 | 10:00–13:00 | "2 horas ou mais", weekend rate 9900 × 3 | 29700 |
| PR-5 | Wed 2026-10-28 | 19:00–20:00 | "1 hora — noite" 12000 | 12000 |
| PR-6 | Mon 2026-11-02 (holiday) | 10:00–11:00 | "1 hora", weekend rate 12000 | 12000 |
| PR-7 | Tue 2026-10-27 | 18:00–19:30 | 18:00–19:00 "1 hora" 9700; 19:00–19:30 "1 hora — noite" 30 min = 6000 | 15700 |
| PR-8 | Tue, "1 hora — noite" deactivated | 19:00–20:00 | `no_category`, uncovered 19:00–20:00 | — |

### W-SP · Signal and balance (PRD §5.4, architecture §7.6)

| # | Net | Credit | startsAt − now | Mode | Deposit | Balance | Pay now | Credit used |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SP-1 | 21900 | 0 | 5 days | deposit_balance | 10950 | 10950 | 10950 | 0 |
| SP-2 | 9701 | 0 | 5 days | deposit_balance | 4851 | 4850 | 4851 | 0 |
| SP-3 | 21900 | 0 | 47h59m | full_upfront | 21900 | 0 | 21900 | 0 |
| SP-4 | 21900 | 0 | 48h00m | deposit_balance | 10950 | 10950 | 10950 | 0 |
| SP-5 | 20000 | 12000 | 5 days | deposit_balance | 10000 | 8000 | 0 | 12000 |
| SP-6 | 20000 | 4000 | 5 days | deposit_balance | 10000 | 10000 | 6000 | 4000 |

In deposit mode `balanceChargeAt = startsAt − 48h` and `balanceDueAt = startsAt − 24h`; in full mode both are null.

### W-CA · Cancellation (PRD §5.5, architecture §7.12)

| # | Actor | Hours before | Payment mode | Deposit | Paid | Package/extra min | In current period | Deposit refundable | Retained | Refund | Minutes returned |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CA-1 | tenant | 30 | deposit_balance | 8000 | 16000 | 0/0 | — | no | 8000 | 8000 | 0 |
| CA-2 | tenant | 30 | deposit_balance | 8000 | 8000 | 0/0 | — | no | 8000 | 0 | 0 |
| CA-3 | tenant | 23 | deposit_balance | 8000 | 16000 | 0/0 | — | no | 16000 | 0 | 0 |
| CA-4 | tenant | 24 | deposit_balance | 8000 | 16000 | 0/0 | — | no | 8000 | 8000 | 0 |
| CA-5 | tenant | 30 | package | 0 | 0 | 120/18 | yes | no | 0 | 0 | 138 |
| CA-6 | tenant | 23 | package | 0 | 0 | 120/18 | yes | no | 0 | 0 | 0 |
| CA-7 | tenant | 30 | package | 0 | 0 | 120/18 | no | no | 0 | 0 | 0 |
| CA-8 | tenant | 30 | subscription (fixed occurrence) | 0 | 0 | 0/0 | — | no | 0 | 0 | 0 |
| CA-9 | clinic | 10 | deposit_balance | 8000 | 16000 | 0/0 | — | no | 0 | 16000 | 0 |
| CA-10 | tenant | 30 | deposit_balance | 8000 | 16000 | 0/0 | — | yes | 0 | 16000 | 0 |

CA-9 also returns `clinicOptions = policy.clinic_cancel_options` (factory `['refund','minutes','credit']`).

### W-RS · Reschedule eligibility (PRD §5.5)

| # | startsAt − now | newStartsAt − now | rescheduleCount | Staff exception | Expected |
| --- | --- | --- | --- | --- | --- |
| RS-1 | 30h | 10 days | 0 | no | allowed |
| RS-2 | 23h59m | 10 days | 0 | no | `too_late` |
| RS-3 | 30h | 10 days | 1 | no | `limit_reached` |
| RS-4 | 30h | 61 days | 0 | no | `beyond_window` |
| RS-5 | 23h | 61 days | 1 | yes | allowed |

### W-ST · Reschedule settlement (deposit percent 50)

| # | Old net | New net | Paid | Deposit | Pay now | Credit | New total | New paid (after pay now) | New balance | New deposit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ST-1 | 24000 | 9700 | 24000 | 12000 | 0 | 14300 | 9700 | 9700 | 0 | 9700 |
| ST-2 | 24000 | 9700 | 12000 | 12000 | 0 | 2300 | 9700 | 9700 | 0 | 9700 |
| ST-3 | 9700 | 24000 | 4851 | 4851 | 14300 | 0 | 24000 | 19151 | 4849 | 4851 |
| ST-4 | 16000 | 16000 | 16000 | 8000 | 0 | 0 | 16000 | 16000 | 0 | 8000 |
| ST-5 | 16000 | 12000 | 8000 | 8000 | 0 | 0 | 12000 | 8000 | 4000 | 8000 |

### W-AV · Average hourly value (PRD §5.3)

| # | Category | Expected |
| --- | --- | --- |
| AV-1 | Pacote 20h mensal, 160000 / 1200 min | 8000 ("R$ 80,00/h") |
| AV-2 | Meio turno mensal, 28000 per occurrence, window 07:00–09:30 | 11200 |
| AV-3 | Bloco "Manhã" 07:00–12:00, 28000 | 5600 |
| AV-4 | Hourly "1 hora" | 9700 (its weekday rate) |

---

## User Stories

### P1: Booking vocabulary and contracts ⭐ MVP

**User Story**: As a developer of any lane, I want one set of booking status codes, labels and API contracts in `@bravo/core`, so that API and web agree byte for byte.

**Why P1**: Backend and frontend lanes run in parallel against these contracts.

**Acceptance Criteria**:

1. The core module `status/booking.ts` SHALL allow exactly the transitions of `docs/architecture.md` §3.1 plus `expired → confirmed`, `expired → paid` and `paid → confirmed` (AD-032), and `canTransition(from, to)` SHALL return false for every other pair. [NUC-01]
2. The core `labels.ts` SHALL map each booking status code to its pt-BR label: Aguardando pgto, Pré-reserva, Pré-reservada (renovação), Confirmada, Quitada, Concluída, No-show, Expirada, Cancelada pelo locatário, Cancelada por falta de pagamento, Cancelada pela clínica. [NUC-02]
3. WHEN `paymentStatusOf(booking)` is called THEN core SHALL return `awaiting` "Aguardando pagamento" for `awaiting_payment`/`pre_reserved`, `deposit_paid` "Sinal pago · saldo pendente" for `confirmed` with balance > 0 in deposit mode, `manual_pending` "Confirmada manualmente · pagamento pendente" for manual mode with balance > 0, `paid` "Quitada" for `paid` or balance 0, `package` "Pago com pacote" for package/subscription modes, `refunded` "Reembolsada" for cancelled bookings with approved refunds, and `none` "—" otherwise. [NUC-03]
4. The core `contracts/` modules SHALL export a zod schema for every request and response body listed in design.md §API contract, and the API SHALL validate requests with them and its integration tests SHALL parse every response with them. [NUC-04]
5. WHEN a service changes a booking status THEN it SHALL use a guarded `UPDATE ... WHERE status = <from>` and write one `booking_events` row (from, to, actor, origin, reason) in the same transaction; IF the guarded update affects 0 rows THEN the API SHALL return 409 `INVALID_TRANSITION`. [NUC-05]
6. WHEN a booking enters a terminal status THEN its `room_occupancy` row SHALL be set `active = false` in the same transaction. [NUC-06]

**Independent Test**: core unit tests over the transition matrix and labels; one API test that tries a forbidden transition.

---

### P1: Slot grid with cleanup in both directions ⭐ MVP

**User Story**: As a tenant, I want the grid to offer only times that respect hours, slot size, minimum duration, closures, blocks and cleanup, so that I never pick an impossible slot.

**Why P1**: US-02 grid rules; PRD §5.2.1 is the clinic's operating constraint.

**Acceptance Criteria**:

1. WHEN `businessWindow` receives a date that is a clinic closed day, a closed day of that room, a holiday with `isClosed`, or a weekday whose business-hours row is closed THEN core SHALL return null. [NUC-07]
2. WHEN `businessWindow` receives an open holiday THEN core SHALL return the `holiday` row's hours, and on other open dates the weekday row's hours, with `isHoliday` set accordingly. [NUC-08]
3. WHEN `resolveDayType` receives a Saturday, Sunday or holiday date THEN core SHALL return `weekend_holiday`, and `weekday` otherwise. [NUC-09]
4. WHEN `validateInterval` evaluates rows CL-1 to CL-8 and CL-10 of W-CL THEN core SHALL return exactly the expected result of each row. [NUC-10]
5. IF the start or end minute is not a multiple of `slotMinutes` THEN `validateInterval` SHALL return `misaligned`; IF `end − start < minBookingMinutes` THEN `too_short`; IF the interval leaves the window THEN `outside_hours`; IF the window is null THEN `closed`. [NUC-11]
6. IF the start instant is not later than `now + minAdvanceMinutes` THEN `validateInterval` SHALL return `in_past`, and IF the date is after today + `maxAdvanceDays` (São Paulo dates) THEN `too_far`. [NUC-12]
7. The interval check SHALL treat a candidate as conflicting exactly when `[start, end + cleanup)` overlaps an existing `[o.start, o.occupiedUntil)`, which is the predicate of the `room_occupancy` exclusion constraint. [NUC-13]
8. WHEN `generateSlotGrid` evaluates row CL-9 THEN core SHALL mark cells 11:30 and 12:00 `state: 'unavailable', adminState: 'leftover'` and cell 14:30 `available`. [NUC-14]
9. WHEN `generateSlotGrid` evaluates row CL-4 THEN the 11:30 cell SHALL have `startable: true` and `maxEndMinute: 810`. [NUC-15]
10. WHEN `findCleanupConflicts` evaluates rows CC-1 to CC-4 of W-CC THEN core SHALL return exactly the expected conflicts. [NUC-16]
11. WHEN `rejectMessage` receives a reason THEN core SHALL return its pt-BR text: closed "Sala fechada nesta data", outside_hours "Fora do horário de funcionamento", misaligned "Horário fora da grade de horários", too_short "Duração abaixo do mínimo", in_past "Horário indisponível para reserva", too_far "Data além da antecedência máxima", overlaps_booking "Horário já reservado", in_cleanup "Sala em limpeza", overlaps_block "Horário bloqueado", no_cleanup_before_next "Termina sem o intervalo de limpeza antes da próxima reserva". [NUC-17]

**Independent Test**: `npm test -w packages/core` with W-CL and W-CC.

---

### P1: Pricing engine ⭐ MVP

**User Story**: As a tenant, I want the price computed per category segment, so that a booking crossing day and night windows costs exactly what the table says.

**Why P1**: PRD §5.3 rules; same numbers in browser and server (AD-001).

**Acceptance Criteria**:

1. WHEN several active hourly categories apply to a segment THEN `selectHourlyCategory` SHALL choose the one with the largest `minDurationMinutes` not greater than the whole booking duration, ties broken by the lowest display order. [NUC-18]
2. WHEN `priceHourlyBooking` evaluates rows PR-1 to PR-7 of W-PR THEN core SHALL return exactly the listed segments and gross. [NUC-19]
3. IF any minute of the interval has no applicable category (row PR-8) THEN `priceHourlyBooking` SHALL return `{ ok: false, reason: 'no_category', uncovered }` with the first uncovered range. [NUC-20]
4. The segment amount SHALL be `mulDivRoundHalfUp(rate, minutes, 60)`, so a 9701 rate over 90 minutes SHALL yield 14552. [NUC-21]
5. WHEN `categoryAverageHourlyCents` evaluates rows AV-1 to AV-4 of W-AV THEN core SHALL return the expected values. [NUC-22]
6. WHEN `priceBlockBooking` receives a block category whose weekdays (or holiday flag) apply to the date THEN core SHALL return its fixed price and window, and null otherwise. [NUC-23]
7. WHEN `coverageBands(categories, dayKey, window, durationMinutes)` is called THEN core SHALL return one band per applicable category with its rate and the list of uncovered ranges inside the window; with factory categories every day SHALL have no uncovered range for 60 minutes, and with "1 hora — noite" inactive Tuesday SHALL report 19:00–00:00 uncovered. [NUC-24]

**Independent Test**: core unit tests with W-PR and W-AV.

---

### P1: Payment split and booking policies ⭐ MVP

**User Story**: As the clinic, I want sinal, balance, cancellation and reschedule outcomes computed by one pure module, so that the checkout, the modals and the jobs never disagree.

**Why P1**: PRD §5.4/§5.5 are configurable rules applied automatically.

**Acceptance Criteria**:

1. WHEN `splitPayment` evaluates rows SP-1 to SP-6 of W-SP THEN core SHALL return the listed mode, deposit, balance, pay-now and credit-used values and the listed charge/due instants. [NUC-25]
2. WHEN `evaluateCancellation` evaluates rows CA-1 to CA-10 of W-CA THEN core SHALL return the listed retained, refund and minutes-returned values. [NUC-26]
3. WHEN `evaluateReschedule` evaluates rows RS-1 to RS-5 of W-RS THEN core SHALL return the listed result. [NUC-27]
4. WHEN `settleReschedule` evaluates rows ST-1 to ST-5 of W-ST THEN core SHALL return the listed pay-now, credit, new total, new paid, new balance and new deposit. [NUC-28]
5. WHEN `renderPolicyText(values)` receives the factory policy values THEN core SHALL return pt-BR sections "Sinal e saldo", "Reagendamento", "Cancelamento" and "No-show" whose text contains "sinal de 50%", "não é reembolsável", "48 horas antes", "24 horas antes" and "1 reagendamento cortesia". [NUC-29]
6. WHEN `payment.deposit_refundable` is true THEN `renderPolicyText` SHALL state "O sinal é reembolsável" instead of "não é reembolsável". [NUC-30]
7. WHEN `policySnapshot(settings)` is called THEN core SHALL return every `payment.*`, `policy.*` and `credits.validity_days` value plus `policy.version`, which is the object frozen in `bookings.policy_snapshot`. [NUC-31]

**Independent Test**: core unit tests with W-SP, W-CA, W-RS, W-ST.

---

### P1: Configure business hours and calendar parameters ⭐ MVP

**User Story**: As the Administrador geral, I want to set hours per weekday and holiday, slot size, default duration, cleanup and advance limits, so that I control when rooms can be booked (US-11).

**Why P1**: Without configuration nothing is bookable as the clinic wants.

**Acceptance Criteria**:

1. WHEN an MFA-verified admin calls `GET /api/admin/calendar/config` THEN the API SHALL return 200 with the 8 business-hours rows, the 5 calendar settings, the current warnings and `onboarding.pricesReviewed`; IF the caller is reception THEN it SHALL return 403 `FORBIDDEN`. [NUC-32]
2. WHEN `PUT /api/admin/calendar/business-hours` receives 8 valid rows THEN the API SHALL save them, write audit `calendar.business_hours_update` with before/after and return 200; IF a row has `closeMinute ≤ openMinute` or a minute not aligned to `calendar.slot_minutes` THEN it SHALL return 422 with the row path. [NUC-33]
3. IF new business hours would leave a future active booking outside its day's window THEN the API SHALL return 409 `AFFECTED_BOOKINGS` with `details.bookings[]` (`id, code, customerName, roomName, startsAt, endsAt`) and save nothing. [NUC-34]
4. IF `PUT /api/admin/calendar/settings` receives a `defaultBookingMinutes` that is not a multiple of `slotMinutes` or a value outside the catalog bounds THEN the API SHALL return 422 with the field path. [NUC-35]
5. WHEN the saved cleanup is not a multiple of the slot THEN the response SHALL include warning `{ code: 'cleanup_not_slot_multiple', lostMinutesPerBooking }` where lost = `ceil(c / slot) × slot − c` (45 with slot 30 → 15). [NUC-36]
6. IF the cleanup increases and `findCleanupConflicts` over future active bookings returns pairs THEN the API SHALL return 409 `CLEANUP_CONFLICTS` with `details.pairs[]` and change nothing. [NUC-37]
7. WHEN the cleanup changes without conflicts THEN every future active booking without a cleanup exception SHALL get the new `cleanup_minutes` and occupancy period in the same transaction, past and in-progress bookings SHALL stay unchanged, and audit `settings.calendar_update` SHALL be written. [NUC-38]
8. WHEN an admin calls `PATCH /api/admin/bookings/:id/cleanup` with `cleanupMinutes` between 0 and the current value and a justification of at least 5 characters THEN the API SHALL update the booking and its occupancy and write audit `booking.cleanup_exception`; IF the justification is missing THEN 422; IF the caller is reception THEN 403. [NUC-39]
9. WHEN the admin opens Calendário THEN the page SHALL show a Monday–Sunday week grid plus a Feriados column with the configured hours, editable start/end inputs per day, and shortcuts "Aplicar a seg–sex" and "Aplicar a sáb, dom e feriados". [NUC-40]
10. WHEN the parameters panel saves a cleanup that is not a slot multiple THEN the page SHALL show "A limpeza de 45 min não é múltipla do slot de 30 min: 15 min vendáveis perdidos por reserva."; WHEN the API returns `CLEANUP_CONFLICTS` or `AFFECTED_BOOKINGS` THEN it SHALL open a modal listing each booking with a link to it in Gestão de Reservas. [NUC-41]

**Independent Test**: integration tests on the config routes; Testing Library test on the editor with MSW.

---

### P2: Drag-edit business hours

**User Story**: As the Administrador geral, I want to drag the start and end of each day on the week grid, so that adjusting hours is visual.

**Why P2**: Typing already covers the need (PRD §7.3.1 "arrastando ... ou digitando").

**Acceptance Criteria**:

1. WHEN the admin drags the top or bottom handle of a day column THEN the editor SHALL snap the value to the slot size and update the corresponding input, and keyboard ArrowUp/ArrowDown on a focused handle SHALL move it by one slot. [NUC-42]

---

### P1: Holidays and closed days ⭐ MVP

**User Story**: As the Administrador geral, I want national, SC and Itajaí holidays listed with alerts and an open/close decision, and to close whole dates, so that the calendar matches reality (US-11).

**Why P1**: PRD §5.2 holidays and closed days.

**Acceptance Criteria**:

1. WHEN an admin calls `GET /api/admin/calendar/holidays?year=2026` THEN the API SHALL return that year's holidays ordered by date with `scope, source, isClosed, needsReview` and `alert: true` exactly for dates within today..today+30 days. [NUC-43]
2. WHEN `PATCH /api/admin/calendar/holidays/:id` sets `isClosed: true` THEN the API SHALL return 409 `AFFECTED_BOOKINGS` if active bookings exist that day, else save, write audit `holiday.update` and return 200. [NUC-44]
3. WHEN `POST /api/admin/calendar/holidays` receives `{ date, name, scope }` THEN the API SHALL create a `source = 'manual'` holiday (e.g. Carnaval as `optional`); IF `(date, name)` exists THEN 409 `CONFLICT`; WHEN `DELETE` targets a manual holiday THEN it SHALL delete it, and IF it targets a seed or BrasilAPI holiday THEN 422. [NUC-45]
4. WHEN `POST /api/admin/calendar/holidays/import { year }` runs for the current or next year THEN the API SHALL fetch BrasilAPI, insert missing national holidays with `source = 'brasilapi'`, update names of existing ones without touching `isClosed`, write audit `holiday.import` and return `{ inserted, updated }`; IF the year is another value THEN 422. [NUC-46]
5. IF BrasilAPI times out after 10 s, returns non-2xx or an unparseable body THEN the API SHALL return 502 `EXTERNAL_UNAVAILABLE` "Não foi possível consultar os feriados agora." and change no row. [NUC-47]
6. WHEN an admin calls `GET /api/admin/calendar/closed-days/preview?date&roomIds` THEN the API SHALL return the affected active bookings, excluding `fixed_occurrence` bookings (handled by the compensation port), and the `ClosedDayCompensationPort.preview` result `{ subscribers, minutes, creditCents, fixedOccurrencesCancelled }` (default all 0). [NUC-48]
7. WHEN `POST /api/admin/calendar/closed-days` receives `{ date, roomIds: null | string[], reason? }` with no affected booking other than `fixed_occurrence` ones THEN the API SHALL create one row (null room = whole clinic) or one per room, call `ClosedDayCompensationPort.apply` (which owns the fixed occurrences of that day), write audit `closed_day.create` and return 201 with the compensation summary; IF bookings are affected THEN 409 `AFFECTED_BOOKINGS`; IF the date is before today THEN 422. [NUC-49]
8. WHEN `DELETE /api/admin/calendar/closed-days/:id` is called THEN the API SHALL delete the row, write audit `closed_day.delete` and the date SHALL become bookable again. [NUC-50]
9. WHILE a closed day is being created for a date, a concurrent booking creation for that date SHALL wait on the same transaction-scoped advisory lock, so that either the booking appears in `AFFECTED_BOOKINGS` or it is rejected as `closed`. [NUC-51]
10. WHEN the admin opens the monthly exceptions view THEN the page SHALL show closed days, holidays with scope badge and alert icon, and recurring blocks, and SHALL let the admin open/close a holiday, add a manual holiday, import a year and close a date through a modal that lists affected bookings and the compensation preview before confirming. [NUC-52]

**Independent Test**: integration tests with BrasilAPI `fetch` stubbed; page test with MSW.

---

### P2: Holiday review banner

**User Story**: As the Administrador geral, I want a banner from 1 October reminding me to check next year's holidays, so that I do not forget (US-11).

**Why P2**: The e-mail reminder job is `gestao`; the banner is a convenience.

**Acceptance Criteria**:

1. WHILE today is on or after 1 October and the next year has no holiday rows or has rows with `needsReview` THEN Calendário SHALL show "Confira os feriados de <ano seguinte>" with buttons "Importar nacionais" and "Ver lista". [NUC-53]

---

### P1: Manual blocks with tags ⭐ MVP

**User Story**: As the Administrador geral or reception, I want to block slots of one or more rooms with "Limpeza", "Indisponível" or free text, once or weekly, so that maintenance and shoots are respected (§5.2.1 b).

**Why P1**: Blocks are part of availability.

**Acceptance Criteria**:

1. WHEN a staff user calls `POST /api/admin/blocks { roomIds, tag, date, startMinute, endMinute }` with a tag of 1–60 characters THEN the API SHALL create one block and one occupancy `[start, end)` per room, write audit `block.create` and return 201. [NUC-54]
2. IF any requested room has an active occupancy overlapping the block THEN the API SHALL return 409 `SLOT_TAKEN` naming the conflicting booking code or block tag and create no block for any room. [NUC-55]
3. WHEN an admin calls `POST /api/admin/block-recurrences { roomIds, tag, weekdays, startMinute, endMinute, validFrom, validUntil?, skipConflicts? }` THEN the API SHALL create one rule per room and materialize blocks from `validFrom` to `min(validUntil, today + max_advance_days)`; IF a date conflicts and `skipConflicts` is not true THEN 409 `SLOT_TAKEN` with `details.dates[]` and nothing created; WHEN `skipConflicts` is true THEN conflicting dates SHALL be skipped and returned in `skipped[]`. [NUC-56]
4. WHEN `materializeRecurrences(now)` runs again THEN it SHALL create only missing occurrences up to the horizon (unique `(recurrence_id, starts_at)`) and skip conflicting dates, counting them in its stats. [NUC-57]
5. WHEN `DELETE /api/admin/blocks/:id` is called THEN the block SHALL get `cancelled_at` and its occupancy `active = false`; WHEN `DELETE /api/admin/block-recurrences/:id` is called THEN the rule SHALL become inactive and its future blocks cancelled while past blocks stay. [NUC-58]
6. The occupancy of a manual block SHALL be exactly `[start, end)` with no cleanup added. [NUC-59]
7. WHEN the staff user opens "Bloquear" THEN a modal SHALL offer preset tags "Limpeza" and "Indisponível" or free text, one or more rooms, date and times, and (admin only) "Repetir semanalmente" with weekdays and end date. [NUC-60]

**Independent Test**: integration tests creating blocks over bookings; modal test.

---

### P1: Booking categories and price table ⭐ MVP

**User Story**: As the Administrador geral, I want to create and edit Hora avulsa and Bloco avulso categories, see the average hourly value live and mark V_ref, so that I set my commercial policy (US-12).

**Why P1**: Prices are examples until the admin reviews them (PRD §5.3).

**Acceptance Criteria**:

1. WHEN an admin calls `GET /api/admin/categories` THEN the API SHALL return the categories of all four types ordered by display order, each with `averageHourlyCents`, `isReference`, `status`, `visibility` and `editable` (true only for `hourly` and `block` in núcleo). [NUC-61]
2. WHEN `POST /api/admin/categories` receives an hourly category with positive integer weekday and weekend rates, non-empty weekdays, a window and a minimum duration aligned to the slot THEN the API SHALL create it, write audit `category.create` and return 201; IF any of these rules fails THEN 422 with the field path. [NUC-62]
3. WHEN `POST /api/admin/categories` receives a block category with a fixed price and a slot-aligned window THEN the API SHALL create it with period `single` and return 201. [NUC-63]
4. IF the request type is `hour_package` or `fixed_schedule` and no category handler for that type is registered THEN the API SHALL return 422 with path `type` and message "Tipo de categoria gerenciado em Pacotes". [NUC-64]
5. WHEN `PATCH /api/admin/categories/:id` changes any price or window THEN the API SHALL increment `version`, write audit `category.update` with before/after, and existing bookings' segments SHALL keep their frozen name, rate and amount. [NUC-65]
6. WHEN `POST /api/admin/categories/:id/reference` targets an active hourly category THEN the API SHALL make it the only `is_reference` row in one transaction and write audit `category.set_reference`; IF the category is not hourly THEN 422. [NUC-66]
7. IF a PATCH sets the reference category `inactive` THEN the API SHALL return 422 "Defina outra categoria de referência antes de desativar esta." [NUC-67]
8. WHEN `POST /api/admin/categories/reorder { ids }` lists every category id once THEN the API SHALL set display orders 1..n in that order; IF ids are missing or duplicated THEN 422. [NUC-68]
9. WHEN an admin calls `POST /api/admin/onboarding/prices-reviewed` THEN the API SHALL set `onboarding.prices_reviewed = true` and write audit `onboarding.prices_reviewed`. [NUC-69]
10. WHILE `onboarding.prices_reviewed` is false, a tenant `POST /api/app/bookings` SHALL return 409 `BOOKING_NOT_OPEN` "As reservas online abrem em breve." and staff bookings SHALL still succeed. [NUC-70]
11. WHEN the admin types a price in the categories table THEN the row SHALL show the average hourly value computed by `categoryAverageHourlyCents` before saving (e.g. "R$ 1.600,00 → R$ 80,00/h"), a V_ref radio, activate/deactivate and move up/down controls, and a "Nova categoria" form for Hora avulsa and Bloco avulso. [NUC-71]
12. WHEN the admin checks categories in the overlay selector THEN the week grid SHALL draw each as a colored band labelled with its rate and SHALL hatch the ranges `coverageBands` reports uncovered with the label "Horário sem categoria". [NUC-72]
13. WHILE `onboarding.prices_reviewed` is false, Calendário SHALL show the checklist "Revise os valores das categorias", "Confirme a categoria de referência (V_ref)", "Revise as políticas de pagamento e cancelamento" and a button "Marcar preços como revisados". [NUC-73]

**Independent Test**: integration tests on category routes; table and overlay tests with MSW.

---

### P1: Public availability and catalog ⭐ MVP

**User Story**: As a visitor, I want room details, prices and a live availability calendar, so that I choose a room and time before signing up (US-01).

**Why P1**: The site is the main sales channel.

**Acceptance Criteria**:

1. WHEN `GET /api/public/rooms` is called THEN the API SHALL return active rooms by display order with `slug, name, description, idealFor, equipment, cover` (null when no photo) and `fromPriceCents` = minimum weekday/weekend rate over active public hourly categories (factory 8000). [NUC-74]
2. WHEN `GET /api/public/rooms/:slug` targets an active room THEN the API SHALL return it with `photos[]`; IF the room is inactive or unknown THEN 404 `NOT_FOUND`. [NUC-75]
3. WHEN `GET /api/public/catalog` is called THEN the API SHALL return active public hourly categories (rates, window, weekdays, minimum duration, `isReference`) and block categories (price, window, `averageHourlyCents`), excluding inactive and `admin_only` ones. [NUC-76]
4. WHEN `GET /api/public/rooms/:slug/availability?date` is called THEN the API SHALL return `window`, `slotMinutes`, `minBookingMinutes` and cells `{ startMinute, available, maxEndMinute }` and SHALL NOT expose admin states, customer names, block tags or cleanup periods. [NUC-77]
5. WHEN the date is a holiday THEN the day response SHALL carry `isHoliday: true` and `holidayName`; WHEN the date is closed THEN it SHALL carry `closed: true` and no cells. [NUC-78]
6. WHEN `GET /api/public/rooms/:slug/availability/month?month=YYYY-MM` is called THEN the API SHALL return each day with status `available`, `full`, `closed`, `past` or `out_of_range` (after today + max advance) plus holiday name, computed with one occupancy query for the month. [NUC-79]
7. The availability computation SHALL treat `awaiting_payment` and `pre_reserved` bookings whose `hold_expires_at ≤ now` as free. [NUC-80]
8. IF one IP exceeds 120 requests per minute on availability or quote endpoints THEN the API SHALL return 429 `TOO_MANY_ATTEMPTS` with `Retry-After`. [NUC-81]
9. IF `date` or `month` is malformed THEN the API SHALL return 422 `VALIDATION_FAILED`. [NUC-82]
10. WHEN a block category applies to the date THEN the day response SHALL list it in `blockOptions[]` with its window, price and `available` (true only when the whole window is a valid interval). [NUC-83]
11. WHEN `GET /api/public/clinic` is called THEN the API SHALL return `addressLine`, `whatsappE164`, `contactEmail` and the 8 business-hours rows. [NUC-84]
12. WHEN `GET /api/public/policies` is called THEN the API SHALL return the current `policy.version`, the policy values and the `renderPolicyText` sections. [NUC-85]

**Independent Test**: integration tests seeding bookings and blocks; response parsed by core contracts.

---

### P1: Book and pay the sinal ⭐ MVP

**User Story**: As a tenant, I want to choose room, date and time, see the final price and pay online, so that my slot is guaranteed at once (US-02).

**Why P1**: The MVP definition.

**Acceptance Criteria**:

1. WHEN `POST /api/public/bookings/quote` receives a valid room, date and interval THEN the API SHALL return the priced segments, gross, discount (`none` by default), net, `payment` (split result), `policyVersion`, `holdMinutes` and memory `lines[]`, without writing any row. [NUC-86]
2. IF the quoted interval is invalid THEN the API SHALL return 422 `SLOT_UNAVAILABLE` with `details.reason` and the `rejectMessage` text; IF it has no category THEN 422 `NO_CATEGORY` with the uncovered range. [NUC-87]
3. IF a quote or booking names a block category and the interval differs from the block window THEN the API SHALL return 422 with path `startMinute`. [NUC-88]
4. IF the tenant's e-mail is not verified THEN `POST /api/app/bookings` SHALL return 403 `EMAIL_NOT_VERIFIED`. [NUC-89]
5. IF the tenant has no CPF/CNPJ THEN `POST /api/app/bookings` SHALL return 422 `PROFILE_INCOMPLETE` "Complete seu cadastro com CPF ou CNPJ para reservar." [NUC-90]
6. IF `acceptPolicy` is not true THEN the API SHALL return 422, and IF `policyVersion` differs from the current `policy.version` THEN 409 `POLICY_CHANGED`; WHEN accepted THEN a `booking_policy` consent with version `policy-v<n>`, IP and `ref = ('booking', id)` SHALL be recorded. [NUC-91]
7. IF `expectedTotalCents` differs from the server-computed net THEN the API SHALL return 409 `PRICE_CHANGED` with the fresh quote in `details.quote`. [NUC-92]
8. WHEN the booking is created THEN the API SHALL return 201 with status `awaiting_payment`, `hold_expires_at = now + payment.checkout_hold_minutes`, an occupancy `[start, end + cleanup)`, frozen segments, `cleanup_minutes`, `policy_snapshot`, a code `BRV-` + 6 base32 characters and a unique `ics_uid`. [NUC-93]
9. IF the occupancy insert violates the exclusion constraint THEN the API SHALL return 409 `SLOT_TAKEN` "Este horário acabou de ser reservado.", and of two concurrent requests for the same slot exactly one SHALL get 201. [NUC-94]
10. IF the `Idempotency-Key` header is missing on a money-moving POST THEN the API SHALL return 400 `BAD_REQUEST`; WHEN a key is replayed with the same body THEN it SHALL return the stored status and body; IF the same key comes with a different body THEN 422 `IDEMPOTENCY_MISMATCH`. [NUC-95]
11. IF the tenant already has 3 active `awaiting_payment` bookings THEN the API SHALL return 429 `TOO_MANY_ATTEMPTS` "Você já tem 3 reservas aguardando pagamento." [NUC-96]
12. IF `payNowCents` is 0 at creation (credits or discounts cover the sinal or the total) THEN the booking SHALL be created `confirmed` (or `paid` when the balance is also 0) without a gateway charge and SHALL get the confirmation e-mail. [NUC-207]
13. WHEN a booking is created over stale holds (hold expired, job not run yet) THEN those holds SHALL be expired in the same transaction before the occupancy insert. [NUC-97]
14. The booking flow SHALL show a stepper with exactly four steps "Sala e data", "Horário", "Resumo", "Pagamento", on `/reservar` and `/app/reservar`, keeping the selection in the URL (`sala, data, inicio, fim` or `bloco`). [NUC-98]
15. WHEN the tenant picks a start cell THEN the Horário step SHALL offer only startable cells and durations from the minimum up to `maxEndMinute` in slot steps, plus available block options. [NUC-99]
16. WHEN the Resumo step renders THEN it SHALL show one line per segment ("17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00"), total, sinal with its date, saldo with charge date, the policy text and an unchecked acceptance checkbox that keeps "Continuar para pagamento" disabled. [NUC-100]
17. WHEN an anonymous visitor continues from Resumo THEN the flow SHALL send them to login or signup with `next` back to the same Resumo URL, and after authentication the selection SHALL be intact. [NUC-101]
18. WHILE the checkout page is open the page SHALL show a countdown to `holdExpiresAt`, and WHEN it reaches zero THEN it SHALL show "Tempo esgotado. O horário foi liberado." with a link to choose a new time. [NUC-102]
19. WHILE the booking is `awaiting_payment` the checkout page SHALL poll the booking every 2 s and WHEN it becomes `confirmed` or `paid` THEN it SHALL show "Reserva confirmada" with the code and a link to Minhas reservas. [NUC-103]
20. WHERE checkout steps are registered, the quote pipeline SHALL apply them in ascending `order` (discount 100, package 200, extras 300, credit 400) after base pricing and before `splitPayment`, and booking creation SHALL call each step's `persist` in the booking transaction. [NUC-104]

**Independent Test**: integration tests for quote/create; flow tests with MSW; Playwright smoke (T49).

---

### P1: Gateway-independent payments ⭐ MVP

**User Story**: As the clinic, I want every charge to go through one gateway interface with idempotent webhooks and reconciliation, so that payments are reliable and the gateway is replaceable (PRD §8, §7.6).

**Why P1**: PRD §8 "Gateway de pagamento genérico (obrigatório)".

**Acceptance Criteria**:

1. The `PaymentGateway` interface SHALL declare `createCharge`, `chargeSavedCard`, `getStatus`, `cancelCharge`, `refund`, `ensureCustomer`, `saveCard`, `parseWebhook` and `verifyCredentials`, implemented by the `sandbox` and `mercadopago` adapters. [NUC-105]
2. The resolver SHALL use `payment.active_gateway` for new charges and the charge's stored `provider` for status, cancel and refund calls. [NUC-106]
3. WHEN the booking owner calls `POST /api/app/bookings/:id/pay { method }` on an `awaiting_payment` or `pre_reserved` booking THEN the API SHALL create a `booking_deposit` or `booking_full` charge for `payNowCents` with an idempotency key and return `{ chargeId, method, status, amountCents, expiresAt, pixQrCodeBase64, pixCopyPaste, checkoutUrl }`, Pix expiring at `hold_expires_at`. [NUC-107]
4. IF the hold has expired THEN the pay endpoint SHALL return 409 `HOLD_EXPIRED`; IF the booking is in another status THEN 409 `INVALID_TRANSITION`; IF the caller is not the owner THEN 404 `NOT_FOUND`. [NUC-108]
5. WHEN a pending charge of the same booking and purpose exists THEN the pay endpoint SHALL return it for the same method, and for another method SHALL cancel it at the gateway and create a new one. [NUC-109]
6. IF the booking has no `booking_policy` consent THEN the pay endpoint SHALL require `acceptPolicy: true` and the snapshot `policyVersion` (422 `POLICY_ACCEPTANCE_REQUIRED` otherwise) and SHALL record the consent. [NUC-110]
7. IF the gateway call fails or exceeds 10 s THEN the API SHALL return 502 `GATEWAY_ERROR` "Não foi possível iniciar o pagamento. Tente novamente." and keep the charge `pending` for reconciliation. [NUC-111]
8. IF a webhook signature is invalid THEN `POST /api/webhooks/pagamentos/:provider` SHALL return 401 and insert no `webhook_events` row; IF the provider is unknown THEN 404. [NUC-112]
9. WHEN a valid webhook repeats `(provider, external_id, external_status)` THEN the API SHALL return 200 without reprocessing. [NUC-113]
10. WHEN the Mercado Pago adapter handles a webhook THEN it SHALL re-fetch the payment from the provider and use that status, never the payload's. [NUC-114]
11. WHEN a charge is approved THEN its booking SHALL become `confirmed` (deposit) or `paid` (full, balance, or difference leaving 0), `paid_cents` SHALL increase by the amount, each checkout step's `onConfirmed` SHALL run, and `NotificationPort.notifyStaff('payment_received')` SHALL be called after commit. [NUC-115]
12. IF the approved amount differs from the charge amount THEN the booking SHALL stay unchanged, audit `payment.amount_mismatch` SHALL be written and staff notified. [NUC-116]
13. WHEN a deposit/full charge is approved for an `expired` booking THEN the system SHALL reinstate it (`confirmed`/`paid`, event reason `late_approval`) if its occupancy can be re-inserted, else refund the charge in full and send `booking.late_approval_refund` with 3 alternative free slots of the same duration in the next 14 days. [NUC-117]
14. WHEN a charge is rejected THEN it SHALL become `rejected`, the booking SHALL keep its hold, and the checkout page SHALL show "Pagamento recusado. Tente outro método." [NUC-118]
15. WHEN a refund is requested THEN a `refunds` row SHALL be written `pending`, the gateway called after commit, and on success the refund SHALL become `approved` with the charge `refunded`/`partially_refunded`; IF the gateway fails THEN `attempts` and `last_error` SHALL be updated for the reconcile job. [NUC-119]
16. WHEN a sandbox charge is approved or rejected on `/pagamento/sandbox/:chargeId` THEN the API SHALL emit a signed sandbox webhook through the same pipeline as real providers. [NUC-120]
17. IF `NEON_BRANCH` is `production` and the caller of the sandbox approve/reject endpoint is not an MFA-verified staff session THEN the API SHALL return 403 `FORBIDDEN`. [NUC-121]
18. WHEN the Mercado Pago adapter creates a Pix charge THEN it SHALL `POST /v1/payments` with `transaction_amount` in reais, `payment_method_id: 'pix'`, `date_of_expiration`, `external_reference = charge id` and header `X-Idempotency-Key`, and SHALL map `qr_code` and `qr_code_base64`. [NUC-122]
19. WHEN the Mercado Pago adapter creates a card charge THEN it SHALL create a Checkout Pro preference with `external_reference = charge id`, `expiration_date_to = hold`, back URLs to `/checkout/:bookingId`, and return its `init_point` as `checkoutUrl`. [NUC-123]
20. WHEN the Mercado Pago adapter parses a webhook THEN it SHALL validate `x-signature` (`ts`, `v1`) as HMAC-SHA256 of `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with the stored webhook secret. [NUC-124]
21. IF the active gateway is `mercadopago` and its credentials are absent THEN creating a charge SHALL return 503 `GATEWAY_NOT_CONFIGURED`. [NUC-125]
22. WHEN `POST /api/app/cards { cardToken, recurringConsent: true }` is called THEN the API SHALL ensure the gateway customer, save the card, store brand, last4, expiry and `recurring_consent_at`, record a `recurring_charge` consent and return the card; IF `recurringConsent` is not true THEN 422. [NUC-126]
23. WHEN `DELETE /api/app/cards/:id` is called by its owner THEN the card SHALL get `deleted_at` and never be charged again. [NUC-127]
24. The API SHALL never accept, store or log card numbers or CVV; card data only reaches the gateway's tokenizer or hosted page. [NUC-128]
25. WHEN `GET /api/public/payment-config` is called THEN the API SHALL return `{ provider, publicKey, environment }` with `publicKey` null for the sandbox. [NUC-129]
26. The payments module SHALL export `listGatewayAdapters()` returning `{ provider, label, credentialFields: { key, label, secret }[] }` per adapter and `verifyCredentials(creds, environment)` returning `{ ok, message }` (sandbox always ok; Mercado Pago `GET /users/me`), for the `gestao` Integrações screen. [NUC-208]

**Independent Test**: adapter unit tests with `fetch` stubbed; webhook integration tests; sandbox approval end to end.

---

### P1: Balance charge, reminders and deadline ⭐ MVP

**User Story**: As a tenant, I want the balance charged or reminded automatically, so that I do not lose my booking (US-03).

**Why P1**: PRD §5.4.

**Acceptance Criteria**:

1. WHEN the balance job finds a `confirmed` booking with balance > 0, `balance_charge_at ≤ now` and no pending or approved balance charge THEN it SHALL charge the newest saved card with recurring consent, or else create a Pix charge expiring at `balance_due_at` and send `booking.balance_charge`. [NUC-130]
2. IF the saved-card charge is rejected THEN the job SHALL create the Pix charge and send `booking.balance_card_failed`. [NUC-131]
3. WHEN `balance_due_at ≤ now` and the balance is unpaid THEN the job SHALL set `cancelled_nonpayment`, retain the paid sinal, release the occupancy, cancel the pending charge and send `booking.cancelled_nonpayment`. [NUC-132]
4. WHEN a pending Pix balance exists at each hour of `payment.balance_reminder_hours_before` (48, 36, 26) before start THEN the job SHALL send `booking.balance_reminder` once per (booking, hour) using dedupe key `balance_reminder:<id>:<h>`. [NUC-133]
5. WHEN the owner calls `POST /api/app/bookings/:id/pay-balance { method }` on a `confirmed` booking with balance > 0 before `balance_due_at` THEN the API SHALL create a balance charge for `balance_cents` and return the charge intent. [NUC-134]
6. The balance charge purpose SHALL be `booking_difference` when the booking already has an approved `booking_balance` or `booking_full` charge, else `booking_balance`. [NUC-135]

**Independent Test**: job integration tests with injected `now`.

---

### P1: Confirmation e-mails with .ics ⭐ MVP

**User Story**: As a tenant, I want a confirmation with a calendar invite and updates on changes, so that my agenda stays right (US-02, §7.2).

**Why P1**: US-02 "recebe e-mail com o convite .ics".

**Acceptance Criteria**:

1. WHEN a booking becomes `confirmed` or `paid` for the first time THEN the system SHALL queue `booking.confirmed` (subject "Reserva confirmada — <código>") with an `.ics` attachment `METHOD:REQUEST`, `UID` = `ics_uid`, `SEQUENCE` = `ics_sequence`, `DTSTART`/`DTEND` of the booking (cleanup excluded), `SUMMARY` "Reserva Bravô Clinic — <sala>" and `LOCATION` = `clinic.address_line`. [NUC-136]
2. WHEN a booking is rescheduled THEN `ics_sequence` SHALL increase by 1 and `booking.rescheduled` SHALL carry the new times; WHEN it is cancelled or cancelled for non-payment THEN `ics_sequence` SHALL increase by 1 and the e-mail SHALL carry `METHOD:CANCEL` with the same UID. [NUC-137]
3. WHEN a `confirmed` or `paid` booking is 24 h and 2 h from its start THEN the reminders job SHALL send `booking.reminder_24h` and `booking.reminder_2h` once each (dedupe `booking_reminder:<id>:24` and `:2`). [NUC-138]
4. The `.ics` builder SHALL emit CRLF line endings, fold lines longer than 75 octets and escape commas, semicolons and backslashes per RFC 5545. [NUC-139]
5. WHEN the owner calls `GET /api/app/bookings/:id/ics` THEN the API SHALL return `text/calendar` with the same event. [NUC-140]

**Independent Test**: ICS unit tests; outbox rows asserted in integration tests.

---

### P1: Reschedule and cancel ⭐ MVP

**User Story**: As a tenant, I want to reschedule or cancel following clear rules and see what I keep and get back, so that I handle the unexpected (US-05).

**Why P1**: PRD §5.5.

**Acceptance Criteria**:

1. WHEN the owner calls `GET /api/app/bookings/:id` THEN the response SHALL include `actions { canPay, canPayBalance, canReschedule, rescheduleBlockedReason, canCancel }` computed from status, snapshot policy and `now`. [NUC-141]
2. WHEN `POST /api/app/bookings/:id/reschedule/quote { roomSlug?, date, startMinute, endMinute }` is called THEN the API SHALL return `{ allowed, reason, message, newQuote, settlement }` using `evaluateReschedule`, `validateInterval` and `settleReschedule`. [NUC-142]
3. IF the reschedule is not allowed THEN `POST /api/app/bookings/:id/reschedule` SHALL return 422 `POLICY_VIOLATION` with `details.reason` (`too_late`, `limit_reached`, `beyond_window`) or 422 `SLOT_UNAVAILABLE`. [NUC-143]
4. WHEN the new net is equal or lower THEN the API SHALL move the booking at once (occupancy, segments, totals, deposit cap, `reschedule_count + 1`, `ics_sequence + 1`, event `rescheduled`) and return `creditCents` from `settleReschedule`. [NUC-144]
5. WHEN `creditCents > 0` THEN the system SHALL call `CreditPort.grant` with source `reschedule_difference`; WHILE the default deferred port is installed the grant SHALL be recorded as `booking_events.data.creditGrant = { amountCents, status: 'deferred' }`. [NUC-145]
6. WHEN the new net is higher THEN the API SHALL hold the new slot with a system block "Reagendamento em pagamento" for `payment.checkout_hold_minutes`, create a `booking_reschedule_requests` row and a `booking_difference` charge for `payNowCents`, return 202 with the charge intent, and apply the move only when the charge is approved. [NUC-146]
7. WHEN a reschedule request expires unpaid THEN the job SHALL cancel the hold block and the charge and leave the booking unchanged; IF its charge is approved later and the new slot is no longer free THEN the difference SHALL be refunded. [NUC-147]
8. WHEN the booking's payment mode is `package` or `subscription` THEN reschedule and cancellation SHALL delegate minutes to the registered `PaymentModeHandler`; IF none is registered THEN the API SHALL return 422 `POLICY_VIOLATION` with reason `unsupported_payment_mode`. [NUC-148]
9. WHEN an admin calls `POST /api/admin/bookings/:id/reschedule` with `exception: true` and a justification THEN the policy check SHALL be bypassed, audit `booking.reschedule_exception` written, and a higher price handled by `differenceHandling` `add_to_balance` (balance and schedule recomputed) or `waive` (audit `booking.difference_waived`). [NUC-149]
10. WHEN the owner calls `GET /api/app/bookings/:id/cancellation-preview` THEN the API SHALL return `{ retainedCents, refundCents, minutesReturned, creditCents }` from `evaluateCancellation` with the booking's snapshot policy. [NUC-150]
11. WHEN the owner confirms `POST /api/app/bookings/:id/cancel` on a `confirmed` or `paid` booking THEN it SHALL become `cancelled_by_tenant`, refunds for `refundCents` SHALL be created from the most recent approved charges first, the occupancy released, checkout-step `release` hooks called, `booking.cancelled` sent and staff notified. [NUC-151]
12. WHEN the owner cancels an `awaiting_payment` booking THEN it SHALL become `cancelled_by_tenant` with no refund and its pending charges cancelled. [NUC-152]
13. WHEN an admin calls `POST /api/admin/bookings/:id/cancel { reason, resolution }` THEN the booking SHALL become `cancelled_by_clinic` with the whole paid amount refunded (`refund`) or granted through `CreditPort` (`credit`, only when the port is live, else 422), audit `booking.cancel_by_clinic` and the customer notified at once. [NUC-153]
14. WHEN booking detail shows `canReschedule = false` THEN the page SHALL hide "Reagendar" and show "Fale com a recepção" linking to `https://wa.me/<whatsapp>`. [NUC-154]
15. WHEN the tenant reviews a reschedule THEN the modal SHALL show the new price and either "Você recebe R$ X em créditos" or "Diferença a pagar agora: R$ X" before confirming. [NUC-155]
16. WHEN the tenant opens "Cancelar reserva" THEN the modal SHALL show "Fica retido: R$ X (sinal)" and "Será devolvido: R$ Y" (or minutes/credit) from the preview before the confirm button. [NUC-156]

**Independent Test**: integration tests per W-ST/W-CA row; modal tests with MSW.

---

### P1: Gestão de Reservas operations ⭐ MVP

**User Story**: As the Administrador geral or reception, I want a week/month calendar of all bookings with hover details and quick actions, and to create bookings and pre-reservations for customers, so that I run the day (US-13, US-14).

**Why P1**: Reception operation from day one.

**Acceptance Criteria**:

1. WHEN a staff user calls `GET /api/admin/calendar/events?from&to&roomId&status&categoryId` for a range of at most 42 days THEN the API SHALL return bookings (first name, full name, room, status, paid, total, start, end, cleanup end, category names, checked-in), blocks (tag), closed days and holidays; IF the range exceeds 42 days THEN 422. [NUC-157]
2. WHEN Gestão de Reservas renders the week or month view THEN each booking SHALL show the customer's first name and room name, blocks SHALL show their tag, cleanup SHALL be shaded, and filters for room, status and category plus a status legend SHALL be available. [NUC-158]
3. WHEN the pointer hovers or focuses a booking THEN a popup SHALL show full name, room, paid and total, start–end, category and status badge, and the actions allowed for the role and status: Confirmar (admin, pre-reservation/awaiting), Reenviar link, Reagendar (admin), Cancelar (admin), Check-in. [NUC-159]
4. WHEN the pointer hovers or focuses a free slot THEN a menu SHALL offer "Criar pré-reserva", "Criar reserva" and "Bloquear", plus actions contributed by the `admin.calendar.freeSlotActions` web slot. [NUC-160]
5. WHEN a staff user calls `POST /api/admin/bookings { userId, roomId, date, startMinute, endMinute, kind: 'booking' }` THEN the API SHALL create an `awaiting_payment` booking with the checkout hold, `source = 'admin'`, a payment link token and the `booking.pre_reservation_link` e-mail. [NUC-161]
6. WHEN the same call has `kind: 'pre_reservation'` and `expiresInHours` (1–720, default `payment.pre_reservation_expiry_hours`) THEN the booking SHALL be `pre_reserved` with that hold and the e-mail SHALL link `/pre-reserva/<token>`. [NUC-162]
7. WHEN an admin sends `confirmManually: true` with a justification on creation, or calls `POST /api/admin/bookings/:id/confirm-manual` on a pre-reservation or awaiting booking THEN it SHALL become `confirmed` with `payment_mode = 'manual'`, `confirmed_manually_by`, no balance schedule, audit `booking.confirm_manual`; IF the caller is reception THEN 403. [NUC-163]
8. WHEN `POST /api/admin/bookings/:id/resend-link` is called THEN a new token SHALL replace the old one (the old link returns 404) and the e-mail SHALL be sent again. [NUC-164]
9. WHEN `GET /api/public/pre-reservations/:token` matches a holding booking THEN the API SHALL return its summary and booking id; IF the token is unknown or the hold expired THEN 404. [NUC-165]
10. WHEN a pre-reservation's hold passes THEN the expiry job SHALL set it `expired`, release the slot, send `booking.pre_reservation_expired` to the customer and call `notifyStaff('pre_reservation_expired')`. [NUC-166]
11. WHEN a staff user calls `POST /api/admin/bookings/:id/check-in` on a `confirmed` or `paid` booking between 60 min before start and its end THEN `checked_in_at` SHALL be set with audit `booking.check_in`; IF outside that window THEN 409 `INVALID_STATE` "Check-in disponível de 1h antes até o fim da reserva." [NUC-167]
12. WHEN `policy.no_show_after_minutes` passes after start without check-in THEN the no-shows job SHALL set `no_show`; WHEN a checked-in booking ends THEN it SHALL set `completed`. [NUC-168]
13. WHEN a staff user calls `GET /api/admin/customers/search?q` with at least 2 characters THEN the API SHALL return up to 20 tenants matching name, e-mail or document digits; WHEN `POST /api/admin/customers { name, email, phone, document }` is valid THEN it SHALL create a verified-email tenant without password and queue `account.set_password` with a 72 h link; duplicates SHALL return 409 `EMAIL_TAKEN`/`DOCUMENT_TAKEN`. [NUC-169]
14. WHEN the staff user opens "Criar reserva" or "Criar pré-reserva" THEN a drawer SHALL let them search or create the customer, pick room, date and times validated against availability, see the quote, set the expiry (pre-reservation) and, for admins only, "Confirmar sem pagamento" with justification, and on success show the payment link with a copy button. [NUC-170]
15. WHEN a customer opens `/pre-reserva/:token` THEN the page SHALL ask for login when anonymous, show "Este link pertence a outra conta." when the session user differs, and otherwise open the checkout of that booking. [NUC-171]

**Independent Test**: integration tests per route and role; calendar and drawer tests with MSW.

---

### P1: Payment, reschedule and cancellation policies panel ⭐ MVP

**User Story**: As the Administrador geral, I want to edit every §5.4 and §5.5 parameter, so that I adjust policy without a developer (US-15).

**Why P1**: PRD "Nada é fixo no código".

**Acceptance Criteria**:

1. WHEN an admin calls `GET /api/admin/settings/policies` THEN the API SHALL return every `payment.*`, `policy.*` (except `policy.version`, read-only) and `credits.validity_days` key with its value; reception SHALL get 403. [NUC-172]
2. IF `PUT /api/admin/settings/policies` sets `balance_deadline_hours_before ≥ balance_charge_hours_before`, or reminder hours that are not strictly descending within [deadline, charge] THEN the API SHALL return 422 with the field paths. [NUC-173]
3. WHEN a PUT changes at least one value THEN the API SHALL save all values, increment `policy.version` by 1 and write audit `settings.policy_update` with before/after; WHEN it changes nothing THEN the version SHALL stay. [NUC-174]
4. The cancellation, reschedule and balance rules SHALL use the booking's `policy_snapshot`, so a booking created under version 1 SHALL keep its rules after version 2. [NUC-175]
5. WHEN the admin opens Políticas THEN the panel SHALL group the fields in "Sinal e saldo", "Checkout e pré-reserva", "Reagendamento", "Cancelamento e no-show", "Assinaturas e horas extras", "Créditos", show the current version, and show the rendered policy preview updating as values change. [NUC-176]

**Independent Test**: integration tests for PUT and snapshot; panel test with MSW.

---

### P1: Bookings list and CSV export ⭐ MVP

**User Story**: As the Administrador geral or reception, I want a searchable table of bookings with CSV export, so that I answer questions and reconcile quickly (§7.3.2).

**Why P1**: PRD §7.3.2 "Lista de reservas".

**Acceptance Criteria**:

1. WHEN a staff user calls `GET /api/admin/bookings?q&status&roomId&categoryId&from&to&cursor` THEN the API SHALL return pages of at most 50 rows ordered by start descending, where `q` matches code, customer name or e-mail case-insensitively. [NUC-177]
2. WHEN `GET /api/admin/bookings/export.csv` is called with the same filters THEN the API SHALL return `text/csv; charset=utf-8` with a BOM, `;` separator, header `Código;Cliente;E-mail;Sala;Início;Fim;Status;Total (R$);Pago (R$);Saldo (R$);Origem`, dates `dd/mm/aaaa HH:mm` in São Paulo time and amounts like `1600,00`; IF more than 5 000 rows match THEN 422 "Refine os filtros (máximo de 5.000 linhas)." [NUC-178]
3. WHEN the staff user types in the list search or changes a filter THEN the table SHALL refetch with the filters kept in the URL, sort by start, paginate with "Carregar mais" and download the CSV with "Exportar CSV". [NUC-179]

**Independent Test**: integration test on CSV bytes; table test with MSW.

---

### P1: Public site pages ⭐ MVP

**User Story**: As a visitor, I want Salas, Página da Sala, Preços, Políticas, Contato, Termos and Privacidade pages with live data, so that I trust the clinic and book (US-01, §7.1).

**Why P1**: PRD §7.1 page list.

**Acceptance Criteria**:

1. WHEN `/salas` loads THEN it SHALL render one RoomCard per active room with cover (or `/room-placeholder.webp`), "ideal para" tags and "A partir de R$ 80,00/h" from `fromPriceCents`. [NUC-180]
2. WHEN the Home loads THEN its RoomCards and simulator SHALL use the catalog API and `priceHourlyBooking`, so the simulator values follow the current prices (factory values unchanged from FND-100). [NUC-181]
3. WHEN `/salas/:slug` loads THEN it SHALL show the gallery, description, equipment, categories with rates and average hourly value, a month availability calendar with holiday markers ("Feriado: <nome>"), and on day click the slot grid with "Reservar este horário" linking to `/reservar?sala=&data=&inicio=&fim=`; an unknown slug SHALL render the 404 page. [NUC-182]
4. WHEN `/precos` loads THEN it SHALL list hourly categories (weekday and weekend rates, minimum duration, window) and block categories with average hourly value, followed by the `pricing.packages` web slot. [NUC-183]
5. WHEN `/politicas` loads THEN it SHALL render the sections of `GET /api/public/policies`. [NUC-184]
6. WHEN `/contato` loads THEN it SHALL show the address, WhatsApp link, contact e-mail when set, business hours per day and the link "Abrir no Google Maps" to `https://www.google.com/maps/search/?api=1&query=Praia%20Brava%2C%20Itaja%C3%AD%20-%20SC`. [NUC-185]
7. WHEN `/termos` or `/privacidade` loads THEN it SHALL render its Markdown content with the line "Versão terms-2026-10" or "Versão privacy-2026-10". [NUC-186]
8. WHILE `pricesReviewed` is false the booking flow SHALL show the banner "Reservas online abrem em breve. Fale com a recepção pelo WhatsApp." and disable "Continuar para pagamento" for tenants. [NUC-187]

**Independent Test**: page tests with MSW fixtures.

---

### P1: Minhas reservas, agenda and profile ⭐ MVP

**User Story**: As a tenant, I want my bookings by tab with payment status, a calendar view, my saved cards and a complete profile, so that I organize my work (US-04).

**Why P1**: PRD §7.2 app core.

**Acceptance Criteria**:

1. WHEN the owner calls `GET /api/app/bookings?tab=upcoming|past|cancelled` THEN the API SHALL return `upcoming` = holding/confirmed/paid ending after now by start ascending, `past` = completed, no-show or ended by start descending, `cancelled` = expired and cancelled statuses by start descending, each with `paymentStatus` from `paymentStatusOf` and `group` (null in núcleo). [NUC-188]
2. WHEN `/app/minhas-reservas` renders THEN it SHALL show tabs Próximas, Passadas, Canceladas with code, room, date/time, status badge and payment status, grouping rows with the same `group.id` under one header. [NUC-189]
3. WHEN `/app/agenda` renders THEN it SHALL show the tenant's bookings in month, week and day views with previous/next/today navigation and SHALL NOT show cleanup. [NUC-190]
4. WHEN `/app` renders THEN it SHALL list the next 3 upcoming bookings and a "Reservar" button. [NUC-191]
5. WHEN `PATCH /api/app/me` receives name, phone, profession or registry THEN the API SHALL update them; WHEN it receives a document and the user has none THEN it SHALL validate and save it; IF the user already has a document THEN 422; IF the document belongs to another user THEN 409 `DOCUMENT_TAKEN`. [NUC-192]
6. WHEN `/app/perfil?completar=1` loads THEN the profile page SHALL highlight the CPF/CNPJ field and, after saving, return to the `next` booking URL when present. [NUC-193]
7. WHEN `/app/perfil/cartoes` loads THEN it SHALL list saved cards (brand, final, expiry), remove a card after confirmation, and add a card through the active provider's tokenizer with the consent text "Autorizo cobranças automáticas deste cartão para saldos e renovações." required. [NUC-194]

**Independent Test**: integration tests on the list API; page tests with MSW.

---

### P1: Scheduled jobs ⭐ MVP

**User Story**: As the clinic, I want expirations, balances, reminders, no-shows and reconciliation to run on their own, so that nobody operates them by hand (AD-007).

**Why P1**: PRD §8 cron triggers.

**Acceptance Criteria**:

1. IF a `/jobs/<name>` request is not a verified Neon trigger delivery THEN the API SHALL return 401 and run nothing; WHEN it is verified THEN the job SHALL run and write a `job_runs` row with `ok` and stats, or `error` and the message. [NUC-195]
2. WHILE a run of a job holds its advisory lock, a second run of the same job SHALL return immediately with stats `{ skipped: true }`. [NUC-196]
3. WHEN `expire-holds` runs THEN every `awaiting_payment`/`pre_reserved` booking of kind `single` with `hold_expires_at ≤ now` SHALL become `expired` (fixed occurrences belong to `receita`'s purchase job) with its occupancy released, its pending charges cancelled, checkout-step `release` hooks called, and expired reschedule requests SHALL release their hold blocks. [NUC-197]
4. WHEN `reconcile-payments` runs THEN pending charges older than 2 min with an external id SHALL be refreshed through `getStatus` and applied by the same effects as webhooks, pending charges without external id older than 10 min SHALL become `cancelled`, and pending refunds SHALL be retried up to 5 attempts, then `failed` with staff notification. [NUC-198]
5. The root `neon.ts` SHALL declare schedule triggers `*/5 * * * *` for `/jobs/expire-holds`, `/jobs/charge-balances`, `/jobs/reminders`, `/jobs/no-shows`, `/jobs/reconcile-payments` and `0 8 * * *` for `/jobs/materialize-blocks`. [NUC-199]
6. WHEN `expire-holds` runs THEN expired `idempotency_keys` SHALL be deleted; WHEN `materialize-blocks` runs THEN `job_runs` older than 30 days SHALL be deleted. [NUC-200]

**Independent Test**: job functions invoked with injected `now`; route test with a stubbed trigger verifier.

---

### P1: Extension points for receita and gestao ⭐ MVP

**User Story**: As the developer of `receita` or `gestao`, I want registered ports and web slots, so that packages, coupons, credits, extras and notifications plug in without rewriting núcleo (AD-033).

**Why P1**: The next two features depend on them.

**Acceptance Criteria**:

1. The API extension registry SHALL expose `checkoutSteps`, `paymentModeHandlers`, `credits`, `closedDayCompensation`, `availabilityDecorators`, `categoryHandlers`, `notifications` and `roomMedia`, `chargeHandlers` (by purpose `subscription_initial`, `subscription_renewal`, `extra_hours`, `extra_service`), with núcleo defaults: no steps, handlers for `deposit_balance`/`full_upfront`/`manual`, a deferred credit port with 0 available, zero compensation, no decorators, no extra category types (handlers may define `onUpdate`), no charge handlers, a no-op notifier accepting `new_booking`, `payment_received`, `booking_cancelled`, `pre_reservation_expired`, `payment_issue`, `new_subscription`, `renewal_failed`, and a null photo URL. [NUC-201]
2. WHERE an `AvailabilityDecorator` is registered, public day cells SHALL carry its `discountPercent`, and the SlotGrid SHALL render it as "−<n>%". [NUC-202]
3. The web slot registry SHALL define `pricing.packages`, `checkout.summary.discount`, `checkout.summary.credits`, `checkout.summary.payWith`, `checkout.summary.extras`, `booking.detail.extra`, `admin.calendar.freeSlotActions`, `admin.calendar.overlays`, `admin.categories.forms`, `admin.reservations.tabs` and `admin.reservations.headerActions`, each rendering nothing by default. [NUC-203]
4. The calendar module SHALL export `importNationalHolidays(db, year, deps)` used by the admin import route and available to `gestao` jobs. [NUC-204]
5. WHEN a booking is created, confirmed, cancelled or a pre-reservation expires THEN the service SHALL call `NotificationPort.notifyStaff(event, payload)` after commit, and a notifier error SHALL be logged without failing the request or job. [NUC-205]

6. WHEN `applyProviderStatus` handles a charge whose purpose is not a booking purpose THEN it SHALL call the registered `chargeHandlers[purpose].onApproved` or `onFailed` inside the same locked transaction, and the services `createCharge`, `submitCharge`, `refundCharge` and `cancelCharge` SHALL work for charges without `booking_id`. [NUC-209]
7. WHEN a checkout step's `release` runs for a cancellation THEN it SHALL receive the `evaluateCancellation` result, so a step can return the credit portion of the refund. [NUC-210]

**Independent Test**: unit tests on the registry defaults; one API test registering a fake checkout step, decorator and charge handler.

---

### P2: Booking funnel analytics

**User Story**: As the clinic, I want funnel events from day one, so that conversion is measurable (PRD §3).

**Why P2**: No analytics account exists yet.

**Acceptance Criteria**:

1. WHERE `VITE_GA4_ID` is set, the web SHALL load GA4 and push `view_room`, `select_slot`, `begin_checkout` and `purchase` (with booking code and value) to `dataLayer`; WHERE it is unset `track()` SHALL do nothing and load no script. [NUC-206]

---

## Edge Cases

- IF a tenant pays a Pix after the hold expired and another tenant already holds the slot THEN the system SHALL refund automatically and send `booking.late_approval_refund` (NUC-117).
- IF two webhooks for the same approval arrive concurrently THEN exactly one SHALL apply the effects (unique `webhook_events` + guarded charge update) (NUC-113).
- IF the expiry job and a webhook approval race on the same booking THEN the row lock SHALL serialize them and the loser SHALL follow the late-approval path or no-op (NUC-117, NUC-197).
- IF an attacker posts a fake webhook with an invalid signature before the real one THEN the real one SHALL still be processed, because invalid deliveries never reach `webhook_events` (NUC-112).
- IF a booking crosses midnight THEN it SHALL be rejected `outside_hours`, because `close_minute ≤ 1440` (NUC-11).
- WHEN the Brazilian DST rules change THEN instants SHALL still be computed through `localToUtc` with the IANA zone (fundação FND-12) (NUC-12).
- IF a category price changes while a tenant sits on Resumo THEN booking creation SHALL return `PRICE_CHANGED` with the new quote (NUC-92).
- IF the policy changes while a tenant sits on Resumo THEN booking creation SHALL return `POLICY_CHANGED` and the page SHALL reload the text and require acceptance again (NUC-91).
- IF a closed day is created for a room while a recurring block exists that day THEN the block SHALL stay (no booking is affected) (NUC-49).
- IF the admin deactivates every hourly category THEN availability SHALL show cells but quotes SHALL return `NO_CATEGORY`, and the overlay SHALL hatch the whole window (NUC-20, NUC-72).
- IF BrasilAPI returns a holiday already seeded with another name THEN the import SHALL update the name and keep `isClosed` (NUC-46).
- IF a tenant reschedules into a slot that becomes taken while paying the difference THEN the difference SHALL be refunded and the booking stays at its original time (NUC-147).
- IF a saved card is deleted while a balance charge is pending on it THEN the pending charge SHALL complete normally and later charges SHALL skip it (NUC-127).
- IF reception calls an admin-only route THEN the API SHALL return 403 `FORBIDDEN` (NUC-32, NUC-39, NUC-163).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Task(s) | Status |
| --- | --- | --- | --- | --- |
| NUC-01 | P1: Booking vocabulary and contracts | Tasks | T1 | Implementing |
| NUC-02 | P1: Booking vocabulary and contracts | Tasks | T1 | Implementing |
| NUC-03 | P1: Booking vocabulary and contracts | Tasks | T1 | Implementing |
| NUC-04 | P1: Booking vocabulary and contracts | Tasks | T1, T5 | In Tasks |
| NUC-05 | P1: Booking vocabulary and contracts | Tasks | T5, T20, T23 | In Tasks |
| NUC-06 | P1: Booking vocabulary and contracts | Tasks | T23, T26 | In Tasks |
| NUC-07 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-08 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-09 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-10 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-11 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-12 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-13 | P1: Slot grid with cleanup | Tasks | T2, T20 | In Tasks |
| NUC-14 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-15 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-16 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-17 | P1: Slot grid with cleanup | Tasks | T2 | In Tasks |
| NUC-18 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-19 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-20 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-21 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-22 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-23 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-24 | P1: Pricing engine | Tasks | T3 | In Tasks |
| NUC-25 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-26 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-27 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-28 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-29 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-30 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-31 | P1: Payment split and booking policies | Tasks | T4 | In Tasks |
| NUC-32 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-33 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-34 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-35 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-36 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-37 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-38 | P1: Business hours and calendar parameters | Tasks | T10 | In Tasks |
| NUC-39 | P1: Business hours and calendar parameters | Tasks | T24 | In Tasks |
| NUC-40 | P1: Business hours and calendar parameters | Tasks | T43 | In Tasks |
| NUC-41 | P1: Business hours and calendar parameters | Tasks | T43 | In Tasks |
| NUC-42 | P2: Drag-edit business hours | Tasks | T43 | In Tasks |
| NUC-43 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-44 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-45 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-46 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-47 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-48 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-49 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-50 | P1: Holidays and closed days | Tasks | T11 | In Tasks |
| NUC-51 | P1: Holidays and closed days | Tasks | T11, T20 | In Tasks |
| NUC-52 | P1: Holidays and closed days | Tasks | T45 | In Tasks |
| NUC-53 | P2: Holiday review banner | Tasks | T45 | In Tasks |
| NUC-54 | P1: Manual blocks with tags | Tasks | T12 | In Tasks |
| NUC-55 | P1: Manual blocks with tags | Tasks | T12 | In Tasks |
| NUC-56 | P1: Manual blocks with tags | Tasks | T12 | In Tasks |
| NUC-57 | P1: Manual blocks with tags | Tasks | T12, T26 | In Tasks |
| NUC-58 | P1: Manual blocks with tags | Tasks | T12 | In Tasks |
| NUC-59 | P1: Manual blocks with tags | Tasks | T12 | In Tasks |
| NUC-60 | P1: Manual blocks with tags | Tasks | T45 | In Tasks |
| NUC-61 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-62 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-63 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-64 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-65 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-66 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-67 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-68 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-69 | P1: Booking categories and price table | Tasks | T13 | In Tasks |
| NUC-70 | P1: Booking categories and price table | Tasks | T20 | In Tasks |
| NUC-71 | P1: Booking categories and price table | Tasks | T44 | In Tasks |
| NUC-72 | P1: Booking categories and price table | Tasks | T44 | In Tasks |
| NUC-73 | P1: Booking categories and price table | Tasks | T43 | In Tasks |
| NUC-74 | P1: Public availability and catalog | Tasks | T8 | In Tasks |
| NUC-75 | P1: Public availability and catalog | Tasks | T8 | In Tasks |
| NUC-76 | P1: Public availability and catalog | Tasks | T8 | In Tasks |
| NUC-77 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-78 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-79 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-80 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-81 | P1: Public availability and catalog | Tasks | T7, T9 | In Tasks |
| NUC-82 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-83 | P1: Public availability and catalog | Tasks | T7 | In Tasks |
| NUC-84 | P1: Public availability and catalog | Tasks | T8 | In Tasks |
| NUC-85 | P1: Public availability and catalog | Tasks | T8 | In Tasks |
| NUC-86 | P1: Book and pay the sinal | Tasks | T9 | In Tasks |
| NUC-87 | P1: Book and pay the sinal | Tasks | T9 | In Tasks |
| NUC-88 | P1: Book and pay the sinal | Tasks | T9 | In Tasks |
| NUC-89 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-90 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-91 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-92 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-93 | P1: Book and pay the sinal | Tasks | T20, T49 | In Tasks |
| NUC-94 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-95 | P1: Book and pay the sinal | Tasks | T17, T20 | In Tasks |
| NUC-96 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-97 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-98 | P1: Book and pay the sinal | Tasks | T30, T37 | In Tasks |
| NUC-99 | P1: Book and pay the sinal | Tasks | T32, T37 | In Tasks |
| NUC-100 | P1: Book and pay the sinal | Tasks | T31, T38 | In Tasks |
| NUC-101 | P1: Book and pay the sinal | Tasks | T38 | In Tasks |
| NUC-102 | P1: Book and pay the sinal | Tasks | T39 | In Tasks |
| NUC-103 | P1: Book and pay the sinal | Tasks | T39, T49 | In Tasks |
| NUC-104 | P1: Book and pay the sinal | Tasks | T6, T9 | In Tasks |
| NUC-105 | P1: Gateway-independent payments | Tasks | T15, T16 | In Tasks |
| NUC-106 | P1: Gateway-independent payments | Tasks | T15 | In Tasks |
| NUC-107 | P1: Gateway-independent payments | Tasks | T17 | In Tasks |
| NUC-108 | P1: Gateway-independent payments | Tasks | T17 | In Tasks |
| NUC-109 | P1: Gateway-independent payments | Tasks | T17 | In Tasks |
| NUC-110 | P1: Gateway-independent payments | Tasks | T17 | In Tasks |
| NUC-111 | P1: Gateway-independent payments | Tasks | T17 | In Tasks |
| NUC-112 | P1: Gateway-independent payments | Tasks | T18 | In Tasks |
| NUC-113 | P1: Gateway-independent payments | Tasks | T18 | In Tasks |
| NUC-114 | P1: Gateway-independent payments | Tasks | T16, T18 | In Tasks |
| NUC-115 | P1: Gateway-independent payments | Tasks | T18 | In Tasks |
| NUC-116 | P1: Gateway-independent payments | Tasks | T18 | In Tasks |
| NUC-117 | P1: Gateway-independent payments | Tasks | T18 | In Tasks |
| NUC-118 | P1: Gateway-independent payments | Tasks | T18, T39 | In Tasks |
| NUC-119 | P1: Gateway-independent payments | Tasks | T18, T28 | In Tasks |
| NUC-120 | P1: Gateway-independent payments | Tasks | T19, T39 | In Tasks |
| NUC-121 | P1: Gateway-independent payments | Tasks | T19 | In Tasks |
| NUC-122 | P1: Gateway-independent payments | Tasks | T16 | In Tasks |
| NUC-123 | P1: Gateway-independent payments | Tasks | T16 | In Tasks |
| NUC-124 | P1: Gateway-independent payments | Tasks | T16 | In Tasks |
| NUC-125 | P1: Gateway-independent payments | Tasks | T15 | In Tasks |
| NUC-126 | P1: Gateway-independent payments | Tasks | T19 | In Tasks |
| NUC-127 | P1: Gateway-independent payments | Tasks | T19 | In Tasks |
| NUC-128 | P1: Gateway-independent payments | Tasks | T15, T19 | In Tasks |
| NUC-129 | P1: Gateway-independent payments | Tasks | T19 | In Tasks |
| NUC-130 | P1: Balance charge, reminders and deadline | Tasks | T27 | In Tasks |
| NUC-131 | P1: Balance charge, reminders and deadline | Tasks | T27 | In Tasks |
| NUC-132 | P1: Balance charge, reminders and deadline | Tasks | T27 | In Tasks |
| NUC-133 | P1: Balance charge, reminders and deadline | Tasks | T27 | In Tasks |
| NUC-134 | P1: Balance charge, reminders and deadline | Tasks | T17 | In Tasks |
| NUC-135 | P1: Balance charge, reminders and deadline | Tasks | T17 | In Tasks |
| NUC-136 | P1: Confirmation e-mails with .ics | Tasks | T14, T18 | In Tasks |
| NUC-137 | P1: Confirmation e-mails with .ics | Tasks | T14, T22, T23 | In Tasks |
| NUC-138 | P1: Confirmation e-mails with .ics | Tasks | T27 | In Tasks |
| NUC-139 | P1: Confirmation e-mails with .ics | Tasks | T14 | In Tasks |
| NUC-140 | P1: Confirmation e-mails with .ics | Tasks | T21 | In Tasks |
| NUC-141 | P1: Reschedule and cancel | Tasks | T21 | In Tasks |
| NUC-142 | P1: Reschedule and cancel | Tasks | T22 | In Tasks |
| NUC-143 | P1: Reschedule and cancel | Tasks | T22 | In Tasks |
| NUC-144 | P1: Reschedule and cancel | Tasks | T22 | In Tasks |
| NUC-145 | P1: Reschedule and cancel | Tasks | T6, T22 | In Tasks |
| NUC-146 | P1: Reschedule and cancel | Tasks | T22 | In Tasks |
| NUC-147 | P1: Reschedule and cancel | Tasks | T22, T26 | In Tasks |
| NUC-148 | P1: Reschedule and cancel | Tasks | T22, T23 | In Tasks |
| NUC-149 | P1: Reschedule and cancel | Tasks | T22 | In Tasks |
| NUC-150 | P1: Reschedule and cancel | Tasks | T23 | In Tasks |
| NUC-151 | P1: Reschedule and cancel | Tasks | T23 | In Tasks |
| NUC-152 | P1: Reschedule and cancel | Tasks | T23 | In Tasks |
| NUC-153 | P1: Reschedule and cancel | Tasks | T23 | In Tasks |
| NUC-154 | P1: Reschedule and cancel | Tasks | T41 | In Tasks |
| NUC-155 | P1: Reschedule and cancel | Tasks | T41 | In Tasks |
| NUC-156 | P1: Reschedule and cancel | Tasks | T41 | In Tasks |
| NUC-157 | P1: Gestão de Reservas operations | Tasks | T25 | In Tasks |
| NUC-158 | P1: Gestão de Reservas operations | Tasks | T33, T46 | In Tasks |
| NUC-159 | P1: Gestão de Reservas operations | Tasks | T30, T46 | In Tasks |
| NUC-160 | P1: Gestão de Reservas operations | Tasks | T46 | In Tasks |
| NUC-161 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-162 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-163 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-164 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-165 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-166 | P1: Gestão de Reservas operations | Tasks | T26 | In Tasks |
| NUC-167 | P1: Gestão de Reservas operations | Tasks | T24 | In Tasks |
| NUC-168 | P1: Gestão de Reservas operations | Tasks | T28 | In Tasks |
| NUC-169 | P1: Gestão de Reservas operations | Tasks | T25 | In Tasks |
| NUC-170 | P1: Gestão de Reservas operations | Tasks | T47 | In Tasks |
| NUC-171 | P1: Gestão de Reservas operations | Tasks | T39 | In Tasks |
| NUC-172 | P1: Policies panel | Tasks | T10 | In Tasks |
| NUC-173 | P1: Policies panel | Tasks | T10 | In Tasks |
| NUC-174 | P1: Policies panel | Tasks | T10 | In Tasks |
| NUC-175 | P1: Policies panel | Tasks | T23 | In Tasks |
| NUC-176 | P1: Policies panel | Tasks | T48 | In Tasks |
| NUC-177 | P1: Bookings list and CSV export | Tasks | T25 | In Tasks |
| NUC-178 | P1: Bookings list and CSV export | Tasks | T25 | In Tasks |
| NUC-179 | P1: Bookings list and CSV export | Tasks | T31, T48 | In Tasks |
| NUC-180 | P1: Public site pages | Tasks | T34 | In Tasks |
| NUC-181 | P1: Public site pages | Tasks | T34 | In Tasks |
| NUC-182 | P1: Public site pages | Tasks | T35 | In Tasks |
| NUC-183 | P1: Public site pages | Tasks | T36 | In Tasks |
| NUC-184 | P1: Public site pages | Tasks | T36 | In Tasks |
| NUC-185 | P1: Public site pages | Tasks | T36 | In Tasks |
| NUC-186 | P1: Public site pages | Tasks | T36 | In Tasks |
| NUC-187 | P1: Public site pages | Tasks | T38 | In Tasks |
| NUC-188 | P1: Minhas reservas, agenda and profile | Tasks | T21 | In Tasks |
| NUC-189 | P1: Minhas reservas, agenda and profile | Tasks | T40 | In Tasks |
| NUC-190 | P1: Minhas reservas, agenda and profile | Tasks | T33, T40 | In Tasks |
| NUC-191 | P1: Minhas reservas, agenda and profile | Tasks | T40 | In Tasks |
| NUC-192 | P1: Minhas reservas, agenda and profile | Tasks | T21 | In Tasks |
| NUC-193 | P1: Minhas reservas, agenda and profile | Tasks | T42 | In Tasks |
| NUC-194 | P1: Minhas reservas, agenda and profile | Tasks | T42 | In Tasks |
| NUC-195 | P1: Scheduled jobs | Tasks | T26 | In Tasks |
| NUC-196 | P1: Scheduled jobs | Tasks | T26 | In Tasks |
| NUC-197 | P1: Scheduled jobs | Tasks | T26 | In Tasks |
| NUC-198 | P1: Scheduled jobs | Tasks | T28 | In Tasks |
| NUC-199 | P1: Scheduled jobs | Tasks | T26, T50 | In Tasks |
| NUC-200 | P1: Scheduled jobs | Tasks | T26 | In Tasks |
| NUC-201 | P1: Extension points | Tasks | T6 | In Tasks |
| NUC-202 | P1: Extension points | Tasks | T7, T32 | In Tasks |
| NUC-203 | P1: Extension points | Tasks | T29 | In Tasks |
| NUC-204 | P1: Extension points | Tasks | T11 | In Tasks |
| NUC-205 | P1: Extension points | Tasks | T6, T18, T23, T26 | In Tasks |
| NUC-206 | P2: Booking funnel analytics | Tasks | T29, T38 | In Tasks |
| NUC-207 | P1: Book and pay the sinal | Tasks | T20 | In Tasks |
| NUC-208 | P1: Gateway-independent payments | Tasks | T15, T16 | In Tasks |
| NUC-209 | P1: Extension points | Tasks | T6, T17, T18 | In Tasks |
| NUC-210 | P1: Extension points | Tasks | T6, T23 | In Tasks |

**ID format:** `NUC-NN`.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 210 total, 210 mapped to tasks, 0 unmapped.

### Implicit-requirement dimensions sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | NUC-33, NUC-35, NUC-39, NUC-45, NUC-46, NUC-54, NUC-62, NUC-68, NUC-82, NUC-87, NUC-88, NUC-90, NUC-126, NUC-157, NUC-169, NUC-173, NUC-178, NUC-192; settings bounds from the fundação catalog |
| Failure / partial-failure states | NUC-47 (BrasilAPI), NUC-55/56 (all-or-nothing blocks), NUC-111 (gateway down), NUC-118 (rejected), NUC-119/198 (refund retries), NUC-131 (card declined), NUC-147 (difference unpaid), NUC-205 (notifier errors never fail) |
| Idempotency / retry / duplicate handling | NUC-95 (Idempotency-Key), NUC-109 (one pending charge per purpose), NUC-113 (webhook dedupe), NUC-57 (materialization), NUC-133/138 (outbox dedupe keys), NUC-196 (job lock), NUC-198 (reconcile via the same effects) |
| Auth boundaries & rate limits | NUC-32, NUC-39, NUC-89, NUC-108 (owner 404), NUC-112 (signatures), NUC-121 (sandbox guard), NUC-163, NUC-172, NUC-195 (trigger auth), NUC-81 (120/min/IP), NUC-96 (3 holds) |
| Concurrency / ordering | NUC-94 (exclusion constraint), NUC-51 (advisory lock per date), NUC-05 (guarded transitions), webhook vs expiry race (edge case), NUC-104 (step order) |
| Data lifecycle / expiry | NUC-93/197 (checkout hold), NUC-162/166 (pre-reservation), NUC-164 (token rotation), NUC-147 (reschedule requests), NUC-200 (idempotency and job_runs purge), NUC-57 (block horizon). Webhook/outbox retention: N/A because purge belongs to gestao's LGPD retention work |
| Observability | `booking_events` for every transition (NUC-05), audit for every staff action (NUC-33, NUC-39, NUC-44, NUC-49, NUC-54, NUC-65, NUC-163, NUC-174), `job_runs` (NUC-195), gateway call logs without card data (NUC-128), staff notifications (NUC-205) |
| External-dependency failure | Gateway timeout 10 s (NUC-111), missing credentials (NUC-125), webhook loss covered by reconcile (NUC-198), BrasilAPI (NUC-47), e-mail provider (fundação FND-79/80), Neon trigger auth (NUC-195) |
| State-transition integrity | NUC-01, NUC-05, NUC-06, NUC-108, NUC-117 (AD-032 transitions), NUC-163, NUC-167, NUC-168 |

---

## Success Criteria

- [ ] All W-CL, W-CC, W-PR, W-SP, W-CA, W-RS, W-ST and W-AV rows pass as unit tests with the exact values above.
- [ ] Playwright smoke (T49): anonymous visitor → signup → verify → book Tue 17:30–20:00 → sandbox approve → "Reserva confirmada" and a `booking.confirmed` outbox row with `.ics`, in under 3 minutes of scripted time; admin creates a pre-reservation, confirms it manually and checks the customer in.
- [ ] Concurrency test: 10 parallel bookings of the same slot yield exactly one 201.
- [ ] Availability p95 ≤ 300 ms on the `dev` branch with 500 bookings in the month (measured in T49 with a warm database).
- [ ] Every NUC requirement verified by the Verifier with file:line evidence.
