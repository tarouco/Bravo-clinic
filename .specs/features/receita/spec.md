# Receita Specification

## Problem Statement

`nucleo` sells single bookings with a deposit. The clinic's predictable revenue (PRD §1, §3 "Receita de assinaturas ≥ 30%") depends on recurring products: hour packages with proportional debit, fixed-schedule packages that reserve a weekly pattern, extra hours, customer credits, coupons and slot discounts. These rules move money and minute balances, so they must be exact (PRD worked examples), concurrency-safe (PRD §8 "saldo, créditos e limites de cupom em transação, com extrato imutável") and driven by our own jobs (AD-006, AD-007). This feature delivers PRD §9 step 2 "Receita" on top of `nucleo`'s checkout pipeline.

## Goals

- [ ] A tenant buys "Pacote 20h mensal" on the phone, books Wednesday 19:00–20:00 with it and sees "Esta reserva vai debitar 78 min do seu pacote" before confirming; the extrato shows the same 78 min with the formula.
- [ ] The five debit examples, the conversion example (360 → 384 min), the compensation examples (40 min; R$ 205,33) and the fixed-schedule price example (22 × R$ 280,00 = R$ 6.160,00) are reproduced exactly by `@bravo/core` unit tests and by the API.
- [ ] Renewals, suspensions, closures and expiries run unattended from the daily triggers; running any job twice changes nothing the second time.
- [ ] Two concurrent requests can never overdraw a minute balance, a credit lot or the last use of a limited coupon (integration tests with parallel transactions).
- [ ] The Admin manages coupons, slot discounts, subscriptions (list, sell, adjust, cancel) and package categories without developer help.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Hourly/block categories, availability engine, single-booking checkout, gateway adapters, reschedule/cancel rules, close-day flow, Políticas panel | `nucleo` (AD-013); receita plugs into them through the contract of design.md "Required from nucleo" |
| Editing the receita settings keys (`payment.subscription_renewal_days_before`, `payment.renewal_grace_days`, `payment.extra_hours_*`, `credits.validity_days`, `payment.closed_day_compensation_enabled`) | Políticas panel is `nucleo` (US-15); receita only reads them |
| Financeiro/DRE (revenue categories, competência distribution of subscriptions) | `gestao`; receita writes the `charges`/ledger rows gestao reads |
| Clientes screen (customer detail with subscriptions, credits, coupons) | `gestao`; receita exposes the read endpoints and the `GrantCreditDialog` it reuses |
| MCP tools (vender assinatura, aplicar desconto, criar cupom) | `gestao` (AD-011); receita services accept origin `mcp` |
| Web push for subscription events | `gestao` (PWA notifications); receita writes e-mails to the outbox only |
| Notification recipients management | `gestao` (Integrações); receita emits `new_subscription` / `renewal_failed` through nucleo's staff-notification helper |
| Prorated refunds of subscriptions | PRD §5.3.1/§5.4: cancellation is immediate, without refund; the Admin may grant a manual credit |
| Mixed payment of one booking (part package minutes, part money) | PRD §5.3.1: insufficient balance offers "Comprar horas extras" or "Pagar esta reserva" |
| Switching between package types (hour package ↔ fixed schedule) | PRD §5.3.1/§5.3.2 describe up/down within hour packages and category change within fixed schedules |
| Per-room package pricing | PRD §5.1 "preço igual para as 3 salas" |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| A subscription must exist before payment (fixed occurrences are held during checkout) | `subscriptions.status` gains `awaiting_payment` (Aguardando pgto) and `expired` (Expirada): `awaiting_payment → active \| expired` (AD-030) | `docs/architecture.md` §3.2 has no pre-payment state; holds need a parent row | n |
| Checkout hold for a self-service subscription or extra-hours purchase | `payment.checkout_hold_minutes` (15 min), same as bookings | One hold rule for every checkout (PRD §5.4) | n |
| Base date bounds | `today ≤ baseOn ≤ today + calendar.max_advance_days` (90) | Reuses the existing advance limit instead of a new constant | n |
| When package minutes become usable | Granted when the period becomes `active` (on `starts_on`, or at approval when `starts_on ≤ today`); usable only for bookings whose local date is inside that active period | PRD §5.3.1 "horas do período seguinte ficam disponíveis na data base desse novo período" | n |
| V_ref and V_pac used by a debit | V_ref = weekday rate of the reference category at quote time; V_pac from the debited period's `price_snapshot`; V_slot from nucleo's `selectHourlyCategory` with the whole booking duration | Price is frozen at booking time; the period snapshot is what the tenant paid | n |
| Block-category bookings with package hours | Not allowed: the package option is offered only for hourly-priced intervals | PRD defines V_slot only for Hora avulsa categories | n |
| Extra-minute lot usable for a booking | Only when `lot.expires_at > now` and the booking `starts_at < lot.expires_at` | "Validade de 90 dias a partir da compra" | n |
| One hour package per tenant | At most one hour-package subscription in `awaiting_payment`, `active` or `suspended` per user (partial unique index); several fixed-schedule subscriptions are allowed | One minute balance per tenant keeps debit order unambiguous; fixed schedules are naturally multiple | n |
| Return of minutes on tenant cancellation | Package minutes return when cancelled ≥ `policy.package_cancel_return_min_hours_before` (24 h) before start AND the debited period is still active; extra minutes return to their lot when it has not expired | PRD §5.3.1 "dentro do período vigente"; extras do not belong to a period | n |
| Clinic cancellation of a package booking | All minutes return: package minutes to the debited period when active, otherwise to a new extra lot (source `manual`, 90 days, detail `clinic_cancellation`) | PRD §5.5 "minutos devolvidos" with no deadline condition for the clinic | n |
| Package booking rescheduled | Previous debit is reversed and the new interval debited in one transaction; insufficient balance blocks the reschedule | PRD §5.5 "debita mais minutos do pacote"; reversal keeps the extrato exact | n |
| Bookings debited from a period closed by a switch, cancelled later within the deadline | Returned minutes go to the successor subscription's active period, converted with the switch rates | PRD §7.6 "reservas continuam válidas"; the value stays with the tenant | n |
| Renewal price changes | Renewal uses the category values current when the renewal period is priced; subscribers get an e-mail when a package price changes | PRD §5.3 "renovações seguintes, com aviso prévio" | n |
| Editing a package category that has non-terminal subscriptions | Price and included minutes are editable (apply at next renewal); weekdays, window and period are locked (409) | Held occurrences and period lengths cannot change under an active subscription | n |
| Inactive or admin-only package category | Not purchasable by tenants; admin-only categories are sellable by the Admin; existing subscriptions keep renewing | Status/visibility control sale, not existing contracts | n |
| Renewal timing | `charge_due_at` = local 00:00 of `starts_on − payment.subscription_renewal_days_before`; daily job at 03:00 BRT charges due periods; payment must be approved before local 00:00 of `starts_on` | PRD "cobrança 2 dias antes da data base", "não pago até a data base" | n |
| Saved-card renewal declined | One automatic retry on the next daily run before `starts_on`; the tenant can pay by Pix or another card at any time | Common dunning baseline; PRD silent on retries | n |
| Pix renewal reminders | One reminder per day while the renewal charge is pending and before `starts_on` | PRD "Pix gerado, com lembretes" without a schedule | n |
| Saved card missing, deleted or from another gateway | Renewal falls back to a Pix charge and e-mails the tenant to register a card again | PRD §7.6 "cartões salvos ... não migram" | n |
| Credits on renewals | Available credits are applied automatically (FIFO by expiry) before charging the remainder | PRD §5.3.5 credits pay "pacotes"; automatic use avoids expiring credit | n |
| Regularization of a suspended subscription | Hour package: full price, period keeps its dates, full minutes; fixed schedule: re-holds the period's future free occurrences and charges per occurrence × re-held count | PRD silent on proration; base dates change only on switch (§5.3.1) | n |
| Grace end | Ended when `today ≥ starts_on + payment.renewal_grace_days` and still unpaid | "regularizar em até 7 dias" | n |
| Period-end notices | E-mail 7 and 1 days before `ends_on` for active hour packages | PRD §5.3.1 "O app avisa 7 dias e 1 dia antes" (web push is gestao) | n |
| Fixed schedule next-period holds | Created when the current period becomes active; dates that cannot be held are stored and e-mailed before the renewal charge; the renewal counts only held occurrences | PRD §5.3.2 "pré-reservadas"; §7.6 "avisado antes da cobrança, com as datas afetadas" | n |
| Closed days known when a fixed period is priced | Excluded from the occurrence count, no compensation credit | Avoids paying twice for the same lost occurrence | n |
| Closed day marked after a fixed period was priced | The occurrence becomes `cancelled_by_clinic` and the subscriber gets a credit of period price ÷ period days | PRD §5.3.2 | n |
| Room-specific closed days | Hour packages: no compensation (other rooms remain bookable); fixed schedules: compensated only when the closed room is the subscription room | Hour packages are not tied to a room | n |
| Closed days already known when an hour-package period activates | Compensated at activation (one per closed day and subscription) | PRD "cada dia fechado dentro do período" | n |
| Fixed occurrences and `calendar.max_advance_days` | Occurrences are exempt; occurrences starting before `now + calendar.min_advance_minutes` are not generated | A quarterly period starting in 30 days ends beyond 90 days | n |
| Fixed occurrence rescheduled | nucleo courtesy rules apply; money difference is zero (subscription-priced) | PRD §5.3.2 "reagendamento pela regra de cortesia" | n |
| Switch effect date and charge | Switch takes effect at payment approval; the approval's local date is the new base date; full price of the new category, no coupon, credits allowed | PRD "nova data base ... cobrança do novo pacote no ato"; coupon only on the first payment | n |
| Fixed→fixed switch with overlapping times in the same room | New occurrences that overlap the old subscription's own occurrences are inserted at approval right after releasing the old ones; others are held during checkout; an insert conflict at approval refunds the charge and keeps the old subscription | Prevents losing the old slots when payment fails | n |
| Cancellation when the next period is already paid | Cancellation is immediate; the paid upcoming period is lost without refund and the preview says so | PRD §5.4 "efeito imediato ... sem reembolso" | n |
| Late approval after a purchase expired | The charge is refunded in full and the tenant is e-mailed | PRD §7.6 rule for late approvals, applied uniformly | n |
| Coupon use lifecycle | Reserved (counter +1) when the checkout is created, consumed on approval, released (counter −1) on expiry or cancellation before approval; never returned after approval | Atomic last-use (PRD §5.3.4) must hold during the hold window | n |
| First-booking eligibility | No booking that ever reached `confirmed` (statuses `confirmed`, `paid`, `completed`, `no_show`, `cancelled_by_tenant`, `cancelled_nonpayment`, `cancelled_by_clinic` after confirmation) and no reserved/consumed first-booking coupon use for any account with the same document | PRD "verificada pelo CPF/CNPJ" | n |
| Per-customer coupon limit | Counted by document when the user has one, else by user id; reserved + consumed uses | Same anti-duplicate intent as first booking | n |
| Coupons on extra hours and on switches | Not applicable (`not_applicable`) | PRD lists bookings and package purchase (first payment) only | n |
| Disabled coupon mid-checkout | A use already reserved is still consumed on approval; new quotes and checkouts are refused at once | Price is frozen at checkout creation (PRD §5.3) | n |
| Slot discount scope | Applies to hourly bookings only (per overlapped minute of each segment), never to block or package bookings | PRD "sobre o valor-hora das reservas avulsas" | n |
| Slot discount over a partly occupied range | Created only on the free sub-intervals of each room (outside `[start, end+cleanup)` of bookings and blocks); occupied parts are reported as skipped | Admin drags across a mixed range | n |
| Slot discount overlap | A new discount overlapping an active one in the same room is rejected (409); the Admin removes the old one first | Exclusion constraint of `docs/architecture.md` §5.4 | n |
| When a slot discount "disappears" | At confirmation of a booking that overlaps it: the overlapped part is marked consumed; the rest stays active | PRD "some quando o slot é reservado" | n |
| Slot discount percent of 100% / zero-amount checkout | Allowed (1..100); a zero payable amount confirms without a gateway charge (required from nucleo) | Architecture check allows 100 | n |
| Credits in refunds | Applied credit is an internal `charges` row (`provider='internal'`, `method='credit'`); retained amounts consume credit first; refunded credit returns to its lot, or to a fresh lot (same source, `credits.validity_days`) when the lot expired (AD-027) | One money ledger for gestao; tenants never lose refunded credit | n |
| Manual credit bounds | 1 to 10.000.000 cents, justification 5..500 chars, admin only | Guards typos; PRD "com justificativa no log" | n |
| Manual minute adjustment bounds | Non-zero integer, ±1..12000 minutes, justification 5..500 chars, admin only, active period only, never below zero | PRD "Só o Administrador geral" | n |
| Reception and receita Admin features | Reception may view the Assinaturas list (read-only); selling, adjusting, cancelling, coupons, slot discounts and manual credits are admin-only | PRD §7.3 reception scope; architecture §9.1 shows `assinaturas` to reception | n |
| Admin sale payment | Either a payment link (hold `payment.pre_reservation_expiry_hours`, editable 1..720 h; fixed occurrences held as `pre_reserved`) or manual confirmation with justification (audited) | Mirrors pre-reservation rules (PRD §5.4) | n |
| Hour package included hours | Whole hours 1..200 (stored as minutes) | Factory examples are whole hours | n |
| Job ordering | The three daily jobs are order-independent (each guards its own transitions); a 5-min `expire-purchases` job owns subscription/extra-hours holds; nucleo's `expire-holds` skips fixed occurrences (AD-031) | Neon triggers fire concurrently | n |
| Receita runs after nucleo is merged | Lane work starts only when nucleo's contract items exist on `main`; a missing item stops the worker with a report | AD-013 order; design.md "Required from nucleo" | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Package categories in the Admin ⭐ MVP

