# Receita Design

**Spec**: `.specs/features/receita/spec.md`
**Global blueprint**: `docs/architecture.md` (tables §5.4, core signatures §7.7–§7.11, API conventions §6, routes §9.1). This design covers what receita builds and the contract it needs from `nucleo`; it does not repeat the blueprint.
**Decisions**: AD-001..AD-024 conform; conforms to gestao's AD-025 (notification helper per feature, catalog template names) and AD-027 (credits used as payment are internal `charges`); new AD-030 (subscription checkout states + schema refinements) and AD-031 (receita registrations in nucleo's extension registry and the gaps it must expose); binds to nucleo's AD-033 (extension registry; final names in `.specs/features/nucleo/design.md` "Cross-feature interface map") and AD-035 (zod response contracts in core).
**Status**: Draft

---

## Architecture Overview

### Approaches considered (same scope)

| Approach | Summary | Verdict |
| --- | --- | --- |
| **A. Typed hooks in nucleo's pipeline (chosen)** | nucleo's extension registry (checkout steps, payment-mode handlers, ports) has deferred defaults; receita implements and registers them in `extensions/index.ts`. Booking money and minute changes happen inside nucleo's transaction. | Recommended: one transaction per booking change (balances, coupon counter and occupancy commit together); nucleo ships and tests alone; no import from nucleo to receita (AD-031). |
| B. receita wraps checkout with its own endpoints | Separate `/app/package-bookings`, `/app/checkout-with-coupon` re-implementing booking creation. | Rejected: duplicates the availability/pricing/occupancy path and splits one booking across two code paths. |
| C. Asynchronous events (outbox → handlers) | nucleo writes events; receita consumes later. | Rejected: a coupon's last use and a minute balance must be decided in the same transaction as the slot (PRD §7.6, §8). |

```mermaid
graph TD
  subgraph web[apps/web]
    PUB[/precos PackagesSection, /assinar/:id/] --> HK[features/purchases/api.ts hooks]
    APPC[/app/compras/*/] --> HK
    ADM[Admin: Cupons, Assinaturas tab, SlotDiscountDialog, category forms] --> HK
    BS[nucleo BookingSummary] -->|extension slots| CR[CouponField · CreditsToggle · PackagePaymentOption]
  end
  HK -->|/api/*| R[receita routes]
  BS -->|quote / create| NB[nucleo booking routes]
  NB --> NS[nucleo booking service]
  NS -->|registry steps and handlers in same tx| RH[extensions/index.ts → modules/revenue/*]
  RH --> CS[coupons.service] & SD[slot-discounts.service] & CRS[credits.service] & PP[package-payment.service]
  PP --> MS[minutes.service]
  R --> SUB[subscriptions/*.service]
  SUB --> PAY[nucleo payment service + gateway]
  PAY -->|charge approved/failed| REG[charge handler registry] --> CH[subscriptions/charge-handlers.ts]
  J[/jobs/renewals · period-rollover · suspensions · expire-purchases/] --> SUB
  CD[nucleo close-day flow] -->|ClosedDayCompensationPort| CMP[compensation.service]
  CORE[@bravo/core: discounts, debit, conversion, compensation, occurrences, period, allocation, status, schemas] --> RH & SUB & web
```