**User Story**: As the Administrador geral, I want to create hour-package and fixed-schedule categories in the categories table, so that I define what subscribers buy.

**Why P1**: Every subscription is bought from a category (PRD §5.3, US-12).

**Acceptance Criteria**:

1. WHEN the admin saves a category of type `hour_package` THEN the API SHALL require a name (2..80 chars), `fixed_price_cents ≥ 1`, included hours as an integer 1..200 stored as `included_minutes = hours × 60` and a period in {monthly, bimonthly, quarterly}, and SHALL reject any other combination with 422 `VALIDATION_FAILED`. [REC-01]
2. WHEN the admin saves a category of type `fixed_schedule` THEN the API SHALL require at least one ISO weekday, `start_minute` and `end_minute` multiples of `calendar.slot_minutes` with `end_minute − start_minute ≥ calendar.default_booking_minutes`, `price_per_occurrence_cents ≥ 1` and a period in {monthly, bimonthly, quarterly}. [REC-02]
3. WHEN a package category is shown in the admin table or form THEN the web SHALL show its average hour value: "Pacote 20h mensal — R$ 1.600,00 → R$ 80,00/h" for 160000/20 h and "R$ 112,00/h" for R$ 280,00 per 07:00–09:30 occurrence. [REC-03]
4. WHEN a fixed-schedule category is shown THEN the web SHALL show the estimated period price computed by `estimateFixedPeriod`, which for Mon–Fri, 30 days and R$ 280,00 SHALL read "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00". [REC-04]
5. IF the admin changes weekdays, window or period of a package category that has a subscription in `awaiting_payment`, `active` or `suspended` THEN the API SHALL reject with 409 `CONFLICT` and the message "Categoria com assinaturas ativas: crie uma nova categoria para mudar dias, horário ou período". [REC-05]
6. WHEN the admin changes `fixed_price_cents`, `included_minutes` or `price_per_occurrence_cents` of a package category THEN the system SHALL increment `version`, write audit `category.update` with before/after, and queue the e-mail `subscription.price_change` to every `active` or `suspended` subscriber of that category stating the new value and the first renewal date it applies to. [REC-06]
7. WHILE a package category is `inactive` THEN the public packages endpoint SHALL omit it and a tenant purchase SHALL return 404 `NOT_FOUND`. [REC-07]
8. WHILE a package category is `admin_only` THEN the public endpoint SHALL omit it and only the admin sale SHALL accept it. [REC-08]
9. WHILE a package category is `inactive` or `admin_only` the renewal job SHALL keep renewing its existing subscriptions. [REC-09]

**Independent Test**: Create "Pacote 25h mensal" (R$ 1.875,00) and a Tue/Thu 14:00–18:00 fixed category in the Admin; see R$ 75,00/h and the estimate; try to change the window of a category with a subscriber and get the 409.

---

### P1: Buy an hour package ⭐ MVP

**User Story**: As a frequent tenant, I want to subscribe to an hour package with a base date and pay the first period at once, so that I pay less per hour.

**Why P1**: US-06 first criterion; recurring revenue.

**Acceptance Criteria**:

1. WHEN a tenant requests a quote for "Pacote 20h mensal" with base date 2026-11-02 THEN the API SHALL return `startsOn = 2026-11-02`, `endsOn = 2026-12-02` (exclusive), `priceCents = 160000`, `includedMinutes = 1200`, `vPacCents = 8000`, discount, credit applied, `payNowCents` and `renewsOn = 2026-12-02` with `chargeDueOn = 2026-11-30`. [REC-10]
2. IF the base date is before today or after today + `calendar.max_advance_days` THEN the API SHALL reject with 422 `VALIDATION_FAILED` on path `baseOn` with "Escolha uma data base entre {hoje} e {limite}". [REC-11]
3. IF the tenant already has an hour-package subscription in `awaiting_payment`, `active` or `suspended` THEN the purchase SHALL be rejected with 409 `CONFLICT` "Você já tem um pacote de horas. Use “Trocar pacote” em Compras.". [REC-12]
4. IF the request does not carry `acceptTerms: true` and `acceptRecurring: true` THEN the API SHALL reject with 422 `POLICY_VIOLATION`; WHEN both are true THEN it SHALL write consents `subscription_terms` and `recurring_charge` with `ref_type = 'subscription'`. [REC-13]
5. WHEN a valid purchase is submitted THEN the API SHALL create in one transaction a subscription `awaiting_payment` with `hold_expires_at = now + payment.checkout_hold_minutes`, period seq 1 `awaiting_payment` with `price_snapshot`, the reserved coupon use, the applied credits and a `subscription_initial` charge for `payNowCents`, and SHALL return 201 with nucleo's `ChargeIntent` (Pix QR/copy-paste, checkout URL or saved-card status). [REC-14]
6. WHEN `payNowCents` is 0 because coupon and credits cover the price THEN the system SHALL activate the subscription in the same request without a gateway charge. [REC-15]
7. WHEN the initial charge is approved THEN the system SHALL set the subscription `active`, the period `active` with a `period_grant` ledger entry of `included_minutes` if `starts_on ≤ today` or `paid` otherwise, consume the coupon use, and queue `subscription.activated`. [REC-16]
8. WHEN the daily rollover runs on the `starts_on` of a `paid` first period THEN it SHALL set the period `active` and write its `period_grant`. [REC-17]
9. IF the hold expires before approval THEN the system SHALL set the subscription `expired`, the period `cancelled`, the pending charge `cancelled`, release the coupon use and return the applied credits. [REC-18]
10. IF a charge of an `expired` subscription is approved later THEN the system SHALL refund it in full (reason `late_approval_conflict`) and queue `payment.late_refund`. [REC-19]
11. The purchase endpoint SHALL require an `Idempotency-Key` header; a replay with the same body SHALL return the stored response and a different body SHALL return 422 `IDEMPOTENCY_MISMATCH`. [REC-20]
12. IF `paymentMethod = 'saved_card'` and the card is not the user's, is deleted, has no `recurring_consent_at` or belongs to a provider other than `payment.active_gateway` THEN the API SHALL reject with 422 `VALIDATION_FAILED` on path `savedCardId`. [REC-21]

**Independent Test**: Buy Pacote 20h with sandbox Pix, approve in the sandbox page, see the subscription active with 20h in `/app/compras`.

---

### P1: Pay a booking with package hours ⭐ MVP

**User Story**: As a subscriber, I want to book with my package and see how many minutes will be debited, so that I know the cost before confirming.

**Why P1**: US-06 criteria 2–3; PRD §5.3.1 proportional debit; §7.6 insufficient balance.

**Acceptance Criteria**:

1. The core function `packageDebitMinutes` SHALL return 120 (Tue 10:00–12:00), 78 (Wed 19:00–20:00), 185 (Sat 10:00–13:00), 84 (briefing V_ref 5000, V_pac 5000, V_slot 7000, 60 min) and 152 (Tue 17:30–20:00) for the examples of `docs/architecture.md` §7.8, applying one ceiling to the summed exact extra. [REC-22]
2. WHEN the quote of an hourly interval is requested by a user with an active hour package or unexpired extra lots THEN the quote SHALL include `packageOption = { debitMinutes, fromPackageMinutes, fromExtraMinutes, packageAvailableMinutes, extraAvailableMinutes, sufficient, reason, breakdown[] }`. [REC-23]
3. WHEN `packageOption.sufficient` is true THEN the web SHALL show "Esta reserva vai debitar {X} min do seu pacote" before the confirm button. [REC-24]
4. The system SHALL use package minutes only when the booking's local date lies in `[starts_on, ends_on)` of the subscription's `active` period; outside it the debit SHALL use extra lots only and `reason = 'outside_period'` when none cover it. [REC-25]
5. WHEN a debit is applied THEN the system SHALL take package minutes first and then extra lots ordered by `expires_at` ascending (ties by `created_at`), using only lots with `expires_at > now` and `expires_at > booking.starts_at`. [REC-26]
6. IF the available minutes are less than the debit THEN `packageOption.sufficient` SHALL be false with `reason = 'insufficient'`, and creating the booking with `payWith = 'package'` SHALL fail with 422 `INSUFFICIENT_BALANCE` and `details = [{ path: 'requiredMinutes' }, { path: 'availableMinutes' }]` carrying both numbers. [REC-27]
7. WHILE `packageOption.sufficient` is false the web SHALL disable "Pagar com meu pacote", show "Saldo insuficiente: esta reserva debita {X} min e você tem {Y} min" and offer "Comprar horas extras" (to `/app/compras/horas-extras`) and "Pagar esta reserva" (selects money payment). [REC-28]
8. WHEN a booking is created with `payWith = 'package'` THEN in the same transaction the system SHALL store `payment_mode = 'package'`, `total_cents = 0`, status `confirmed`, `package_minutes_debited` and `extra_minutes_debited`, and ledger `debit` rows whose `detail` holds segments, V_ref, V_pac and the exact extra. [REC-29]
9. The system SHALL apply no coupon and no slot discount to a package-paid booking (`discount_source = 'none'`). [REC-30]
10. IF the interval is priced by a block category THEN `packageOption` SHALL be null with reason `block_category` and package payment SHALL be rejected with 422 `POLICY_VIOLATION`. [REC-31]
11. WHEN two package bookings are created concurrently and together exceed the balance THEN exactly one SHALL succeed and the other SHALL get 422 `INSUFFICIENT_BALANCE`; no balance SHALL become negative. [REC-32]
12. The debit SHALL use V_ref = weekday rate of the reference category at quote time, V_pac = `price_snapshot.priceCents × 60 / includedMinutes` of the debited period and V_slot per segment from `selectHourlyCategory` with the whole booking duration. [REC-33]
13. WHEN a tenant cancels a package booking at least `policy.package_cancel_return_min_hours_before` hours before start THEN package minutes SHALL return to the debited period with a `refund` entry if that period is still `active`, and extra minutes SHALL return to their lots if those lots have not expired. [REC-34]
14. IF a package booking is cancelled by the tenant later than that deadline or becomes `no_show` THEN no minutes SHALL return. [REC-35]
15. WHEN the clinic cancels a package booking THEN all debited minutes SHALL return: package minutes to the debited period if `active`, otherwise to a new extra lot (`source = 'manual'`, 90 days, `detail.reason = 'clinic_cancellation'`). [REC-36]
16. WHEN a package booking is rescheduled THEN the system SHALL reverse its debit and debit the new interval under the same rules in one transaction; IF the new debit is not covered THEN the reschedule SHALL fail with 422 `INSUFFICIENT_BALANCE` and nothing SHALL change. [REC-37]
17. WHEN a package booking debited from a period closed by a switch is cancelled within the deadline THEN its package minutes SHALL return to the successor subscription's active period converted with `convertPackageBalance`. [REC-38]

**Independent Test**: With 20 h, book Wed 19:00–20:00 with the package → 78 min debited; book again with 10 min left → insufficient message and both buttons.

---

### P1: Balance ledger, extrato and admin adjustment ⭐ MVP

**User Story**: As a subscriber and as the Administrador geral, I want an immutable extrato and audited manual adjustments, so that every minute is explainable.

**Why P1**: PRD §5.3.1 "extrato", §8 "livro-razão imutável", US-06 criterion 6.

**Acceptance Criteria**:

1. IF any UPDATE or DELETE targets `package_ledger`, `extra_minutes_ledger` or `credit_ledger` THEN the database SHALL raise `append_only_table`. [REC-39]
2. The system SHALL keep `subscription_periods.minutes_balance` equal to the sum of that period's `package_ledger.minutes` at every commit, and the database SHALL reject a negative `minutes_balance`, `minutes_remaining` or `remaining_cents`. [REC-40]
3. WHEN a tenant opens the extrato of a subscription THEN the API SHALL return package and extra-minute entries newest first with type label, signed minutes, balance after, booking code when present and a formula text, which for the Wed example SHALL read "60 min + 18 min de excedente = 78 min". [REC-41]
4. The extrato SHALL label `period_grant` of seq 1 as "Compra" and of seq > 1 as "Renovação", and SHALL label extra lots by source ("Horas extras compradas", "Compensação de dia fechado", "Ajuste"). [REC-42]
5. WHEN the admin adjusts the active period balance by a non-zero integer within ±12000 minutes with a justification of 5..500 chars THEN the system SHALL write a `manual_adjustment` entry and audit `package_ledger.adjust` with before/after balances. [REC-43]
6. IF the adjustment would make the balance negative THEN the API SHALL reject with 422 `INSUFFICIENT_BALANCE`; IF the justification is missing THEN 422 `VALIDATION_FAILED`. [REC-44]
7. IF a reception user calls the adjustment THEN the API SHALL return 403 `FORBIDDEN`. [REC-45]

**Independent Test**: Make two bookings and one cancellation, open the extrato, adjust +30 min as admin with justification, see the audit row.

---

### P1: Renewal, suspension and closure ⭐ MVP

**User Story**: As a subscriber, I want my package renewed automatically and clear notices when payment fails, so that I keep my hours and slots.

**Why P1**: US-06 criterion 4, US-07 criterion 3, PRD §5.3.1 "Falha na renovação", §7.5.

**Acceptance Criteria**:

1. The system SHALL set each period's `ends_on = starts_on + period_days` and `charge_due_at` = local 00:00 of `starts_on − payment.subscription_renewal_days_before`; for base 2026-11-02 monthly the first renewal SHALL have `starts_on = 2026-12-02` and `charge_due_at = 2026-11-30T03:00:00Z`. [REC-46]
2. WHEN the renewals job runs and an `active` subscription's next period is due (`charge_due_at ≤ now`) without a charge THEN it SHALL create (hour package) or promote from `upcoming` (fixed schedule) the next period to `awaiting_payment`, price it from the current category (hour: `fixed_price_cents`; fixed: `price_per_occurrence_cents × held occurrences`), apply available credits FIFO, and charge the saved card or create a Pix charge for the rest. [REC-47]
3. WHEN the renewals job runs twice for the same due period THEN the system SHALL hold exactly one period row and one charge per attempt (`unique (subscription_id, seq)`, idempotency key `renewal:<periodId>:<attempt>`). [REC-48]
4. WHEN a renewal charge is approved THEN the period SHALL become `paid`, fixed-schedule `held_for_renewal` occurrences of that period SHALL become `confirmed`, and `subscription.renewal_approved` SHALL be queued. [REC-49]
5. IF a saved-card renewal is rejected THEN the system SHALL queue `subscription.renewal_failed`, emit staff event `renewal_failed`, and retry the saved card once on the next daily run before `starts_on`. [REC-50]
6. WHILE a Pix renewal charge is pending before `starts_on` the renewals job SHALL queue one `subscription.renewal_reminder` per local day (dedupe key `renewal_reminder:<periodId>:<date>`). [REC-51]
7. IF the subscription's saved card is missing, deleted or from a provider other than `payment.active_gateway` THEN the renewal SHALL create a Pix charge and the e-mail SHALL ask the tenant to register a card. [REC-52]
8. WHEN the rollover job runs on or after `ends_on` of an active period THEN it SHALL close that period, write an `expiry` entry for the remaining package minutes and, if the next period is `paid`, activate it with its `period_grant`. [REC-53]
9. IF the next period is still unpaid when its `starts_on` arrives THEN the suspensions job SHALL set the subscription `suspended` (`suspended_at`), keep the period `awaiting_payment`, set its `held_for_renewal` occurrences `expired` (occupancy released) and queue `subscription.suspended`. [REC-54]
10. WHILE a subscription is `suspended` the system SHALL offer no package payment for it and SHALL keep the tenant's extra lots usable. [REC-55]
11. WHEN a suspended subscription is paid within the grace period THEN the system SHALL set it `active`; an hour package SHALL charge the full price, keep the period dates and grant the full included minutes; a fixed schedule SHALL re-hold the period's future free occurrences and charge per occurrence × re-held count. [REC-56]
12. IF `today ≥ starts_on + payment.renewal_grace_days` and the period is unpaid THEN the suspensions job SHALL set the subscription `ended`, the period `failed`, the pending charge `cancelled` and queue `subscription.ended`; for base 2026-11-02 that date SHALL be 2026-12-09. [REC-57]
13. WHILE an hour-package period is active the renewals job SHALL queue `subscription.period_ending` 7 days and 1 day before `ends_on` (dedupe key `period_ending:<periodId>:<days>`). [REC-58]
14. IF a job route is called without a valid trigger delivery THEN it SHALL return 401 and change nothing; every run SHALL write `job_runs` with its stats. [REC-59]
15. The system SHALL allow only the subscription transitions `awaiting_payment → active | expired`, `active → active | suspended | cancelled | switched`, `suspended → active | ended | cancelled`, and SHALL answer any other attempt with 409 `INVALID_TRANSITION`. [REC-60]
16. The system SHALL allow only the period transitions `upcoming → awaiting_payment | cancelled`, `awaiting_payment → paid | active | failed | cancelled`, `paid → active | cancelled`, `active → closed`. [REC-61]

**Independent Test**: Run the renewals job with `now` = 2026-11-30 03:00 BRT on a sandbox saved card → period 2 paid; repeat with a declining card → suspended on 2026-12-02, ended on 2026-12-09.

---

### P1: Extra hours ⭐ MVP

**User Story**: As an hour-package subscriber, I want to buy 1–20 extra hours at my package rate, so that I can book beyond my balance or period.

**Why P1**: PRD §5.3.1 "Horas extras", US-08 criterion 2.

**Acceptance Criteria**:

1. WHEN a tenant opens Horas extras THEN the API SHALL return `eligible`, `unitPriceCents`, `minHours = payment.extra_hours_min`, `maxHours = payment.extra_hours_max`, the lots with remaining minutes and expiry, and the total remaining minutes. [REC-62]
2. The unit price SHALL be V_pac of the active period rounded half-up to the cent (8000 for Pacote 20h mensal) and the total SHALL be unit × hours (5 h → 40000). [REC-63]
3. IF the hours are outside `[payment.extra_hours_min, payment.extra_hours_max]` THEN the API SHALL reject with 422 `VALIDATION_FAILED` on path `hours`. [REC-64]
4. IF the tenant has no `active` hour-package subscription THEN the purchase SHALL be rejected with 422 `POLICY_VIOLATION` "Horas extras são exclusivas para assinantes de um pacote de horas ativo.". [REC-65]
5. WHEN an extra-hours charge is approved THEN the system SHALL mark the purchase `paid`, create a lot of `hours × 60` minutes with `expires_at = paid_at + payment.extra_hours_validity_days` and a `grant` ledger entry, and queue `extra_hours.purchased`. [REC-66]
6. WHEN the rollover job finds a lot with `expires_at ≤ now` and remaining minutes THEN it SHALL write an `expiry` entry and set `minutes_remaining = 0`. [REC-67]
7. WHILE a lot is unexpired the system SHALL keep it usable after the subscription is cancelled, switched, suspended or ended. [REC-68]
8. WHILE the tenant has no active hour package the web SHALL hide the Horas extras tab and link. [REC-69]
9. IF an extra-hours purchase hold expires unpaid THEN the purchase SHALL become `cancelled`, its charge `cancelled` and applied credits returned. [REC-70]

**Independent Test**: Buy 5 extra hours on Pacote 20h → R$ 400,00, 300 min, expiry in 90 days; book a date beyond the period with them.

---

### P1: Change and cancel a subscription ⭐ MVP

**User Story**: As a subscriber, I want to upgrade, downgrade or cancel with immediate effect and a preview, so that I never get surprised.

**Why P1**: PRD §5.3.1 "Mudança e cancelamento", §5.3.2, US-08 criterion 3.

**Acceptance Criteria**:

1. The core function `convertPackageBalance` SHALL return 384 for 360 remaining minutes from 160000/1200 to 225000/1800, rounding half-up to the minute. [REC-71]
2. WHEN a tenant requests a switch quote for an hour package THEN the API SHALL return current remaining minutes, converted minutes, the new included minutes, the new period's total minutes, the new period dates starting today, `priceCents` and `payNowCents`. [REC-72]
3. WHEN the switch charge is approved THEN in one transaction the system SHALL set the old subscription `switched` with `switched_to_subscription_id`, write `conversion_out` of its remaining minutes and close its period, cancel its pending renewal, and activate the new subscription with `base_on` = approval local date, `period_grant` of the new included minutes and `conversion_in` of the converted minutes. [REC-73]
4. The conversion SHALL use the remaining minutes at approval time, not at quote time. [REC-74]
5. IF the switch charge is rejected or its hold expires THEN the old subscription SHALL remain unchanged. [REC-75]
6. IF the target category has a different type than the current one or equals the current category THEN the switch SHALL be rejected with 422 `VALIDATION_FAILED` on path `categoryId`. [REC-76]
7. WHEN a fixed-schedule switch is approved THEN the system SHALL release the old subscription's future occurrences (`starts_at > now`, to `cancelled_by_tenant`) and held ones (to `expired`) without conversion, and reserve the new category's occurrences from the approval date in the chosen room, priced per occurrence × count; the conflict check SHALL ignore the old subscription's own occurrences. [REC-77]
8. IF a new occurrence cannot be inserted at switch approval THEN the system SHALL refund the charge, keep the old subscription and queue `payment.late_refund`. [REC-78]
9. WHEN a tenant opens the cancel preview THEN the API SHALL return for an hour package the minutes that will be lost and any paid upcoming period that will be lost, and for a fixed schedule the number of future occurrences to release; extra minutes kept SHALL be listed. [REC-79]
10. WHEN cancellation is confirmed THEN the subscription SHALL become `cancelled` at once, the remaining package minutes SHALL get an `expiry` entry, pending charges SHALL be cancelled, `upcoming`/`awaiting_payment`/`paid` future periods SHALL be `cancelled`, and bookings already confirmed with package minutes SHALL stay valid. [REC-80]
11. WHEN a fixed-schedule subscription is cancelled THEN its future occurrences SHALL become `cancelled_by_tenant` (or `cancelled_by_clinic` when the admin cancels), held ones `expired`, and no refund SHALL be issued. [REC-81]
12. IF the admin cancels a subscription without a justification of 5..500 chars THEN the API SHALL reject with 422; WHEN given THEN it SHALL audit `subscription.cancel`. [REC-82]

**Independent Test**: With 6 h left on Pacote 20h, switch to a R$ 2.250,00/30 h package and see 6,4 h + 30 h in the new period; cancel a fixed schedule and see the occurrences released.

---

### P1: Buy a fixed-schedule package ⭐ MVP

**User Story**: As a professional with a fixed agenda, I want to subscribe to a weekly pattern in a room, so that the room is mine every period.

**Why P1**: US-07.

**Acceptance Criteria**:

1. The core function `generateOccurrences` SHALL return 22 occurrences for "Meio turno mensal" (Mon–Fri 07:00–09:30) with base 2026-11-02 and 30 days, and `fixedPeriodPriceCents(28000, 22)` SHALL return 616000. [REC-83]
2. WHEN a visitor checks a category, room and base date THEN the API SHALL return the occurrences, the conflicts as `{ date, reason, label }` with pt-BR labels, the period price, and suggestions: up to 3 other active rooms without conflict for the same base date and up to 3 base dates within the next 14 days without conflict in the chosen room. [REC-84]
3. IF any occurrence conflicts (closed day, outside hours, booking, cleanup, block) at purchase THEN the API SHALL reject with 409 `OCCURRENCE_CONFLICT` listing every conflicting date and create nothing. [REC-85]
4. WHEN a fixed-schedule purchase is created THEN every occurrence SHALL be a booking `kind = 'fixed_occurrence'`, `payment_mode = 'subscription'`, status `awaiting_payment`, with the subscription hold and an occupancy `[start, end + cleanup)`. [REC-86]
5. IF an occurrence is taken between the check and the purchase THEN the exclusion constraint SHALL abort the whole purchase and the API SHALL return 409 `OCCURRENCE_CONFLICT` with that date. [REC-87]
6. WHEN the initial charge is approved THEN all occurrences SHALL become `confirmed` and the tenant SHALL receive one e-mail with the occurrence list and one `.ics` attachment containing one VEVENT per occurrence. [REC-88]
7. The system SHALL not generate occurrences starting before `now + calendar.min_advance_minutes` and SHALL not apply `calendar.max_advance_days` to occurrences. [REC-89]
8. The system SHALL keep occurrences on holidays (the clinic opens by default). [REC-90]
9. WHEN the summary is shown THEN the web SHALL display "{n} ocorrências × R$ {preço} = R$ {total}" before payment. [REC-91]

**Independent Test**: Pick Meio turno mensal, Sala Principal, 2026-11-02 → 22 dates, R$ 6.160,00; block one date and see the conflict with suggestions.

---

### P1: Fixed-schedule period lifecycle ⭐ MVP

**User Story**: As a fixed-schedule subscriber, I want next period's slots pre-reserved and my occurrences handled by the usual rules, so that I keep my agenda.

**Why P1**: US-07 criteria 3, PRD §5.3.2.

**Acceptance Criteria**:

1. WHEN a fixed-schedule period becomes active THEN the system SHALL create the next period `upcoming` and hold each of its free occurrences as a `held_for_renewal` booking; dates that cannot be held SHALL be stored in `held_conflicts` and e-mailed as `subscription.next_period_conflicts`. [REC-92]
2. The renewal price of a fixed schedule SHALL count only the held occurrences; closed days known at pricing SHALL reduce the count and SHALL generate no compensation credit. [REC-93]
3. WHEN a tenant cancels a single fixed occurrence THEN the system SHALL refund nothing and leave the subscription unchanged. [REC-94]
4. WHEN a fixed occurrence is rescheduled under the courtesy rules THEN the money difference SHALL be zero (no charge, no credit). [REC-95]

**Independent Test**: Activate a fixed subscription and list next period's held occurrences in the Admin calendar with status "Pré-reservada (renovação)".

---

### P1: Closed-day compensation ⭐ MVP

**User Story**: As a subscriber, I want compensation when the clinic closes a day of my period, so that I do not pay for a day I cannot use.

**Why P1**: PRD §5.2, §5.3.1, §5.3.2, US-06/US-07 criterion 5, US-11 criterion 7.

**Acceptance Criteria**:

1. The core SHALL return `hourPackageCompensationMinutes(1200, 30) = 40`, `(2400, 60) = 40`, `(1800, 90) = 20` and `fixedScheduleCompensationCents(616000, 30) = 20533`, rounding half-up. [REC-96]
2. WHEN the admin previews closing a date THEN the preview SHALL include the number of subscribers compensated, the total minutes and the total credit cents. [REC-97]
3. WHEN a clinic-wide closed day falls inside an `active` or `paid` hour-package period THEN the system SHALL create an extra lot (`source = 'closed_day_compensation'`, `expires_at = now + payment.extra_hours_validity_days`) of the computed minutes with a `grant` entry and queue `subscription.compensation`. [REC-98]
4. WHEN a closed day for the whole clinic or for the subscription room falls inside an `active` or `paid` fixed-schedule period THEN the system SHALL create a credit lot (`source = 'closed_day_compensation'`) of period price ÷ period days and queue `subscription.compensation`. [REC-99]
5. WHEN a closed day is applied THEN confirmed fixed occurrences on that date SHALL become `cancelled_by_clinic` without money refund and `held_for_renewal` occurrences on that date SHALL become `cancelled_by_clinic`. [REC-100]
6. IF the closed day is for one room THEN hour-package subscribers SHALL receive no compensation. [REC-101]
7. WHEN an hour-package period activates with clinic-wide closed days already inside it THEN the system SHALL compensate each of them at activation. [REC-102]
8. WHILE `payment.closed_day_compensation_enabled` is false the system SHALL create no compensation. [REC-103]
9. The system SHALL create at most one compensation per (closed day, subscription); re-applying SHALL create nothing. [REC-104]

**Independent Test**: Close 2026-11-20 for the clinic with a Pacote 20h and a Meio turno subscriber → 40 min extra lot and R$ 205,33 credit, and the Friday occurrence cancelled by the clinic.

---

### P1: Customer credits ⭐ MVP

**User Story**: As a tenant, I want credits in reais that pay bookings, packages and extra hours, so that differences and compensations keep their value.

**Why P1**: PRD §5.3.5.

**Acceptance Criteria**:

1. WHEN a credit is granted THEN the system SHALL create a lot with `remaining_cents = amount_cents > 0`, `expires_at = now + credits.validity_days` and a `grant` entry. [REC-105]
2. The available credit SHALL be the sum of `remaining_cents` of the user's lots with `expires_at > now`. [REC-106]
3. WHEN credits are used THEN the system SHALL consume lots by `expires_at` then `created_at`, use `min(available, payable)`, create one `charges` row (`provider = 'internal'`, `method = 'credit'`, `status = 'approved'`) and `use` entries referencing it. [REC-107]
4. WHEN two checkouts of the same user use credits concurrently THEN the sum used SHALL never exceed the available amount and no lot SHALL become negative. [REC-108]
5. WHEN a payment that used credits is partly retained and partly refunded THEN the retained amount SHALL consume the credit portion first, and the refunded credit SHALL return to its lot with a `refund` entry, or to a new lot of the same source with fresh validity when the lot has expired. [REC-109]
6. WHEN nucleo reports a reschedule to a cheaper slot THEN the system SHALL grant a credit of the difference (`source = 'reschedule_difference'`) and return its amount for the app message. [REC-110]
7. WHEN the clinic cancels a booking and the customer chooses credit THEN the system SHALL grant the paid amount as a credit (`source = 'clinic_cancellation'`). [REC-111]
8. WHEN the admin grants a manual credit of 1..10.000.000 cents with a justification of 5..500 chars THEN the system SHALL create the lot (`source = 'manual'`) and audit `credit.grant_manual`; IF the caller is reception THEN 403 `FORBIDDEN`. [REC-112]
9. WHEN the rollover job finds a lot with `expires_at ≤ now` and remaining cents THEN it SHALL write an `expiry` entry and set `remaining_cents = 0`. [REC-113]
10. WHEN the tenant opens Créditos THEN the web SHALL show the available total, each lot's source label, remaining value and expiry date, and the ledger entries. [REC-114]
11. The system SHALL accept credits as total or partial payment of bookings, subscription purchases, switches and extra hours, and SHALL apply them automatically to renewals. [REC-115]

**Independent Test**: Grant R$ 50,00 manually, pay part of a booking with it, cancel that booking as the clinic with credit, see the lots and entries.

---

### P1: Coupons in checkout ⭐ MVP

**User Story**: As a tenant, I want to apply a coupon to a booking or package and see the result or the reason it fails, so that I pay less.

**Why P1**: US-09, PRD §5.3.4.

**Acceptance Criteria**:

1. The core `couponDiscountCents` SHALL return 2190 for 1000 bp on 21900 and 2000 for R$ 20,00 fixed on 16000, and SHALL cap a fixed discount at the gross amount. [REC-116]
2. IF a coupon fails validation THEN the quote SHALL return `couponRejection.reason` ∈ {`not_found`, `disabled`, `exhausted`, `expired`, `not_yet_valid`, `first_booking_only`, `not_applicable`, `customer_limit`} with the messages "Cupom inexistente", "Cupom desabilitado", "Cupom esgotado", "Cupom expirado", "Cupom ainda não está válido", "Válido só na primeira reserva", "Cupom não se aplica a esta compra", "Você já usou este cupom o número máximo de vezes". [REC-117]
3. IF a `first_booking` coupon is used by a document that has any booking that reached `confirmed` or any reserved/consumed first-booking use THEN validation SHALL fail with `first_booking_only`. [REC-118]
4. IF the customer's reserved + consumed uses of a coupon reach `per_customer_limit` THEN validation SHALL fail with `customer_limit`, counting by document when present else by user. [REC-119]
5. WHEN both a coupon and a slot discount apply THEN `chooseDiscount` SHALL keep the larger, keep the slot discount on a tie (coupon not reserved), and the quote SHALL carry a `note`; for gross 16000, slot 10% (1600) and coupon R$ 20,00 (2000) the result SHALL be coupon, net 14000. [REC-120]
6. WHEN the quote carries a discount note THEN the web SHALL show "Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00)." or the symmetric slot text. [REC-121]
7. The booking deposit SHALL be computed on the net value after the discount (net 14000 → deposit 7000 at 50%). [REC-122]
8. WHEN two checkouts race for the last use of a limited coupon THEN exactly one SHALL reserve it (`UPDATE ... WHERE uses_count < max_uses`) and the other SHALL get 409 `COUPON_EXHAUSTED` "Cupom esgotado". [REC-123]
9. WHEN a checkout with a coupon is created THEN the use SHALL be `reserved` and `uses_count` incremented; WHEN paid THEN `consumed`; IF the checkout expires or is cancelled before approval THEN `released` and `uses_count` decremented. [REC-124]
10. WHEN a coupon is used on a package THEN it SHALL discount only the first period's payment and renewals SHALL be charged at full price. [REC-125]
11. IF a coupon is disabled THEN the next quote and checkout SHALL refuse it with `disabled`. [REC-126]
12. The system SHALL accept one coupon per purchase and SHALL match codes case-insensitively (stored upper-case). [REC-127]