Mutation flow (e.g. buy a package): CSRF → `requireAuth` → `Idempotency-Key` → zod (core schema) → `subscriptions/purchase.service` in `withTransaction` (lock user's open subscriptions → create rows → reserve coupon → apply credits → hold occurrences → persist `pending` charge → audit/outbox) → commit → nucleo `submitCharge` → 201. Approval arrives through the gateway webhook/sandbox/reconcile path of nucleo, which dispatches by `charges.purpose` to receita's handler.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| Money/time helpers | `packages/core/src/{money,time}.ts` (fundacao) | `mulDivRoundHalfUp`, `ceilDiv`, `percentOfCents`, `basisPointsOfCents`, `localToUtc`, `addDays`, `diffDays`, `weekdayOf` |
| Settings catalog | `packages/core/src/settings/catalog.ts` | receita keys already defined (§4); read through nucleo's/fundacao's settings loader |
| Pricing engine | `packages/core/src/pricing/{categories,price}.ts` (nucleo) | `selectHourlyCategory`, `priceHourlyBooking`, `averageHourlyCents` → V_slot, average hour value |
| Day/slot rules | `packages/core/src/calendar/day-type.ts`, `slots/grid.ts` (nucleo) | `businessWindow`, `Occupied`, `RejectReason` for occurrence conflicts and free sub-intervals |
| Cancellation/reschedule policy | `packages/core/src/policy/*.ts` (nucleo) | deadline evaluation; receita only decides minute/credit returns |
| Labels | `packages/core/src/labels.ts` (nucleo) | append subscription, period, ledger, coupon-use labels |
| Transactions, audit, outbox, idempotency, errors | `apps/api/src/db/client.ts`, `lib/{audit,email,idempotency,errors}.ts` | every service; `queueEmail` with dedupe keys |
| Auth chain | `middleware/auth.ts` (`requireAuth`, `requireStaff`, `requireRole('admin')`) | tenant, staff and admin-only routes |
| Booking helpers, payment service, gateway, ICS | nucleo modules (see "Required from nucleo") | occurrences, charges, refunds, `.ics` |
| Test harness | `apps/api/test/{global-setup,setup,factories}.ts` | extend with `test/factories/revenue.ts` |
| UI primitives | `components/ui/*` (fundacao), `Table`, `Drawer`, `Popover`, `MonthCalendar`, `StatusBadge`, `BookingSummary`, `PaymentMethodPanel`, `WeekCalendar`, `SlotGrid`, `Stepper`, `useCustomerSearch` (nucleo) | all receita pages |

### Integration Points

| System | Integration Method |
| --- | --- |
| nucleo booking pipeline | Registry registrations in `apps/api/src/extensions/index.ts` (AD-031) |
| nucleo payments | `createCharge`/`submitCharge`/`refundCharge`/`cancelCharge` + `Registry.chargeHandlers` (nucleo T6, T17, T18) |
| nucleo close-day flow | `ClosedDayCompensationPort` |
| nucleo admin category API | `CategoryHandler` × 2 + `onUpdate` (nucleo T6, T13) |
| Neon Function Triggers | `neon.ts`: `0 6 * * *` → `/jobs/renewals`, `/jobs/period-rollover`, `/jobs/suspensions`; `*/5 * * * *` → `/jobs/expire-purchases` |
| Database | migrations `<n>_receita` + `<n>_receita_constraints` (§5.4 + AD-030 deltas) |

---

## Required from nucleo

receita executes after nucleo is merged (AD-013). nucleo's design (`.specs/features/nucleo/design.md` "Extension registry (T6)") already defines `apps/api/src/extensions/registry.ts` and the web `extensions/slots.tsx`; receita registers everything in `apps/api/src/extensions/index.ts` and in the web slot map (AD-031). Before Phase 3 (Lane A) and Phase 7 (Lane B) the worker greps for each item below; a missing item stops the worker with a report to the orchestrator.

### A. Provided by nucleo's registry (receita implements these)

| nucleo seam | receita registration | Purpose |
| --- | --- | --- |
| `CheckoutStep` `discount` (order 100) | `revenue/steps/discount-step.ts` | coupon vs slot discount (`chooseDiscount`); writes `draft.discount` and `draft.extensions.discount`; `persist` reserves the coupon use; `onConfirmed` consumes the use and the slot-discount part; `release` releases the use |
| `CheckoutStep` `package` (order 200) | `revenue/steps/package-step.ts` | fills `draft.packageDebit` and `draft.extensions.package`; sets `draft.paymentMode = 'package'` when `request.payWith = 'package'`; `persist` debits minutes (422 `INSUFFICIENT_BALANCE` aborts the booking) |
| `CheckoutStep` `credit` (order 400) | `revenue/steps/credit-step.ts` | `creditAvailableCents` and `draft.extensions.credit`; `persist` applies credits (internal charge, gestao AD-027); `release(tx, booking, reason, result)` returns them per `allocateRefund` |
| `PaymentModeHandler` `package` | `revenue/package-mode.ts` | `reschedule` re-debit; `cancel` minute returns (REC-34..REC-38) |
| `PaymentModeHandler` `subscription` | `revenue/subscription-mode.ts` | `reschedule` → `payNowCents: 0`; `cancel` → nothing (REC-94, REC-95) |
| `CreditPort` (`mode: 'live'`) | `credits/credit-port.ts` | `availableCents`, `grant` (reschedule difference, clinic cancellation); on install backfills every `booking_events.data.creditGrant` with `status: 'deferred'` into a credit lot (AD-033) |
| `ClosedDayCompensationPort` | `subscriptions/compensation.service.ts` | `preview` / `apply` (REC-97..REC-104) |
| `AvailabilityDecorator` | `slot-discounts/availability-decorator.ts` | sets `discountPercent` on available public cells (REC-136) |
| `CategoryHandler` × 2 | `subscriptions/category-handlers.ts` | `hour_package` / `fixed_schedule` schema + `toRow` (REC-01, REC-02) |
| `NotificationPort.notifyStaff` | used, not replaced | staff events `new_subscription`, `renewal_failed` with `{ entityId }` |
| payments `applyProviderStatus` | used | approvals of receita charges arrive here (gap 1) |
| `runJob`, `verifyTriggerRequest` | used by receita jobs | advisory lock, `job_runs`, trigger auth |
| web `Slot` names (nucleo `apps/web/src/extensions/slots.tsx`) | `checkout.summary.discount` (CouponField), `checkout.summary.credits` (CreditsToggle), `checkout.summary.payWith` (PackagePaymentOption), `pricing.packages` (PackagesSection), `admin.reservations.tabs` (AssinaturasTab), `admin.reservations.headerActions` (Vender assinatura), `admin.calendar.freeSlotActions` + `admin.calendar.overlays` (slot discounts), `admin.categories.forms` (package forms), `booking.detail.extra` (package debit detail) | mount receita UI |
| web test infra | `test/msw/handlers.ts`, fixtures parsed by contract schemas at import | Lane B fixtures follow the same pattern |

### B. Former gaps, closed by nucleo (final names)

All eight items are in nucleo's plan (`.specs/features/nucleo/design.md` "Cross-feature interface map"); receita code uses the nucleo names below.

| # | Need | nucleo name | nucleo task |
| --- | --- | --- | --- |
| B1 | Charge purpose handlers + booking-less charges | `Registry.chargeHandlers[purpose].onApproved(tx, ctx, charge)` / `.onFailed(tx, ctx, charge, status)` dispatched by `applyProviderStatus`; `createCharge(tx, ctx, { purpose, userId, bookingId?, amountCents, method, savedCardId?, expiresAt, description })`, `submitCharge(db, chargeId)`, `refundCharge(tx, ctx, { chargeId, amountCents, reason })`, `cancelCharge(tx, ctx, chargeId)` | T6, T17, T18 |
| B2 | Credit refunds on cancellation | `CheckoutStep.release(tx, booking, 'cancelled', result)` with the `evaluateCancellation` result | T6, T23 |
| B3 | Category update hook | `CategoryHandler.onUpdate(tx, before, after, ctx)` called before persisting (may throw 409) | T6, T13 |
| B4 | Staff events | `StaffEvent` includes `new_subscription`, `renewal_failed`; `notifyStaff(event, { entityId, ... })` | T6 |
| B5 | Fixed occurrences in nucleo flows | `expire-holds` skips `kind = 'fixed_occurrence'`; closed-day preview/apply leave them to `ClosedDayCompensationPort`, whose `preview` returns `{ subscribers, minutes, creditCents, fixedOccurrencesCancelled }` | T11, T26 |
| B6 | Booking helpers | `insertBookingWithOccupancy(tx, row)`, `transitionBooking(tx, ctx, id, from[], to, reason, data?)`, `newBookingCode()`, `buildIcs({ method, events[] })`, `loadDayContexts(db, { roomId, dates })`, `getReferenceCategory(db)`, `listSavedCards(db, userId)` | T7, T14, T18, T19, T20 |
| B7 | Zero payable amount | NUC-207 (booking confirmed without charge) | T20 |
| B8 | Web | slot names of table A; `SlotGrid` cell `discountPercent`; `WeekCalendar` `onRangeSelect` + `markers`; admin events `packageMinutes` (filled by receita T13); `PaymentMethodPanel` given a `ChargeIntent`; exported `useCustomerSearch` | T29, T32, T33, T39, T25 |
| — | Checkout data for the web | steps write `draft.extensions.<step>`; nucleo returns it as `Quote.extensions` plus `Quote.creditAvailableCents`; quote request carries `couponCode`, `useCredits`, `payWith: 'money' \| 'package'` | T1, T9 |

---

## Components

### `@bravo/core` (receita modules, pure)

- **`status/subscription.ts`** — `SubscriptionStatus` (`awaiting_payment|active|suspended|ended|cancelled|switched|expired`), `PeriodStatus` (`upcoming|awaiting_payment|paid|active|closed|failed|cancelled`), `canTransitionSubscription(from, to)`, `canTransitionPeriod(from, to)`, `assertSubscriptionTransition` (throws `InvalidTransitionError`). Labels appended to `labels.ts`: Aguardando pgto, Ativa, Suspensa, Encerrada, Cancelada, Trocada, Expirada; period labels; ledger labels (Compra, Renovação, Reserva, Estorno, Expiração, Saldo convertido, Saldo transferido, Ajuste manual, Horas extras compradas, Compensação de dia fechado); coupon-use labels (Reservado, Usado, Liberado); credit sources (Diferença de reagendamento, Compensação de dia fechado, Crédito manual, Cancelamento pela clínica).
- **`validation/revenue-schemas.ts`** — request schemas (pt-BR messages): `hourPackageCategoryInput`, `fixedScheduleCategoryInput`, `subscriptionQuoteInput`, `subscriptionPurchaseInput`, `switchInput`, `cancelInput`, `payInput`, `extraHoursPurchaseInput(min,max)`, `couponInput`, `couponToggleInput`, `slotDiscountInput`, `balanceAdjustInput`, `manualCreditInput`, `adminSaleInput`; response contract schemas (zod, used by API tests and web fixtures): `packageOfferSchema`, `occurrenceCheckSchema`, `subscriptionQuoteSchema`, `subscriptionSchema`, `ledgerEntrySchema`, `extraHoursSummarySchema`, `creditsSummarySchema`, `purchaseHistoryItemSchema`, `couponSchema`, `couponUseSchema`, `slotDiscountSchema`, `slotDiscountApplyResultSchema`, `adminSubscriptionRowSchema`, `revenueQuoteSchema` (parses nucleo `Quote.extensions`), `compensationPreviewSchema`; charge payloads reuse nucleo's `chargeIntentSchema` (`@bravo/core/contracts`). Types exported with `z.infer`.
- **`fixed/occurrences.ts`** — `generateOccurrences`, `fixedPeriodPriceCents`, `findOccurrenceConflicts` (architecture §7.11) plus `estimateFixedPeriod({ weekdays, periodDays, pricePerOccurrenceCents }): { minCount; maxCount; minCents; maxCents }` (counts over the 7 possible start weekdays) and `occurrenceConflictLabel(reason)`. `generateOccurrences` takes `notBefore?: Date` to drop occurrences starting before `now + min_advance`.
- **`pricing/discounts.ts`** — `couponDiscountCents`, `slotDiscountCents`, `chooseDiscount`, `validateCoupon` (architecture §7.7) + `couponRejectMessage(reason)` and `discountNote(choice)`.
- **`packages/debit.ts`** — `vPacCents(pkg)` (half-up), `packageDebitMinutes` (architecture §7.8), `formatDebitDetail(detail): string` ("60 min + 18 min de excedente = 78 min").
- **`packages/conversion.ts`**, **`packages/compensation.ts`** — architecture §7.9, §7.10.
- **`packages/period.ts`** — `periodDaysOf(period)`, `periodBounds(startsOn, periodDays) → { startsOn; endsOn }`, `chargeDueAt(startsOn, renewalDaysBefore): Date`, `isDateInPeriod(date, p)`, `graceEndsOn(startsOn, graceDays)`, `periodEndNoticeDates(endsOn, [7,1])`.
- **`packages/allocation.ts`** — `allocateMinutes({ debit, packageAvailable, lots: { id; remaining; expiresAt }[], bookingStartsAt, now, usePackage }) → { fromPackage; fromLots: { lotId; minutes }[]; sufficient; available }`; `allocateCredits(lots, amountCents, now) → { lotId; cents }[]`; `allocateRefund({ cashPaidCents, creditPaidCents, refundCents }) → { cashRefundCents; creditRefundCents }` (credit retained first: `creditRefund = credit − min(credit, retained)`).

### API services (`apps/api/src/modules/*`)

| Service | File | Responsibilities (all inside the caller's `tx` unless noted) |
| --- | --- | --- |
| Credits | `credits/credits.service.ts` | `grantCredit(tx, ctx, { userId, amountCents, source, ref?, justification? })`, `availableCredit(db, userId, now)`, `applyCredits(tx, ctx, { userId, amountCents, purpose, bookingId?, periodId?, purchaseId? }) → { usedCents; chargeId | null }` (locks lots `FOR UPDATE` by id, internal charge), `refundCredit(tx, ctx, { chargeId, amountCents })`, `expireCredits(tx, now)`, `listCredits(db, userId)` |
| Minutes | `packages/minutes.service.ts` | period ledger: `grantPeriod`, `debitPeriod`, `refundPeriod`, `expirePeriod`, `adjustPeriod` (admin, audit); extra lots: `createLot`, `debitLots`, `refundLot`, `expireLots`; `lockPeriod(tx, id)`; balance cache update in the same statement batch |
| Package payment | `packages/package-payment.service.ts` | `quotePackageOption(db, userId, draft, now)`, `debitForBooking(tx, ctx, bookingId, draft)`, `returnForCancellation(tx, ctx, bookingId, { withinDeadline, actor })`, `redebitForReschedule(tx, ctx, bookingId, newDraft)` |
| Coupons | `coupons/coupons.service.ts` | CRUD + toggle (audit), `evaluateCoupon(db, { code, userId, target, grossCents, now })`, `reserveUse(tx, …)` (atomic `UPDATE … RETURNING`), `consumeUse`, `releaseUse`, `listUses` |
| Slot discounts | `slot-discounts/slot-discounts.service.ts` | `applyDiscount(tx, ctx, input)` (free sub-intervals), `listDiscounts(db, range)`, `removeDiscount`, `activeFor(db, …)`, `consumeForBooking(tx, bookingId)` (split remainder) |
| Registry registrations | `revenue/steps/*.ts`, `revenue/*-mode.ts`, `apps/api/src/extensions/index.ts` | checkout steps, payment-mode handlers, credit port, availability decorator, category handlers and charge handlers of "Required from nucleo" A and B |
| Compensation | `subscriptions/compensation.service.ts` | `previewClosedDay`, `applyClosedDay`, `compensateKnownClosedDays(tx, periodId)` |
| Category handlers | `subscriptions/category-handlers.ts` | `CategoryHandler` × 2 + `onUpdate` (lock rule REC-05, price-change e-mails REC-06) |
| Quote | `subscriptions/quote.service.ts` | `listPackageOffers`, `checkOccurrences` (+ suggestions), `quoteSubscription` |
| Purchase | `subscriptions/purchase.service.ts` | `purchaseSubscription(tx, ctx, input)` (tenant) and `sellSubscription` (admin link/manual) |
| Period lifecycle | `subscriptions/period.service.ts` | `activatePeriod`, `closePeriod`, `holdNextFixedPeriod`, `createRenewalPeriod` |
| Charge handlers | `subscriptions/charge-handlers.ts` | handlers for `subscription_initial`, `subscription_renewal` (approved/failed, late refund) |
| Switch | `subscriptions/switch.service.ts` | `quoteSwitch`, `startSwitch`, `completeSwitch` (called by the initial handler when `subscriptions.switch_from_subscription_id` is set) |
| Admin and customer reads | `subscriptions/admin-queries.service.ts` | `listAdminSubscriptions(db, filters, cursor)`, `getAdminSubscription(db, id)`; gestao Clientes/LGPD reads (gestao R12): `getCustomerSubscriptions(db, userId)`, `getCustomerBalances(db, userId)` (minutes per open period, extra lots, credit lots), `listCouponUsesByUser(db, userId)` |
| Tenant e-mail helper | `subscriptions/revenue-mailer.ts` | `revenueMailer.<template>(tx, ...)` → `queueEmail`; the single receita notification helper that gestao rewires to `emit()` (AD-025, gestao R7) |
| Cancel & pay | `subscriptions/cancel.service.ts` | `cancelPreview`, `cancelSubscription`, `payPending` (pay awaiting/regularize suspended) |
| Extra hours | `extra-hours/extra-hours.service.ts` | `extraHoursSummary`, `purchaseExtraHours`, handler for `extra_hours` |

### Routes (thin: zod → service → contract schema)

| File | Endpoints |
| --- | --- |
| `routes/public/packages.ts` | `GET /public/packages`, `GET /public/packages/:categoryId/occurrences?roomId&baseOn` |
| `routes/app/subscriptions.ts` | `POST /app/subscriptions/quote`, `POST /app/subscriptions` (Idem), `GET /app/subscriptions`, `GET /app/subscriptions/:id`, `GET /app/subscriptions/:id/ledger`, `POST /app/subscriptions/:id/switch/quote`, `POST /app/subscriptions/:id/switch` (Idem), `GET /app/subscriptions/:id/cancel-preview`, `POST /app/subscriptions/:id/cancel`, `POST /app/subscriptions/:id/pay` (Idem) |
| `routes/app/purchases.ts` | `GET /app/extra-hours`, `POST /app/extra-hours` (Idem), `GET /app/credits`, `GET /app/purchases/history` |
| `routes/admin/coupons.ts` | `GET/POST /admin/coupons`, `PUT /admin/coupons/:id`, `PATCH /admin/coupons/:id/enabled`, `GET /admin/coupons/:id/uses` (admin) |
| `routes/admin/slot-discounts.ts` | `GET /admin/slot-discounts?from&to&roomId` (staff), `POST /admin/slot-discounts`, `DELETE /admin/slot-discounts/:id` (admin) |
| `routes/admin/subscriptions.ts` | `GET /admin/subscriptions` (staff), `GET /admin/subscriptions/:id` (staff), `GET /admin/subscriptions/:id/ledger` (staff), `POST /admin/subscriptions/quote`, `POST /admin/subscriptions` (Idem), `POST /admin/subscriptions/:id/cancel`, `POST /admin/subscriptions/:id/adjust-balance`, `POST /admin/subscriptions/:id/resend-link` (admin) |
| `routes/admin/customer-credits.ts` | `GET /admin/customers/:userId/credits` (staff), `POST /admin/customers/:userId/credits` (admin, Idem) |

Tenant routes return 404 `NOT_FOUND` for ids of other users.

### Jobs (`apps/api/src/jobs/*`, registered in `routes/jobs.ts`)

| Job | Schedule | Work (each step a guarded `UPDATE ... WHERE status = <from>`) |
| --- | --- | --- |
| `renewals` | `0 6 * * *` | create/promote due periods, price, credits, charge (attempt 1), retry declined saved cards (attempt 2), Pix reminders, period-ending notices |
| `period-rollover` | `0 6 * * *` | activate `paid` periods with `starts_on ≤ today` (grant, known closed days, hold next fixed period), close ended active periods (expiry), expire extra lots and credit lots |
| `suspensions` | `0 6 * * *` | suspend at `starts_on` unpaid (release held occurrences), end at grace end |
| `expire-purchases` | `*/5 * * * *` | expire `awaiting_payment` subscriptions and extra-hours purchases past hold (occurrences expired, coupon released, credits refunded, charge cancelled) |

`jobs/cli.ts` (dev/test only, refuses `NODE_ENV=production`): `npm run job -w apps/api -- <name> --now=<iso>` runs a job function with an injected clock (used by e2e).

### E-mail templates

`apps/api/src/emails/templates/revenue.ts` exports one pure function per template of REC-159 (names = gestao notification catalog) returning `{ subject, html, text }`; every call site queues through `revenueMailer`; dedupe keys documented per call site (`subscription.activated:<subId>`, `renewal_charge:<periodId>:<attempt>`, `renewal_reminder:<periodId>:<date>`, `period_ending:<periodId>:<days>`, `price_change:<categoryId>:<version>:<subId>`, `sale_link:<subId>:<n>`, …).

### Web (`apps/web/src`)

| Item | Location | Notes |
| --- | --- | --- |
| Types, fixtures, query hooks | `features/purchases/{types,fixtures,api}.ts` | Types are `z.infer` of the core contract schemas; fixtures parsed by those schemas in tests; keys `['public','packages']`, `['app','subscriptions']`, `['app','subscriptions',id,'ledger']`, `['app','extra-hours']`, `['app','credits']`, `['app','purchases','history']`, `['admin','coupons']`, `['admin','subscriptions',filters]`, `['admin','slot-discounts',range]` |
| `PackageCard`, `BalanceMeter` | `components/revenue/` | offer card; meter "12h 30min de 20h" with `role="meter"` |
| `LedgerTable` | `components/revenue/LedgerTable.tsx` | extrato rows, formula text, signed minutes |
| `CouponField`, `CreditsToggle` | `components/revenue/CouponField.tsx` | rejection message, discount note, "Usar créditos (R$ X disponíveis)" |
| `PackagePaymentOption` | `components/revenue/PackagePaymentOption.tsx` | debit preview, insufficient path |
| `PackagesSection` | `features/purchases/PackagesSection.tsx` | slot `pricing.packages` of nucleo `PricingPage` |
| `FixedSchedulePicker` | `features/purchases/FixedSchedulePicker.tsx` | room + base date + occurrences + conflicts + suggestions |
| `SubscribePage` | `pages/public/SubscribePage.tsx` (`/assinar/:categoryId`) | ≤ 4 steps; `PaymentMethodPanel` |
| `ComprasPage` (+ `SubscriptionCard`, `PayDialog`) | `pages/app/compras/ComprasPage.tsx` | tabs, actions; `/app/compras/assinaturas/:id/pagar` opens `PayDialog` |
| `SwitchPackageDialog`, `CancelSubscriptionDialog` | `features/purchases/SubscriptionDialogs.tsx` | previews |
| `HorasExtrasPage` | `pages/app/compras/HorasExtrasPage.tsx` | |
| `CreditosPage`, `HistoricoPage` | `pages/app/compras/CreditosHistoricoPages.tsx` | |
| `CuponsPage` (+ uses drawer), `CouponFormModal` | `pages/admin/cupons/` | admin-only |
| Package category forms | `features/admin-categories/PackageCategoryForms.tsx` | slot `admin.categories.forms` |
| `SlotDiscountDialog` + overlay/actions | `features/admin-reservas/SlotDiscountDialog.tsx` | slots `admin.calendar.freeSlotActions` + `admin.calendar.overlays`; `WeekCalendar` `onRangeSelect` / `markers` |
| `AssinaturasTab` (+ drawer, `AdjustBalanceDialog`, `GrantCreditDialog`) | `features/admin-reservas/AssinaturasTab.tsx` | `GrantCreditDialog` exported for gestao |
| `SellSubscriptionDialog` | `features/admin-reservas/SellSubscriptionDialog.tsx` | |

---

## API Contracts (JSON, camelCase; types = core contract schemas)

```ts
// ChargeIntent = nucleo contract (chargeIntentSchema): { chargeId; method: 'pix'|'card'|'saved_card'; status; amountCents; expiresAt: string|null;
//   pixQrCodeBase64: string|null; pixCopyPaste: string|null; checkoutUrl: string|null }  — null charge = nothing to pay (credits/coupon cover it)

// GET /api/public/packages
type PackageOffer = { id; name; type: 'hour_package'|'fixed_schedule'; period: 'monthly'|'bimonthly'|'quarterly'; periodDays: 30|60|90;
  priceCents?: number; includedMinutes?: number; avgHourCents: number;                     // hour package
  pricePerOccurrenceCents?: number; weekdays?: number[]; startMinute?: number; endMinute?: number;
  estimate?: { minCount; maxCount; minCents; maxCents } };                                 // fixed schedule
// → { items: PackageOffer[] }

// GET /api/public/packages/:categoryId/occurrences?roomId&baseOn
type OccurrenceCheck = { startsOn; endsOn; occurrences: { date; startsAt; endsAt }[]; conflicts: { date; reason; label }[];
  periodPriceCents; suggestions: { rooms: { roomId; roomName }[]; baseDates: string[] } };

// POST /api/app/subscriptions/quote  { categoryId, baseOn, roomId?, couponCode?, useCredits? }
type SubscriptionQuote = { startsOn; endsOn; renewsOn; chargeDueOn; priceCents; occurrenceCount?: number; includedMinutes?: number; vPacCents?: number;
  discountCents; couponRejection?: { reason; message }; creditAvailableCents; creditAppliedCents; payNowCents; conflicts?: OccurrenceCheck['conflicts'] };

// POST /api/app/subscriptions  (Idempotency-Key) { ...quote input, paymentMethod: 'pix'|'card'|'saved_card', savedCardId?, acceptTerms: true, acceptRecurring: true }
// → 201 { subscription: Subscription; charge: ChargeIntent | null }
// errors: 409 CONFLICT (has hour package), 409 OCCURRENCE_CONFLICT { details: conflicts }, 422 COUPON_INVALID { details[0].path='couponCode', reason }, 409 COUPON_EXHAUSTED

type Subscription = { id; status; type; category: { id; name }; room?: { id; name }; baseOn; periodDays;
  currentPeriod: Period | null; nextPeriod: Period | null; holdExpiresAt?: string;
  nextCharge: { on: string; amountCents: number; method: 'saved_card'|'pix'; cardLast4?: string } | null;
  balance?: { packageMinutes: number; includedMinutes: number; extraMinutes: number };           // hour package
  occurrences?: { remainingInPeriod: number; next?: { startsAt; endsAt } } };                      // fixed schedule
type Period = { id; seq; startsOn; endsOn; status; priceCents; discountCents; occurrenceCount?; minutesBalance?; heldConflicts?: { date; label }[] };

// GET /api/app/subscriptions/:id/ledger?cursor → { items: LedgerEntry[]; nextCursor }
type LedgerEntry = { id: string; at: string; kind: 'package'|'extra'; entryType; label: string; minutes: number; balanceAfter: number;
  bookingCode?: string; detailText?: string; lotExpiresAt?: string };

// POST /api/app/subscriptions/:id/switch/quote { categoryId, roomId?, baseOn? }
type SwitchQuote = { remainingMinutes?; convertedMinutes?; newIncludedMinutes?; newPeriodTotalMinutes?; releasedOccurrences?; startsOn; endsOn;
  priceCents; creditAppliedCents; payNowCents; conflicts? };
// POST .../switch (Idem) → 201 { subscription (new, awaiting_payment); charge }
// GET .../cancel-preview → { minutesLost?; paidUpcomingPeriodLostCents?; occurrencesReleased?; extraMinutesKept }
// POST .../cancel { confirm: true } → { subscription }
// POST .../pay (Idem) { paymentMethod, savedCardId?, useCredits? } → { charge | null; subscription }

// GET /api/app/extra-hours → { eligible; reason?; unitPriceCents?; minHours; maxHours; lots: { id; source; minutesGranted; minutesRemaining; expiresAt }[]; totalRemainingMinutes }
// POST /api/app/extra-hours (Idem) { hours, useCredits?, paymentMethod, savedCardId? } → 201 { purchase: { id; hours; unitPriceCents; totalCents; status }; charge | null }
// GET /api/app/credits → { availableCents; lots: { id; source; label; amountCents; remainingCents; expiresAt }[]; ledger: { at; entryType; label; amountCents; bookingCode? }[] }
// GET /api/app/purchases/history?cursor → { items: { chargeId; at; description; purpose; method; amountCents; refundedCents; status; statusLabel }[]; nextCursor }

// Checkout data receita's steps add to nucleo's QuoteDraft (discount, packageDebit, creditAvailableCents, notices) and to draft.extensions;
// the web reads nucleo's Quote.extensions ({ discount, credit, package }) through revenueQuoteSchema as:
type RevenueQuote = { discount: { source: 'none'|'coupon'|'slot_discount'; discountCents; slotDiscountCents; couponDiscountCents; couponId?; slotDiscountIds: string[];
    couponRejection?: { reason; message }; note?: string };
  credit: { availableCents; appliedCents };
  packageOption: null | { debitMinutes; fromPackageMinutes; fromExtraMinutes; packageAvailableMinutes; extraAvailableMinutes; sufficient: boolean;
    reason?: 'insufficient'|'outside_period'|'block_category'|'suspended'; breakdown: { startMinute; endMinute; minutes; vSlotCentsPerHour; extraExact: string }[]; detailText } };

// Admin
type Coupon = { id; code; type; discountKind; discountValue; appliesTo; maxUses: number|null; usesCount; perCustomerLimit: number|null; validFrom?; validUntil?; enabled };
type CouponUse = { id; at; customerName; bookingCode?; subscriptionCategory?; discountCents; status: 'reserved'|'consumed'|'released' };
// POST /admin/slot-discounts { roomIds[], date, startMinute, endMinute, percent } → { created: SlotDiscount[]; skipped: { roomId; startMinute; endMinute; reason: 'occupied' }[] }
type SlotDiscount = { id; roomId; startsAt; endsAt; percent; consumed: boolean };
type AdminSubscriptionRow = { id; customer: { id; name }; category: { id; name }; type; room?; baseOn; nextChargeOn?; status; statusLabel; balanceText };
// POST /admin/subscriptions (Idem) { userId, categoryId, baseOn, roomId?, couponCode?, payment: { mode: 'link'; holdHours } | { mode: 'manual'; justification } }
// POST /admin/subscriptions/:id/adjust-balance { minutes, justification } → { period }
// POST /admin/customers/:userId/credits (Idem) { amountCents, justification } → { lot }
type CompensationPreview = { subscribers: number; minutes: number; creditCents: number; fixedOccurrencesCancelled: number };   // = nucleo ClosedDayCompensationPort.preview
```

New error codes (AD-030): 409 `OCCURRENCE_CONFLICT` (`details[]` = `{ path: 'date', message: label, date, reason }`), 422 `COUPON_INVALID` (`details[0] = { path: 'couponCode', message, reason }`). Existing: `COUPON_EXHAUSTED`, `INSUFFICIENT_BALANCE`, `INVALID_TRANSITION`, `CONFLICT`, `POLICY_VIOLATION`.

---

## Data Models (deltas to `docs/architecture.md` §5.4, AD-030)

```text
subscriptions
  status check: ('awaiting_payment','active','suspended','ended','cancelled','switched','expired')
  + hold_expires_at timestamptz                  -- awaiting_payment only
  + sale_mode text check (sale_mode in ('self','link','manual')) not null default 'self'
  + switch_from_subscription_id uuid fk subscriptions   -- pending switch target points to the old one
  unique index subscriptions_one_hour_pkg on (user_id) where type = 'hour_package' and status in ('awaiting_payment','active','suspended')
  index (status, hold_expires_at)

subscription_periods
  status check adds 'cancelled'
  + renewal_attempts smallint not null default 0
  + held_conflicts jsonb not null default '[]'   -- [{ date, reason }]
  check (minutes_balance is null or minutes_balance >= 0)

package_ledger      + index (subscription_id, created_at desc)
extra_minutes_ledger + index (user_id, created_at desc)
coupon_uses          + unique (coupon_id, booking_id) where booking_id is not null
                     + unique (coupon_id, subscription_id) where subscription_id is not null
                     + index (user_id)
extra_hours_purchases + hold_expires_at timestamptz, + index (status, hold_expires_at)
append-only trigger forbid_update_delete() on package_ledger, extra_minutes_ledger, credit_ledger
coupon_uses: UPDATE allowed only status reserved → consumed|released (trigger rejects other changes; never DELETE)
```

`price_snapshot` = `{ categoryVersion, priceCents?, includedMinutes?, pricePerOccurrenceCents?, weekdays?, startMinute?, endMinute? }` per period (renewal re-snapshots). Balances are cached (`minutes_balance`, `minutes_remaining`, `remaining_cents`) and updated in the same transaction as the ledger insert after `SELECT … FOR UPDATE` (ordered by id).

### Lifecycles

```text
Subscription  awaiting_payment ──approve──▶ active ──renewal paid──▶ active
                   │ hold                     │ starts_on unpaid            ▲ pay in grace
                   ▼                          ▼                             │
                 expired                  suspended ──grace end──▶ ended
              active/suspended ──cancel──▶ cancelled ; active ──switch approved──▶ switched
Period        upcoming → awaiting_payment → paid → active → closed
              awaiting_payment → active (paid on/after starts_on) | failed (grace end) | cancelled
Fixed occurrence  awaiting_payment|pre_reserved → confirmed | expired ; held_for_renewal → confirmed | expired | cancelled_by_clinic
```

### Key flows

- **Package booking**: nucleo quote (`payWith: 'package'`) → package step `apply` (`quotePackageOption`: lock-free read) → create → package step `persist` → `debitForBooking` locks period + lots `FOR UPDATE`, recomputes debit with `allocateMinutes`, writes ledger rows and booking columns; insufficient → `AppError(422, INSUFFICIENT_BALANCE)` aborts nucleo's tx.
- **Money booking with coupon/credits**: discount/credit steps `persist` reserve the coupon use (atomic counter) and apply credits (internal charge); `onConfirmed` consumes the use and the slot-discount parts; `release` (expired/cancelled, with the cancellation result) releases the use if not consumed and returns credit per `allocateRefund`.
- **Renewal**: `renewals` → `createRenewalPeriod` (unique seq) → credits → `createCharge` (`renewal:<periodId>:<attempt>`) → commit → `submitCharge`; handler `subscription_renewal.onApproved` → period `paid` (+ occurrences confirmed); `period-rollover` on `starts_on` → close old (expiry) + activate new (grant, compensations, holds).
- **Switch**: `startSwitch` creates the new subscription `awaiting_payment` with `switch_from_subscription_id`; initial handler sees it and calls `completeSwitch` (locks old period, conversion, transitions) in the approval transaction.
- **Close day**: nucleo apply → `ClosedDayCompensationPort.apply(tx, closedDayIds, ctx)` → for each subscription with a period (`active|paid`) covering the date → `compensation.service` (unique insert, lot/credit, occurrence cancellation) → e-mails.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| Balance short at booking creation | 422 `INSUFFICIENT_BALANCE` with required/available; nucleo tx rolled back | "Saldo insuficiente…" + "Comprar horas extras" / "Pagar esta reserva" |
| Coupon invalid / exhausted | 422 `COUPON_INVALID` (reason) / 409 `COUPON_EXHAUSTED` | Message under the coupon field; price unchanged |
| Occurrence conflict | 409 `OCCURRENCE_CONFLICT` with dates; nothing created | Dates listed with "Outra sala" / "Outra data de início" suggestions |
| Occurrence taken during purchase | 23P01 mapped to `OCCURRENCE_CONFLICT` for that date | Same as above |
| Gateway error when submitting a charge | Charge stays `pending`; reconcile (nucleo) or hold expiry resolves it | "Não foi possível iniciar o pagamento. Tente outro método." |
| Card declined on renewal | Period stays `awaiting_payment`; e-mail; retry next day | E-mail "Renovação recusada" with a pay link |
| Late approval after expiry / switch insert conflict | Full refund (`late_approval_conflict`), e-mail | "Pagamento estornado" |
| Duplicate webhook / job re-run | Guarded updates no-op | None |
| Invalid transition (e.g. cancel an ended subscription) | 409 `INVALID_TRANSITION` | "Esta assinatura não permite esta ação" |
| Admin without justification | 422 `VALIDATION_FAILED` | Field error |
| Reception on admin-only route | 403 `FORBIDDEN`; web hides the action | Not shown |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| --- | --- | --- | --- |
| nucleo seams renamed during nucleo execution | `.specs/features/nucleo/design.md` Cross-feature interface map | Lane A blocked at Phase 3/4 | B1–B8 closed in nucleo's plan (table B); Lane A starts with a contract grep; deferred defaults keep nucleo independent (AD-031) |
| Lock ordering across period, lots, credit lots and coupon in one booking tx | `modules/revenue/steps.ts` (planned) | Deadlocks under load | Fixed order: coupon → subscription_periods → extra_minute_lots → credit_lots, each by id; integration test with parallel bookings |
| Three daily jobs fire concurrently | `neon.ts` triggers | Racing transitions | Every transition is a guarded `UPDATE … WHERE status`; jobs re-runnable; tests run jobs in both orders |
| Exact rational extra minutes | `packages/core/src/packages/debit.ts` (planned) | Float drift breaks 78/185/152 | BigInt numerator/denominator, single ceil (architecture §7.8) |
| Fixed switch with overlapping own occurrences | `subscriptions/switch.service.ts` (planned) | Old slots lost or double-booked | Overlapping inserts only at approval after releasing old ones, inside one tx; conflict → refund |
| Free-tier compute for the renewal job | `jobs/renewals.ts` (planned) | Timeouts with many subscriptions | Batches of 50 per transaction, indexed `(status, charge_due_at)`; gateway calls after commit |
| Test gap: nucleo pages modified by Lane B | nucleo web files | Lane B edits can break nucleo tests | Lane B gates run the whole `apps/web` suite; e2e phase covers integrated flows |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Where contract schemas live | Request and response zod schemas in `@bravo/core` (`validation/revenue-schemas.ts`) | Lane B fixtures and Lane A route tests validate against the same schema, so lanes cannot drift (AD-024 extended to responses) |
| Grant timing | Period minutes granted at activation | Single rule for "minutes usable only inside the active period" |
| Credits representation | Internal `charges` row per use (AD-027) | Uniform payment history and DRE input |
| Slot discount consumption | Split on confirmation | Discount survives expired checkouts; disappears only when really booked |
| Late approvals | Always refund | Predictable; avoids re-validating holds after expiry |
| Job clock | Jobs take `now` from deps; `jobs/cli.ts` injects it for e2e | Deterministic tests of date-driven behavior |

## Web-assumed API contract (lane B → confirm in lane A)

Lane B (Phases 7–9, merged) coded these response shapes where the API Contracts section above was silent. Lane A implements them exactly as listed, or changes the web types in `apps/web/src/features/purchases/types.ts` in the same task and notes it.

| Endpoint | Assumed shape / rule |
| --- | --- |
| `GET /admin/subscriptions/:id` | `Subscription` |
| `POST /admin/subscriptions/:id/adjust-balance` | `{ period }` |
| `POST /admin/customers/:id/credits` (grant) | `{ lot }` |
| `PATCH` package / fixed-schedule category | body fields `includedHours`, `pricePerOccurrenceCents` |
| `POST /admin/subscriptions/quote` | `SubscriptionQuote` incl. `conflicts` and `couponRejection` |
| `GET /admin/subscriptions/:id/ledger` | `LedgerPage` |
| `GET /admin/slot-discounts?from&to&roomId` | inclusive `to`; active discounts; `consumed: true` rows count as not free |
| `POST /admin/subscriptions/:id/resend-link`, `POST /admin/subscriptions/:id/cancel` `{ justification }` | admin only; reception reads list/detail/extrato only |
| `POST /app/subscriptions/quote` | requires session; logged-out visitors see a local summary built from public offer + occurrence check |
| Coupon `validUntil` | form date inclusive, sent as next São Paulo midnight (half-open `[validFrom, validUntil)`) |

Lane A notes (Phases 3–4):

- Block-priced intervals: `Quote.extensions.package` is `null` (REC-31), so `PackagePaymentOption`'s `block_category` message branch is never reached; booking with `payWith: 'package'` on a block answers 422 `POLICY_VIOLATION`.
- `PATCH /admin/categories/:id` accepts `includedHours`, `pricePerOccurrenceCents` and `period` (core `categoryUpdateSchema` extended in T17); a field that does not apply to the category type answers 422.
- `GET /admin/customers/:userId/credits` answers `CreditsSummary` (same shape as `GET /app/credits`).

Lane A notes (Phases 5–6):

- Migration `0006_receita_switch_index`: `subscriptions_one_hour_pkg` leaves out an `awaiting_payment` row with `switch_from_subscription_id` set (the pending target of an hour-package switch); it becomes `active` in the approval transaction that switches the old one.
- nucleo seams, additive: `ChargeHandler.onApproved(tx, ctx, charge, effects?)` / `onFailed(…, status, effects?)` receive the payment transaction's after-commit queues (`ChargeEffects`: e-mails, staff notices, refunds); `createCharge` accepts `subscriptionPeriodId`, `extraHoursPurchaseId` and a deterministic `idempotencyKey` (`renewal:<periodId>:<attempt>`). Charge handlers date their writes with `charges.approved_at` (the payment service clock).
- `POST /app/subscriptions` (and every Idempotency-Key route) without the header answers 400 `BAD_REQUEST` (nucleo middleware), not 422; missing consents answer 422 `POLICY_VIOLATION` before the body schema.
- `POST /app/subscriptions/:id/pay` answers 200 `{ charge, subscription }`; `POST /admin/subscriptions/quote` takes the `AdminSaleInput` body (payment ignored); `POST /admin/subscriptions/:id/resend-link` answers 200 `{ queued: true }`, 409 `INVALID_TRANSITION` unless it is an `awaiting_payment` link sale.
- Switch quote: `creditAppliedCents` is 0 (`switchQuoteInput` has no `useCredits`); credits apply on `POST …/switch` with `useCredits`.
- Extrato entry ids are `p:<n>` (package) / `e:<n>` (extra); the extrato of a subscription also lists the user's extra-minute entries. Purchase history lists every charge of the user (internal credit, cancelled and expired ones included).
- `AdminSubscriptionRow.balanceText`: "6h de 20h" (hour package), "N ocorrências no período" (fixed), "—" without an active period.
- SPEC_DEVIATION (`modules/subscriptions/quote.service.ts`): an open holiday keeps the weekday's business hours for a fixed schedule, not the holiday hours. REC-90 says holidays keep their occurrences, and with the holiday opening (09:00) the PRD example (Meio turno 07:00–09:30 from 2026-11-02, 22 occurrences) would conflict on Finados and Consciência Negra.
- `jobs/cli.ts` (`npm run job -w apps/api -- <name> --now=<iso>`) runs through `runJob` on `DATABASE_URL_TEST` (root `.env`), refuses `NODE_ENV=production`; renewal charges take `created_at = --now`, so retries ("next daily run") and Pix reminders ("once per local day") follow the injected clock.

Known risk: the admin sale dialog's fixed-schedule picker uses the public occurrences endpoint, which omits `admin_only` categories (REC-08); for those, only the admin quote's `conflicts` is authoritative.