**Independent Test**: Apply BRAVO10 on a R$ 219,00 booking (R$ 21,90 off), then a limited coupon with one use left from two browsers.

---

### P1: Admin coupons screen ⭐ MVP

**User Story**: As the Administrador geral, I want to create, edit, enable and disable coupons and see their usage, so that I run promotions.

**Why P1**: US-18, PRD §7.3.5.

**Acceptance Criteria**:

1. WHEN the admin opens Cupons THEN the web SHALL list code, type ("Primeira reserva"/"Desconto"), discount ("10%" or "R$ 20,00"), uses/limit ("3/10" or "3/∞"), validity ("—" or "01/11/2026–30/11/2026") and an enabled switch. [REC-128]
2. WHEN the admin saves a coupon THEN the API SHALL require code `^[A-Z0-9_-]{3,30}$` (input upper-cased) unique, percent 1..100 stored as basis points or fixed ≥ 1 cent, `max_uses` null or ≥ max(1, `uses_count`), `per_customer_limit` null or ≥ 1, `valid_from < valid_until` when both set, and `applies_to = 'bookings'` for `first_booking`. [REC-129]
3. WHEN the admin toggles a coupon THEN the system SHALL persist `enabled` and audit `coupon.enable` or `coupon.disable`; create and edit SHALL audit `coupon.create`/`coupon.update`. [REC-130]
4. WHEN the admin opens a coupon's history THEN the web SHALL list customer name, booking code or subscription category, date, discount and status (Reservado, Usado, Liberado). [REC-131]
5. IF a reception user calls a coupon route THEN the API SHALL return 403 `FORBIDDEN`. [REC-132]

**Independent Test**: Create BRAVO10 (10%, 100 uses), disable it and see checkout refuse it.

---

### P1: Slot discounts ⭐ MVP

**User Story**: As the Administrador geral, I want to put a percentage discount on free slots, so that idle hours sell.

**Why P1**: PRD §5.3.3, US-01 criterion 3, US-13 criterion 3.

**Acceptance Criteria**:

1. WHEN the admin applies a discount to one or more rooms for a date and slot-aligned interval THEN the API SHALL create one row per free sub-interval of each room and return `created[]` and `skipped[]` (`{ roomId, startMinute, endMinute, reason: 'occupied' }`). [REC-133]
2. IF percent is outside 1..100, the interval is misaligned, outside the business window or starts at or before now THEN the API SHALL reject with 422 `VALIDATION_FAILED`. [REC-134]
3. IF the interval overlaps an active discount in the same room THEN the API SHALL reject with 409 `CONFLICT` "Já existe desconto neste horário". [REC-135]
4. WHEN the public availability of a room and date is shown THEN available cells inside an active discount SHALL carry `discountPercent` and the web SHALL mark them "−{p}%". [REC-136]
5. WHEN the admin calendar shows a range THEN free discounted slots SHALL be marked with the percent and hovering them SHALL offer "Remover desconto". [REC-137]
6. WHEN a booking overlapping an active discount is confirmed THEN the overlapped part SHALL be stored as consumed by that booking and the remaining parts SHALL stay active. [REC-138]
7. WHEN the admin removes a discount THEN `removed_at` SHALL be set, audit `slot_discount.remove` written, and it SHALL no longer appear or price. [REC-139]
8. The system SHALL not show or apply a discount part whose end is at or before now. [REC-140]
9. IF a reception user calls a slot-discount mutation THEN the API SHALL return 403 `FORBIDDEN`. [REC-141]
10. The core `slotDiscountCents` SHALL return 1600 for Tue 14:00–16:00 at 8000/h with 10% over all minutes, computing each segment's overlap as `mulDivRoundHalfUp(rate × minutes, percent, 6000)`. [REC-142]

**Independent Test**: Drag Tue 19:00–22:00 across all rooms at 15%, see "−15%" on the public grid, book 19:00–20:00 and see the rest still discounted.

---

### P1: Perfil → Compras ⭐ MVP

**User Story**: As a subscriber, I want one place for my subscriptions, extra hours, credits and purchase history, so that I manage everything I bought.

**Why P1**: US-08, PRD §7.2.

**Acceptance Criteria**:

1. WHEN a tenant opens `/app/compras` THEN the web SHALL list each subscription with status label, category, base date, next charge (date, amount, method) and balance (hour package "12h 30min de 20h" with a meter plus extra minutes; fixed schedule room, weekdays and window and remaining occurrences). [REC-143]
2. The web SHALL offer per status: `active` → "Trocar", "Cancelar", "Extrato"; `suspended` → "Regularizar"; `awaiting_payment` → "Pagar"; terminal statuses → none. [REC-144]
3. WHEN the tenant opens Histórico THEN the web SHALL list their charges newest first with date, description (booking code, package name, extra hours), method, amount and status label. [REC-145]
4. The Compras area SHALL show tabs Assinaturas, Horas extras (only per REC-69), Créditos and Histórico at `/app/compras`, `/app/compras/horas-extras`, `/app/compras/creditos`, `/app/compras/historico`. [REC-146]
5. WHEN the tenant has no subscription THEN the web SHALL show an empty state "Você ainda não tem assinaturas" with a link to `/precos`. [REC-147]

**Independent Test**: As a subscriber with credits, navigate the four tabs on a phone viewport.

---

### P1: Admin subscriptions and sale ⭐ MVP

**User Story**: As the Administrador geral, I want a list of subscribers and to sell a subscription to a customer, so that I operate recurring revenue.

**Why P1**: PRD §7.3.2 "Vender assinatura" and "Assinaturas", US-13 criterion 4.

**Acceptance Criteria**:

1. WHEN staff open Gestão de Reservas → Assinaturas THEN the web SHALL list customer, category, type, room, base date, next charge, status (Ativa, Suspensa, Encerrada, Cancelada, Trocada, Aguardando pgto, Expirada) and balance, filterable by status and type and searchable by customer name. [REC-148]
2. WHEN the admin opens a subscription THEN the web SHALL show its periods, extrato and actions (Ajustar saldo, Cancelar, Conceder crédito, Reenviar link). [REC-149]
3. WHEN the admin sells a subscription THEN the API SHALL accept customer, category (public or `admin_only`), base date, room (fixed schedule, with the same conflict check and suggestions), optional coupon and a payment mode `link` (hold 1..720 h, default `payment.pre_reservation_expiry_hours`) or `manual` (justification 5..500 chars). [REC-150]
4. WHEN the sale mode is `link` THEN the system SHALL hold fixed occurrences as `pre_reserved` until the hold, and queue `subscription.sale_link` with a link to `/app/compras/assinaturas/{id}/pagar`. [REC-151]
5. WHEN the sale mode is `manual` THEN the subscription SHALL become active without a charge and the system SHALL audit `subscription.confirm_manual` with the justification. [REC-152]
6. IF a reception user sells, adjusts or cancels THEN the API SHALL return 403 `FORBIDDEN`, while `GET` of the list SHALL be allowed. [REC-153]
7. WHEN the admin resends the link of an `awaiting_payment` sale THEN the system SHALL queue `subscription.sale_link` again (new dedupe key per resend). [REC-154]

**Independent Test**: Sell Turno mensal to a customer with a link, pay it from the customer account, see it active in the list.

---

### P1: Public packages and purchase flow ⭐ MVP

**User Story**: As a visitor, I want to compare packages on Preços e Pacotes and subscribe in a few steps, so that I buy without help.

**Why P1**: PRD §7.1, §8 "no máximo 4 etapas".

**Acceptance Criteria**:

1. WHEN `/precos` loads THEN the packages section SHALL list active public package categories with name, period label, price, average hour value, included hours (hour package) or weekdays and window plus estimated period price (fixed schedule), and a button "Assinar" to `/assinar/{categoryId}`. [REC-155]
2. The `/assinar/{categoryId}` flow SHALL show at most 4 visible steps: (fixed only: Sala e início) → Data base / Resumo → Login → Pagamento. [REC-156]
3. IF the visitor is not logged in at the payment step THEN the web SHALL redirect to `/login?next=/assinar/{categoryId}` and keep the chosen options in the URL. [REC-157]
4. WHEN the summary is shown THEN the web SHALL display price, discount, credits, pay-now, period dates and "Renova automaticamente em {data} por R$ {valor} (cobrança {n} dias antes)" and require the terms and recurring-charge checkboxes. [REC-158]

**Independent Test**: From `/precos` on a phone, subscribe to Pacote 20h in ≤ 4 steps with the sandbox.

---

### P1: Subscription notifications ⭐ MVP

**User Story**: As a subscriber, I want e-mails at every money event of my subscription, so that I never miss a charge.

**Why P1**: PRD §7.2 notifications; AD-008.

**Acceptance Criteria**:

1. The system SHALL render in pt-BR and queue in `email_outbox` the templates `subscription.activated`, `subscription.renewal_charge`, `subscription.renewal_reminder`, `subscription.renewal_approved`, `subscription.renewal_failed`, `subscription.suspended`, `subscription.ended`, `subscription.cancelled`, `subscription.switched`, `subscription.period_ending`, `subscription.price_change`, `subscription.next_period_conflicts`, `subscription.sale_link`, `extra_hours.purchased`, `credit.granted`, `subscription.compensation` and `payment.late_refund` (names as in gestao's notification catalog, AD-025). [REC-159]
2. WHEN a subscription is activated or a renewal fails THEN the system SHALL emit staff events `new_subscription` and `renewal_failed`, honoring `notifications.events`. [REC-160]
3. The renewal charge and reminder e-mails SHALL include amount, due date, method and, for Pix, the copy-paste code. [REC-161]

**Independent Test**: Run a purchase and a renewal with no `RESEND_API_KEY` and read the outbox rows (`not_sent`) in order.

---

## Edge Cases

- IF a tenant books with the package the last minutes and concurrently another booking debits the same period THEN the period row lock SHALL serialize them (REC-32).
- IF the gateway webhook for a renewal arrives twice THEN the second SHALL not change any state (guarded `UPDATE ... WHERE status = 'awaiting_payment'`) (REC-48, REC-49).
- IF a renewal is approved after the subscription was suspended but within grace THEN it SHALL act as regularization (REC-56).
- IF a renewal is approved after the subscription ended THEN the charge SHALL be refunded (REC-19).
- WHEN the active gateway changes THEN new renewals SHALL use Pix until a card of the new provider is saved (REC-52).
- IF a closed day is marked for a date already past THEN no compensation SHALL be generated because nucleo rejects past closures.
- WHEN a fixed-schedule window ends at 00:00 (minute 1440) THEN occurrences SHALL end at 00:00 of the next local day (REC-83).
- IF the reference category changes between quote and booking creation THEN the server SHALL recompute and the stored debit SHALL follow the server value (REC-33).
- IF an extra lot expires between quote and booking creation THEN the server SHALL recompute and may answer `INSUFFICIENT_BALANCE` (REC-27).
- IF coupon `valid_until` passes during a checkout hold THEN the reserved use SHALL still be consumed on approval (assumption "Disabled coupon mid-checkout").
- IF a subscriber's account is anonymized (LGPD) THEN its subscriptions SHALL already be cancelled by gestao's deletion flow; receita jobs SHALL skip users with `status = 'deleted'`.
- WHEN a period's included minutes are less than one booking's debit THEN the package option SHALL report `insufficient` (REC-27).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Task(s) | Status |
| --- | --- | --- | --- | --- |
| REC-01 | P1: Package categories | Tasks | T2, T17 | Implementing |
| REC-02 | P1: Package categories | Tasks | T2, T17 | Implementing |
| REC-03 | P1: Package categories | Tasks | T44 | In Tasks |
| REC-04 | P1: Package categories | Tasks | T3, T44 | Implementing |
| REC-05 | P1: Package categories | Tasks | T17 | Implementing |
| REC-06 | P1: Package categories | Tasks | T17, T14 | Implementing |
| REC-07 | P1: Package categories | Tasks | T18, T19 | Implementing |
| REC-08 | P1: Package categories | Tasks | T18, T19 | Implementing |
| REC-09 | P1: Package categories | Tasks | T27 | In Tasks |
| REC-10 | P1: Buy an hour package | Tasks | T7, T18 | Implementing |
| REC-11 | P1: Buy an hour package | Tasks | T2, T18 | Implementing |
| REC-12 | P1: Buy an hour package | Tasks | T8, T19 | Implementing |
| REC-13 | P1: Buy an hour package | Tasks | T19 | Implementing |
| REC-14 | P1: Buy an hour package | Tasks | T19, T25 | Implementing |
| REC-15 | P1: Buy an hour package | Tasks | T19 | Implementing |
| REC-16 | P1: Buy an hour package | Tasks | T20, T21 | Implementing |
| REC-17 | P1: Buy an hour package | Tasks | T28 | In Tasks |
| REC-18 | P1: Buy an hour package | Tasks | T29 | In Tasks |
| REC-19 | P1: Buy an hour package | Tasks | T21 | Implementing |
| REC-20 | P1: Buy an hour package | Tasks | T25 | In Tasks |
| REC-21 | P1: Buy an hour package | Tasks | T19 | Implementing |
| REC-22 | P1: Pay a booking with package hours | Tasks | T5 | Implementing |
| REC-23 | P1: Pay a booking with package hours | Tasks | T13, T16 | Implementing |
| REC-24 | P1: Pay a booking with package hours | Tasks | T34 | In Tasks |
| REC-25 | P1: Pay a booking with package hours | Tasks | T7, T13 | Implementing |
| REC-26 | P1: Pay a booking with package hours | Tasks | T7, T13 | Implementing |
| REC-27 | P1: Pay a booking with package hours | Tasks | T13, T16 | Implementing |
| REC-28 | P1: Pay a booking with package hours | Tasks | T34 | In Tasks |
| REC-29 | P1: Pay a booking with package hours | Tasks | T13, T16 | Implementing |
| REC-30 | P1: Pay a booking with package hours | Tasks | T16 | Implementing |
| REC-31 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-32 | P1: Pay a booking with package hours | Tasks | T10, T13 | Implementing |
| REC-33 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-34 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-35 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-36 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-37 | P1: Pay a booking with package hours | Tasks | T13, T16 | Implementing |
| REC-38 | P1: Pay a booking with package hours | Tasks | T13 | Implementing |
| REC-39 | P1: Balance ledger and extrato | Tasks | T8 | Implementing |
| REC-40 | P1: Balance ledger and extrato | Tasks | T8, T10 | Implementing |
| REC-41 | P1: Balance ledger and extrato | Tasks | T5, T25, T32 | Implementing |
| REC-42 | P1: Balance ledger and extrato | Tasks | T1, T32 | Implementing |
| REC-43 | P1: Balance ledger and extrato | Tasks | T10, T26 | Implementing |
| REC-44 | P1: Balance ledger and extrato | Tasks | T10, T26 | Implementing |
| REC-45 | P1: Balance ledger and extrato | Tasks | T26 | In Tasks |
| REC-46 | P1: Renewal, suspension and closure | Tasks | T7 | Implementing |
| REC-47 | P1: Renewal, suspension and closure | Tasks | T27 | In Tasks |
| REC-48 | P1: Renewal, suspension and closure | Tasks | T27 | In Tasks |
| REC-49 | P1: Renewal, suspension and closure | Tasks | T21 | Implementing |
| REC-50 | P1: Renewal, suspension and closure | Tasks | T21, T27 | Implementing |
| REC-51 | P1: Renewal, suspension and closure | Tasks | T27 | In Tasks |
| REC-52 | P1: Renewal, suspension and closure | Tasks | T27 | In Tasks |
| REC-53 | P1: Renewal, suspension and closure | Tasks | T20, T28 | Implementing |
| REC-54 | P1: Renewal, suspension and closure | Tasks | T23, T28 | Implementing |
| REC-55 | P1: Renewal, suspension and closure | Tasks | T13 | Implementing |
| REC-56 | P1: Renewal, suspension and closure | Tasks | T23 | Implementing |
| REC-57 | P1: Renewal, suspension and closure | Tasks | T23, T28 | Implementing |
| REC-58 | P1: Renewal, suspension and closure | Tasks | T27 | In Tasks |
| REC-59 | P1: Renewal, suspension and closure | Tasks | T29 | In Tasks |
| REC-60 | P1: Renewal, suspension and closure | Tasks | T1, T20 | Implementing |
| REC-61 | P1: Renewal, suspension and closure | Tasks | T1, T20 | Implementing |
| REC-62 | P1: Extra hours | Tasks | T24 | In Tasks |
| REC-63 | P1: Extra hours | Tasks | T5, T24 | Implementing |
| REC-64 | P1: Extra hours | Tasks | T2, T24 | Implementing |
| REC-65 | P1: Extra hours | Tasks | T24 | In Tasks |
| REC-66 | P1: Extra hours | Tasks | T24 | In Tasks |
| REC-67 | P1: Extra hours | Tasks | T10, T28 | Implementing |
| REC-68 | P1: Extra hours | Tasks | T13 | Implementing |
| REC-69 | P1: Extra hours | Tasks | T40 | In Tasks |
| REC-70 | P1: Extra hours | Tasks | T29 | In Tasks |
| REC-71 | P1: Change and cancel | Tasks | T6 | Implementing |
| REC-72 | P1: Change and cancel | Tasks | T22, T25 | Implementing |
| REC-73 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-74 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-75 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-76 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-77 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-78 | P1: Change and cancel | Tasks | T22 | Implementing |
| REC-79 | P1: Change and cancel | Tasks | T23, T39 | Implementing |
| REC-80 | P1: Change and cancel | Tasks | T23 | Implementing |
| REC-81 | P1: Change and cancel | Tasks | T23 | Implementing |
| REC-82 | P1: Change and cancel | Tasks | T26 | In Tasks |
| REC-83 | P1: Buy a fixed-schedule package | Tasks | T3 | Implementing |
| REC-84 | P1: Buy a fixed-schedule package | Tasks | T18, T36 | Implementing |
| REC-85 | P1: Buy a fixed-schedule package | Tasks | T19 | Implementing |
| REC-86 | P1: Buy a fixed-schedule package | Tasks | T19 | Implementing |
| REC-87 | P1: Buy a fixed-schedule package | Tasks | T19 | Implementing |
| REC-88 | P1: Buy a fixed-schedule package | Tasks | T21, T14 | Implementing |
| REC-89 | P1: Buy a fixed-schedule package | Tasks | T3, T18 | Implementing |
| REC-90 | P1: Buy a fixed-schedule package | Tasks | T3 | Implementing |
| REC-91 | P1: Buy a fixed-schedule package | Tasks | T37 | In Tasks |
| REC-92 | P1: Fixed-schedule lifecycle | Tasks | T20 | Implementing |
| REC-93 | P1: Fixed-schedule lifecycle | Tasks | T20, T27 | Implementing |
| REC-94 | P1: Fixed-schedule lifecycle | Tasks | T16 | Implementing |
| REC-95 | P1: Fixed-schedule lifecycle | Tasks | T16 | Implementing |
| REC-96 | P1: Closed-day compensation | Tasks | T6 | Implementing |
| REC-97 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-98 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-99 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-100 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-101 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-102 | P1: Closed-day compensation | Tasks | T20 | Implementing |
| REC-103 | P1: Closed-day compensation | Tasks | T15 | Implementing |
| REC-104 | P1: Closed-day compensation | Tasks | T8, T15 | Implementing |
| REC-105 | P1: Customer credits | Tasks | T9 | Implementing |
| REC-106 | P1: Customer credits | Tasks | T9 | Implementing |
| REC-107 | P1: Customer credits | Tasks | T7, T9 | Implementing |
| REC-108 | P1: Customer credits | Tasks | T9 | Implementing |
| REC-109 | P1: Customer credits | Tasks | T7, T9, T16 | Implementing |
| REC-110 | P1: Customer credits | Tasks | T16 | Implementing |
| REC-111 | P1: Customer credits | Tasks | T16 | Implementing |
| REC-112 | P1: Customer credits | Tasks | T9 | Implementing |
| REC-113 | P1: Customer credits | Tasks | T9, T28 | Implementing |
| REC-114 | P1: Customer credits | Tasks | T41 | In Tasks |
| REC-115 | P1: Customer credits | Tasks | T16, T19, T24, T27 | Implementing |
| REC-116 | P1: Coupons in checkout | Tasks | T4 | Implementing |
| REC-117 | P1: Coupons in checkout | Tasks | T4, T33 | Implementing |
| REC-118 | P1: Coupons in checkout | Tasks | T4, T11 | Implementing |
| REC-119 | P1: Coupons in checkout | Tasks | T4, T11 | Implementing |
| REC-120 | P1: Coupons in checkout | Tasks | T4, T16 | Implementing |
| REC-121 | P1: Coupons in checkout | Tasks | T33 | In Tasks |
| REC-122 | P1: Coupons in checkout | Tasks | T16 | Implementing |
| REC-123 | P1: Coupons in checkout | Tasks | T11 | Implementing |
| REC-124 | P1: Coupons in checkout | Tasks | T11, T16 | Implementing |
| REC-125 | P1: Coupons in checkout | Tasks | T19, T27 | In Tasks |
| REC-126 | P1: Coupons in checkout | Tasks | T11 | Implementing |
| REC-127 | P1: Coupons in checkout | Tasks | T2, T11 | Implementing |
| REC-128 | P1: Admin coupons screen | Tasks | T42 | In Tasks |
| REC-129 | P1: Admin coupons screen | Tasks | T2, T11, T43 | Implementing |
| REC-130 | P1: Admin coupons screen | Tasks | T11 | Implementing |
| REC-131 | P1: Admin coupons screen | Tasks | T11, T42 | Implementing |
| REC-132 | P1: Admin coupons screen | Tasks | T11 | Implementing |
| REC-133 | P1: Slot discounts | Tasks | T12 | Implementing |
| REC-134 | P1: Slot discounts | Tasks | T2, T12 | Implementing |
| REC-135 | P1: Slot discounts | Tasks | T8, T12 | Implementing |
| REC-136 | P1: Slot discounts | Tasks | T16, T45 | Implementing |
| REC-137 | P1: Slot discounts | Tasks | T12, T45 | Implementing |
| REC-138 | P1: Slot discounts | Tasks | T12, T16 | Implementing |
| REC-139 | P1: Slot discounts | Tasks | T12 | Implementing |
| REC-140 | P1: Slot discounts | Tasks | T12 | Implementing |
| REC-141 | P1: Slot discounts | Tasks | T12 | Implementing |
| REC-142 | P1: Slot discounts | Tasks | T4 | Implementing |
| REC-143 | P1: Perfil → Compras | Tasks | T31, T38 | In Tasks |
| REC-144 | P1: Perfil → Compras | Tasks | T38 | In Tasks |
| REC-145 | P1: Perfil → Compras | Tasks | T24, T41 | In Tasks |
| REC-146 | P1: Perfil → Compras | Tasks | T38 | In Tasks |
| REC-147 | P1: Perfil → Compras | Tasks | T38 | In Tasks |
| REC-148 | P1: Admin subscriptions and sale | Tasks | T26, T46 | In Tasks |
| REC-149 | P1: Admin subscriptions and sale | Tasks | T26, T46 | In Tasks |
| REC-150 | P1: Admin subscriptions and sale | Tasks | T19, T26, T47 | Implementing |
| REC-151 | P1: Admin subscriptions and sale | Tasks | T19 | Implementing |
| REC-152 | P1: Admin subscriptions and sale | Tasks | T19 | Implementing |
| REC-153 | P1: Admin subscriptions and sale | Tasks | T26 | In Tasks |
| REC-154 | P1: Admin subscriptions and sale | Tasks | T26 | In Tasks |
| REC-155 | P1: Public packages and purchase flow | Tasks | T18, T35 | Implementing |
| REC-156 | P1: Public packages and purchase flow | Tasks | T37 | In Tasks |
| REC-157 | P1: Public packages and purchase flow | Tasks | T37 | In Tasks |
| REC-158 | P1: Public packages and purchase flow | Tasks | T37 | In Tasks |
| REC-159 | P1: Subscription notifications | Tasks | T14 | Implementing |
| REC-160 | P1: Subscription notifications | Tasks | T21 | Implementing |
| REC-161 | P1: Subscription notifications | Tasks | T14, T27 | Implementing |

**Coverage:** 161 total, 161 mapped to tasks, 0 unmapped. End-to-end flows re-verify REC-14, REC-16, REC-24, REC-29, REC-41, REC-63, REC-66, REC-85, REC-88, REC-120, REC-123, REC-136, REC-150 in T48–T50.

### Implicit-requirement dimensions sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | REC-01, REC-02, REC-11, REC-21, REC-44, REC-64, REC-76, REC-112, REC-129, REC-134; shared zod schemas in core (AD-024) |
| Failure / partial-failure states | REC-18, REC-19, REC-50, REC-52, REC-54, REC-57, REC-75, REC-78, REC-85, REC-87; gateway calls after commit with persisted `pending` intent (`docs/architecture.md` §6.6) |
| Idempotency / retry / duplicate handling | REC-20 (Idempotency-Key), REC-48 (renewal), REC-51/REC-58 (dedupe keys), REC-104 (compensation unique), duplicate webhooks (edge case), job re-runs (REC-59) |
| Auth boundaries & rate limits | REC-45, REC-112, REC-132, REC-141, REC-153; tenant routes require session + own resources (404 for others' ids); admin routes require MFA (fundacao). Rate limits: N/A because receita adds no unauthenticated mutation (public endpoints are read-only quotes) |
| Concurrency / ordering | REC-32, REC-108, REC-123, REC-87; row locks ordered by id (`docs/architecture.md` §6.6); exclusion constraints for occurrences and slot discounts (REC-135); order-independent daily jobs (assumption) |
| Data lifecycle / expiry | REC-18, REC-53, REC-57, REC-67, REC-70, REC-113, REC-140; ledgers kept forever (append-only, REC-39) |
| Observability | REC-59 (`job_runs` stats), audit for every admin money/minute action (REC-43, REC-82, REC-112, REC-130, REC-139, REC-152), extrato as user-facing ledger (REC-41), outbox as e-mail log (REC-159) |
| External-dependency failure | REC-50 (declined card + retry), REC-52 (missing card / gateway switch), REC-19 (late approval), e-mail provider absent → `not_sent` (AD-008) |
| State-transition integrity | REC-60, REC-61 (subscription and period machines), REC-73 (switch atomic), REC-80/REC-81 (cancel), REC-49/REC-54 (fixed occurrence statuses), REC-124 (coupon use states) |

---

## Success Criteria

- [ ] Every PRD worked example of §5.3.1, §5.3.2 and §5.2 compensation is asserted verbatim in `packages/core` tests and in at least one API integration test.
- [ ] A tenant completes the Pacote 20h purchase on a phone viewport in ≤ 4 visible steps and ≤ 3 minutes (Playwright T48 measures the steps).
- [ ] Re-running each receita job against the same data produces zero changed rows (integration tests).
- [ ] Parallel-transaction tests for package debit, credits and the last coupon use pass 20 consecutive runs.
- [ ] Every REC requirement verified by the Verifier with file:line evidence.
