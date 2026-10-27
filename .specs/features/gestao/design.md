# Gestão Design

**Spec**: `.specs/features/gestao/spec.md`
**Global blueprint**: `docs/architecture.md` (data model §5.5, API conventions §6, core rules §7, deploy §8, frontend §9). This design covers only what gestao builds or refines; it does not repeat the blueprint.
**Decisions honored**: AD-001..AD-024. New: AD-025 (notification catalog and single emit point), AD-026 (binary uploads and media proxy), AD-027 (finance recognition contract), AD-028 (MCP tool boundary and URL), AD-029 (e2e and quality gates). See `.specs/STATE.md`.
**Status**: Draft

---

## Architecture Overview

Gestao is mostly read models and admin CRUD over data that nucleo and receita already write, plus four platform capabilities: notifications (e-mail + push), calendar feeds, object storage and the MCP server. Pure calculations (revenue recognition, bucketing, DRE matrix, ICS-free helpers) live in `@bravo/core` so the browser preview and the export agree. Two lanes run in parallel worktrees: lane A (backend: `packages/core` + `apps/api`) and lane B (frontend: `apps/web`) against the HTTP contracts in this document; integration, hardening and the production release follow.

Approach alternatives considered for the costly parts:
- **Finance**: SQL views per regime (rejected: Competência spreading and pro-rata extras are awkward and untestable in SQL; core unit tests give PRD-exact cents) vs. **load rows for the range and compute in core (chosen)**.
- **Notifications**: polling `booking_events` from a job (rejected: latency, extra compute on free tier) vs. **synchronous `emit()` in the caller's transaction (chosen, AD-025)**.
- **Photos**: server-side resize with `sharp` (rejected: native binary bundling risk on Neon Functions) vs. **browser WebP resize + public bucket behind a same-origin `/media/*` proxy (chosen, AD-026)**.

```mermaid
graph TD
  subgraph Web[apps/web]
    FIN[Admin Financeiro] --> API
    INT[Admin Integrações] --> API
    OPS[Serviços Extras · Clientes · Salas · Usuários · Auditoria] --> API
    TEN[/servicos-extras · /app/orcamentos · /app/perfil/notificacoes · /app/perfil/privacidade/] --> API
    SW[service worker push-sw.js]
    AN[lib/analytics.ts] -.-> PH[(PostHog / GA4)]
    API[lib/api.ts]
  end
  API -->|/api/* proxy| H[Hono app]
  MCPC[MCP client] -->|bearer, native URL| MCP[/mcp server/]
  CAL[Google / Outlook] -->|GET /api/ics/:token.ics| ICS[ics routes]
  CRON[Neon triggers] -->|/jobs/*| JOBS[email-retry · retention · recurring-expenses · holiday-reminder · import-holidays]
  H --> SVC[gestao services]
  MCP --> TOOLS[tool registry] --> SVC
  MCP --> NSVC[nucleo / receita services]
  SVC --> CORE[@bravo/core finance · notifications catalog · schemas]
  SVC --> DB[(Postgres)]
  SVC --> NOTIF[notifications.emit]
  NSVC --> NOTIF
  NOTIF --> OUT[email_outbox] -. after commit .-> RS[Resend]
  NOTIF -. after commit .-> WP[web-push VAPID] -.-> SW
  SVC --> S3[lib/storage.ts] --> OS[(Neon Object Storage: room-photos public_read · expense-attachments private)]
  Web -->|/media/*| NP[Netlify proxy] --> OS
```

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| `withTransaction`, `Tx`, `db` | `apps/api/src/db/client.ts` (fundacao) | Every gestao mutation; notifications and audit join the caller's `tx` |
| `audit(tx, ctx, input)`, `RequestContext` | `apps/api/src/lib/audit.ts` (fundacao) | All mutations; MCP sets `origin = 'mcp'` |
| `queueEmail`, `dispatchEmails` | `apps/api/src/lib/email.ts` (fundacao) | `notifications.emit` queues through it; `email-retry` job reuses `dispatchEmails` |
| `encryptSecret`, `decryptSecret`, `randomToken`, `sha256Hex` | `apps/api/src/lib/crypto.ts` (fundacao) | Gateway credentials, ICS and MCP tokens |
| `consumeRateLimit`, `rateLimitKey` | `apps/api/src/middleware/rate-limit.ts` (fundacao) | Feeds, MCP, quotes, test e-mail, export |
| `requireAuth`, `requireStaff`, `requireRole('admin')` | `apps/api/src/middleware/auth.ts` (fundacao) | Route guards; MCP builds an `AuthContext` from the token owner |
| `AppError` + helpers, `validate()` | `apps/api/src/lib/errors.ts`, `middleware/validate.ts` (fundacao) | Error envelope; new codes below |
| `requireJson` | `apps/api/src/app.ts` (fundacao) | Extended to skip binary upload routes (AD-026) |
| `settingsCatalog`, `parseSetting` | `packages/core/src/settings/catalog.ts` (fundacao) | Adds `usage.limits`; reads `notifications.events`, `mcp.*`, `calendar.holiday_review_reminder` |
| `money.ts`, `time.ts`, `labels.ts`, `access.ts` | `packages/core/src` (fundacao/nucleo) | Formatting, local dates, status labels, section map |
| Password-reset token flow | `modules/auth` (fundacao) | Staff invite link (72 h) |
| `buildRedirects` | `apps/web/scripts/write-redirects.mjs` (fundacao) | Adds optional `/media/*` rule |
| `neon.ts` | root (fundacao + nucleo triggers) | Append buckets and gestao triggers |
| UI kit (`Button`, `Field`, `Table`, `Tabs`, `Modal`, `Drawer`, `Badge`, `Alert`, `Toast`, `EmptyState`) | `apps/web/src/components/ui` (fundacao/nucleo) | All gestao screens |
| `AdminShell`, `RequireSection`, `ForbiddenPage` | `apps/web/src/components/layout` (fundacao) | Reception restrictions in the web |
| Playwright config and sandbox checkout page | `apps/web/e2e`, `/pagamento/sandbox/:chargeId` (nucleo) | MVP e2e journey |

### Required from nucleo/receita

Gestao runs after both features. Every contract below is delivered by the cited producer task under the name shown (reconciled with `.specs/features/nucleo/design.md` "Cross-feature interface map" and receita's plan); items marked *bridge* are rewired by gestao T43.

| # | Owner | Contract (final name in the producer's plan) | Delivered by | Used by |
| --- | --- | --- | --- | --- |
| R1 | nucleo | Every approved payment is a `charges` row with `purpose`, `method`, `approved_at`, `fee_cents` filled from the provider (sandbox: 0), `refunded_cents`, and `booking_id` set for booking purposes; refunds are `refunds` rows with `status = 'approved'` and `completed_at` (AD-027) | nucleo T5, T18 | T2, T18, T19 |
| R2 | receita | `charges.subscription_period_id` / `extra_hours_purchase_id` set for subscription and extra-hours purposes; credits used as payment are `charges` rows `provider = 'internal'`, `method = 'credit'`, `status = 'approved'` (AD-027) | receita T8, T9, T19, T24 | T2, T18 |
| R3 | nucleo/receita | `bookings.discount_cents`, `credit_applied_cents`, `cancelled_at`, `payment_mode`, `total_cents` (= gross − discount + extras); `subscription_periods.price_cents`, `discount_cents`, `starts_on`, `ends_on`, `paid_at`; `extra_hours_purchases.paid_at`. Booking `extrasCents` = Σ `booking_extra_items.amount_cents` (gestao table) | nucleo T5, T9, T20; receita T8 | T2, T18 |
| R4 | nucleo | `bookings.ics_uid` stable; `ics_sequence` +1 on every reschedule and cancellation; `buildIcs({ method, events[] })` in `lib/ics.ts` for confirmation/reschedule/cancel attachments and `GET /app/bookings/:id/ics` (gestao re-implements `buildIcs` over its serializer in T8, same signature) | nucleo T14, T21, T22, T23 | T8, T10 |
| R5 | nucleo | `listGatewayAdapters(): { provider, label, credentialFields: { key, label, secret }[] }[]`, `resolveGateway(provider, { db, env, fetch })` (credentials from `integration_settings['gateway.<provider>']` via `decryptSecret`), `PaymentGateway.verifyCredentials(creds, environment): Promise<{ ok; message }>` (Mercado Pago `GET /users/me`, sandbox always ok) | nucleo T15, T16 | T11 |
| R6 | nucleo | Checkout extension point = `CheckoutStep` named `extras` (order 300) registered in `apps/api/src/extensions/index.ts`: `apply(ctx, draft)` reads `ctx.request.addons.extras`, appends `draft.extras` lines `{ label, amountCents, ref }` and `draft.extensions.extras`; nucleo adds Σ extras to `netCents` before `splitPayment` and stores it in `total_cents`; `persist(tx, booking, draft, ctx)` writes `booking_extra_items`; quote/create body carries `addons: Record<string, unknown>`; web slot `checkout.summary.extras` (props `{ draft, onChange(addons) }`) | nucleo T6, T9, T29, T38 | T20, T39 |
| R7 | nucleo/receita | One tenant e-mail helper per feature, template names = catalog below: nucleo `modules/booking/booking-mailer.ts` (`bookingMailer.*`), receita `modules/subscriptions/revenue-mailer.ts` (`revenueMailer.*`) (AD-025) *bridge* | nucleo T14; receita T14 | T43 |
| R8 | nucleo/receita | Staff events go through `registry.notifications.notifyStaff(event, { entityId, ... })` after commit at the call sites listed in nucleo design §Extension registry (`new_booking`, `payment_received`, `booking_cancelled`, `pre_reservation_expired`, `payment_issue`) and receita charge handlers (`new_subscription`, `renewal_failed`); gestao registers its `NotificationPort` *bridge* | nucleo T6, T18, T20, T23, T26, T28; receita T21 | T43 |
| R9 | nucleo | `routes/jobs.ts` with `registerJob(name, job)`, `runJob` (advisory lock, `job_runs`), `verifyTriggerRequest` (wraps `parseTriggerDelivery`); `neon.ts` triggers array + `neon.test.ts` | nucleo T26 | T9, T16, T26, T49 |
| R10 | nucleo/receita | Services callable by MCP tools (names in §MCP tool catalog; input schemas from `@bravo/core/contracts` and `validation/revenue-schemas.ts`; gestao wrappers build each service's arguments from `ctx` + tool input) | nucleo T7–T25; receita T9, T11, T12, T19, T23, T26 | T14 |
| R11 | nucleo/receita | Admin-only routes guarded by `requireRole('admin')` (nucleo **A** rows; receita admin rows), the rest by `requireStaff` (gestao's sweep in T44 fixes any miss) | nucleo T10–T25; receita T9–T12, T26 | T44 |
| R12 | receita | Read functions for Clientes/LGPD: `getCustomerSubscriptions(db, userId)`, `getCustomerBalances(db, userId)` (minutes per open period, extra-minute lots, credit lots), `listCouponUsesByUser(db, userId)` in `modules/subscriptions/admin-queries.service.ts` | receita T26 | T23, T25 |
| R13 | nucleo | Public rooms build photo URLs through `registry.roomMedia.photoUrl(storageKey)` (null → placeholder); gestao registers a `RoomMediaPort` returning `toPhotoUrl(key, 'large')` (core `media/room-photo-url.ts`, gestao T1); the web derives `small` by the `-large.webp` → `-small.webp` convention | nucleo T6, T8 | T1, T22, T48 |
| R14 | nucleo/receita | Consents in `consents`: `booking_policy` (nucleo checkout/pay), `recurring_charge` (nucleo saved cards, receita purchase), `subscription_terms` (receita purchase) | nucleo T17, T19, T20; receita T19 | T25 |
| R15 | nucleo | `apps/web/playwright.config.ts` with `webServer` for API (`DATABASE_URL_TEST`, seeded by `apps/api/test/e2e-seed.ts`) and web; sandbox hosted checkout button with accessible name "Aprovar pagamento" | nucleo T39, T49 | T45, T46 |
| R16 | nucleo/receita | `track()` call sites: `RoomsPage` (`view_room`), `TimeStep` (`select_slot`), `SummaryStep` (`begin_checkout`), `CheckoutPage` (`purchase`), receita `SubscribePage` success state (gestao T42 adds `subscription_purchased` there) | nucleo T29, T34, T37, T38, T39; receita T37 | T42 |
| R17 | nucleo | `PATCH /api/admin/categories/:id` for price edits | nucleo T13 | T46 |

### Integration Points

| System | Integration Method |
| --- | --- |
| Neon Object Storage | `@aws-sdk/client-s3` `^3` with `forcePathStyle: true`, credentials/endpoint from injected `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`; presigned GET via `@aws-sdk/s3-request-presigner` `^3`; buckets declared in `neon.ts` (`room-photos: { access: 'public_read' }`, `expense-attachments: {}`) |
| Netlify | `_redirects` rule `/media/*  ${STORAGE_PUBLIC_ORIGIN}/room-photos/:splat  200` emitted only when `STORAGE_PUBLIC_ORIGIN` is set (AD-026); CSP `connect-src`/`script-src` add the analytics hosts |
| Resend | Unchanged REST dispatch from fundacao |
| Web push | `web-push` `^3`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` contact) |
| MCP | `@modelcontextprotocol/sdk` `^1.32.2` streamable HTTP via its `WebStandardStreamableHTTPServerTransport` (no `@hono/mcp`, see Lane A notes T13), stateless (new `McpServer` per request) |
| BrasilAPI | `GET https://brasilapi.com.br/api/feriados/v1/{year}` → `[{ date: 'YYYY-MM-DD', name, type: 'national' }]`, 10 s timeout |
| exceljs | `^4`, workbook built in memory, streamed as the response body |
| PostHog / GA4 | Loaded by `lib/analytics.ts` only when `VITE_ANALYTICS_PROVIDER` is set |
| Lighthouse CI / axe | `@lhci/cli` `^0.15`, `@axe-core/playwright` `^4` (dev only) |

---

## Components

### Core: gestao contracts (`packages/core`)

- **Purpose**: shared catalogs, schemas and pure helpers for web and API.
- **Location**: `packages/core/src/notifications/catalog.ts`, `packages/core/src/validation/gestao-schemas.ts`, `packages/core/src/media/room-photo-url.ts`, `packages/core/src/settings/catalog.ts` (adds `usage.limits`)
- **Interfaces**:
  - `notificationCatalog: Record<NotificationEvent, { audience: 'tenant' | 'staff'; template: string; owner: 'nucleo' | 'receita' | 'gestao'; push?: { title: (d) => string; body: (d) => string; url: (d) => string; tag: string }; staffToggle?: StaffEventKey }>`; `type StaffEventKey = 'new_booking' | 'payment_received' | 'booking_cancelled' | 'new_subscription' | 'renewal_failed' | 'pre_reservation_expired' | 'new_quote_request'` (the `notifications.events` keys); nucleo's `StaffEvent` `payment_issue` maps to `staff.payment_issue` with no toggle (always sent).
  - Schemas (pt-BR messages): `expenseInputSchema`, `expenseCategoryInputSchema`, `manualReceiptInputSchema`, `deleteWithJustificationSchema`, `financeQuerySchema` (`from`, `to`, `grouping: 'week'|'month'|'quarter'`, `regime: 'cash'|'accrual'`, refine ≤ 731 days), `gatewayCredentialsSchema`, `notificationRecipientSchema`, `notificationEventsSchema`, `mcpTokenInputSchema`, `extraServiceInputSchema` (refine online ⇒ price), `quoteRequestInputSchema` (with `website` honeypot), `quoteStatusUpdateSchema`, `roomInputSchema`, `roomPhotoInputSchema`, `staffUserInputSchema`, `roleChangeSchema`, `customerNotesSchema`, `customerProfileSchema`, `auditQuerySchema`, `pushSubscriptionSchema`, `deletionConfirmSchema`.
  - `toPhotoUrl(storageKey: string, variant: 'large' | 'small'): string` → `/media/${storageKey}-${variant}.webp`.
  - Settings key `usage.limits`: `{ dbBytes: int ≥ 1, storageBytes: int ≥ 1, emailsPerMonth: int ≥ 1, emailsPerDay: int ≥ 1 }`, default `{ dbBytes: 536870912, storageBytes: 1073741824, emailsPerMonth: 3000, emailsPerDay: 100 }`.
- **Dependencies**: `zod`.
- **Reuses**: `time.ts`, `validation/document.ts`, `auth-schemas.ts` (`phoneSchema`, `emailSchema`).

### Core: finance engine (`packages/core/src/finance/`)

- **Purpose**: revenue recognition (Caixa/Competência), bucketing, comparison, DRE matrix (AD-027).
- **Location**: `packages/core/src/finance/recognition.ts`, `packages/core/src/finance/report.ts`
- **Interfaces**:
  ```ts
  export type Regime = 'cash' | 'accrual';
  export type RevenueCategory = 'rental_single' | 'subscription_initial' | 'subscription_renewal' | 'extra_hours' | 'extra_services' | 'other';
  export interface ChargeFact { id: string; purpose: ChargePurpose; method: 'pix'|'card'|'saved_card'|'credit'; amountCents: Cents; feeCents: Cents;
    status: 'approved'|'refunded'|'partially_refunded'|'charged_back'; approvedAt: Date; chargedBackAt?: Date;
    booking?: { id: string; startsAt: Date; status: string; cancelledAt?: Date; paymentMode: string; totalCents: Cents; discountCents: Cents; extrasCents: Cents; firstApprovedChargeId: string };
    period?: { id: string; startsOn: LocalDate; endsOn: LocalDate; discountCents: Cents; firstApprovedChargeId: string }; }
  export interface RefundFact { chargeId: string; amountCents: Cents; completedAt: Date }
  export interface ManualReceiptFact { date: LocalDate; category: RevenueCategory; amountCents: Cents; booking?: { startsAt: Date } }
  export interface ExpenseFact { date: LocalDate; categoryId: string; amountCents: Cents }
  export type Line = 'gross' | 'discounts' | 'refunds' | 'fees' | 'expenses';
  export interface Entry { date: LocalDate; line: Line; category: RevenueCategory | string; cents: Cents }   // discounts/refunds/fees/expenses negative
  export function chargeCategory(purpose: ChargePurpose): RevenueCategory;
  export function recognize(args: { regime: Regime; charges: ChargeFact[]; refunds: RefundFact[]; receipts: ManualReceiptFact[]; expenses: ExpenseFact[] }): Entry[];
  export function spreadOverDays(cents: Cents, startsOn: LocalDate, endsOn: LocalDate): { date: LocalDate; cents: Cents }[];  // leftover to earliest days
  export function splitExtras(amountCents: Cents, extrasCents: Cents, totalCents: Cents): { extras: Cents; rental: Cents };    // half-up extras share
  export type Grouping = 'week' | 'month' | 'quarter';
  export function buckets(from: LocalDate, to: LocalDate, grouping: Grouping): { key: string; label: string; from: LocalDate; to: LocalDate }[];
  export interface Totals { grossCents; discountsCents; refundsCents; feesCents; netCents; expensesCents; resultCents }
  export function summarize(entries: Entry[], from: LocalDate, to: LocalDate, grouping: Grouping): { buckets: (Bucket & Totals)[]; totals: Totals; byRevenueCategory: Record<RevenueCategory, Cents>; byExpenseCategory: Record<string, Cents> };
  export function previousRange(from: LocalDate, to: LocalDate): { from: LocalDate; to: LocalDate };
  export function compare(current: Totals, previous: Totals): Record<keyof Totals, { deltaCents: Cents; deltaPercent: number | null }>;
  export interface DreMatrix { months: { key: string; label: string }[]; rows: { code: string; label: string; level: 0 | 1; bold: boolean; values: Cents[]; total: Cents }[] }
  export function buildDre(entries: Entry[], from: LocalDate, to: LocalDate, expenseCategories: { id: string; name: string; displayOrder: number }[]): DreMatrix;
  ```
- **Rules** (spec GES-01..10): Caixa dates = `approvedAt` (charge, fee, discount and credit attached to the booking's/period's first approved charge), `completedAt` (refund), `chargedBackAt` (chargeback), receipt `date`. Competência dates = booking `startsAt` local date, or `cancelledAt` for `cancelled_*`/`expired`; period → `spreadOverDays`; extra hours → `approvedAt`; manual receipt → booking start when linked, else `date`. Gross = cash + discounts + credits; line 2 = −(discounts + credits); line 3 = −refunds; line 4 = −fees. Bookings with `paymentMode` `package`/`subscription` contribute nothing. Extras: each booking receipt split by `splitExtras` before categorizing.
- **Worked examples (mandatory unit tests)**:

| Case | Caixa | Competência |
| --- | --- | --- |
| Booking 2026-12-02 total 21900, deposit 10950 approved 2026-11-20 (fee 109), balance 10950 approved 2026-11-30 | Nov: gross 21900, fees −109 (+ balance fee) | Dec: gross 21900, fees −(109 + balance fee) |
| Same booking with coupon 2000 (total 19900 after discount) | Nov: gross 21900, discounts −2000 | Dec: gross 21900, discounts −2000 |
| Fixed-schedule period 2026-11-02..2026-12-02 (30 days) price 616000 paid 2026-10-31 | Oct: 616000 | Nov: 10 days × 20534 + 20 days × 20533 = 616000 (Nov 2..Dec 1; Dec gets 1 day) |
| Booking total 30000 incl. 8000 extras, one full charge 30000 | rental 22000, extras 8000 | same split on usage date |
| Tenant cancel ≥ 24h: deposit 8000 kept, balance 8000 refunded 2026-11-10 | gross 16000 at approvals, refunds −8000 on Nov 10 | gross 16000 and refunds −8000 on `cancelledAt` date |
| Package-paid booking | nothing | nothing |

- **Dependencies**: `money.ts`, `time.ts`.

### Data layer (`apps/api/src/db/schema/`, migration `<n>_gestao`, seeds)

- **Purpose**: tables of `docs/architecture.md` §5.5 plus refinements below; seeds.
- **Location**: `apps/api/src/db/schema/gestao.ts`, `apps/api/drizzle/<n>_gestao.sql` (+ custom constraints migration), `apps/api/src/db/seed.ts`
- **Refinements to §5.5** (additive, no contradiction):
  - `expenses` adds `attachment_name text`, `attachment_content_type text`; partial unique index `(recurrence_parent_id, date) where recurrence_parent_id is not null and deleted_at is null`; index `(recurrence) where recurrence <> 'none' and deleted_at is null`.
  - `expense_categories.name` unique on `lower(name)`.
  - `quote_requests` adds `check (status in ('new','contacted','quote_sent','won','lost'))`, `source text not null check (source in ('web','app','admin')) default 'web'`.
  - `ics_feed_tokens`: `check ((scope = 'user') = (user_id is not null))`, `check ((scope = 'room') = (room_id is not null))`; partial unique index `(scope, coalesce(room_id, '00000000-0000-0000-0000-000000000000')) where scope in ('clinic','room') and revoked_at is null`.
  - `mcp_tokens` adds index `(owner_user_id) where revoked_at is null`.
  - `push_subscriptions` index `(user_id)`.
  - `booking_extra_items` adds `service_name text not null`, `unit text not null` (frozen labels).
  - `room_photos.storage_key` convention `rooms/<roomId>/<uploadId>`; objects `<key>-large.webp`, `<key>-small.webp`.
- **Seeds** (insert-if-missing): 14 expense categories of §5.5 in that order; 3 extra services (`Pacote de filmagem` 8000/hour, `Videomaker` null/project, `Marketing digital` null/project, all `quote`); settings key `usage.limits`.

### Object storage library

- **Purpose**: one place for S3 access, upload validation and URLs (AD-026).
- **Location**: `apps/api/src/lib/storage.ts`
- **Interfaces**:
  - `type BucketName = 'room-photos' | 'expense-attachments'`; `interface Storage { put(bucket, key, body: Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<void>; head(bucket, key): Promise<{ size: number } | null>; delete(bucket, key): Promise<void>; presignGet(bucket, key, expiresInSeconds: number, downloadName?: string): Promise<string>; totalBytes(bucket, maxObjects = 10000): Promise<number> }`.
  - `createS3Storage(env): Storage` (`forcePathStyle: true`); `AppDeps.storage` injectable; tests use `memoryStorage()`.
  - `readBinaryBody(c, { maxBytes: 5 * 1024 * 1024, allowed: string[] }): Promise<{ bytes: Uint8Array; contentType: string }>` — enforces `Content-Length`/streamed size (413 `PAYLOAD_TOO_LARGE`) and magic bytes (`%PDF-`, `FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`) (415 `UNSUPPORTED_MEDIA_TYPE`).
- **Dependencies**: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

### Notifications service (AD-025)

- **Purpose**: single emit point for tenant and staff notifications; e-mail via outbox, push after commit.
- **Location**: `apps/api/src/modules/notifications/notifications.service.ts`, `apps/api/src/lib/push.ts`, `apps/api/src/routes/app/push.ts`
- **Interfaces**:
  - `emit(tx: Tx, ctx: RequestContext, event: { name: NotificationEvent; entityId: string; userId?: string; to?: string; data: Record<string, unknown>; email?: { subject; html; text; attachments? } }): Promise<{ outboxIds: string[]; pushIntents: PushIntent[] }>` — tenant events: queue the given e-mail (rendered by the owning feature's template) with `to` = user e-mail, and collect a push intent when the catalog has `push`; staff events: if `notifications.events[toggle]` is true, render `staff.<event>` for each active recipient with dedupe key.
  - `afterCommit(db, result, deps)` → `dispatchEmails(...)` then `sendPush(...)`; never throws.
  - `sendPush(db, intents, deps: { webPush; env; now })` — skips when VAPID unset; 404/410 → delete; other error → `failure_count + 1`, delete at 5; success → `last_success_at`, `failure_count = 0`.
  - Routes: `POST /api/app/push/subscriptions` (201), `DELETE /api/app/push/subscriptions` body `{ endpoint }` (204); `GET /api/public/config` (fundacao) adds `vapidPublicKey`.
  - Bridge (T43): `modules/notifications/staff-port.ts` implements nucleo's `NotificationPort` (`notifyStaff(event, { entityId, ... })` → `withTransaction(emit)` + `afterCommit`, dedupe by `entityId`) and is registered in `apps/api/src/extensions/index.ts`; `bookingMailer` and `revenueMailer` keep their signatures and call `emit` instead of `queueEmail`.

### Notification catalog

| Event | Audience | Template (owner) | Push | Staff toggle |
| --- | --- | --- | --- | --- |
| `booking.confirmed` | tenant | `booking.confirmed` (nucleo, with .ics) | "Reserva confirmada" | — |
| `booking.balance_charge` / `booking.balance_reminder` / `booking.balance_charged` / `booking.balance_card_failed` | tenant | nucleo | "Pagamento do saldo" | — |
| `booking.reminder_24h`, `booking.reminder_2h` | tenant | nucleo | "Sua reserva é amanhã" / "Sua reserva começa em 2h" | — |
| `booking.cancelled` / `booking.cancelled_nonpayment` | tenant | nucleo (METHOD:CANCEL .ics) | "Reserva cancelada" | — |
| `booking.rescheduled` | tenant | nucleo (updated .ics) | "Reserva reagendada" | — |
| `booking.pre_reservation_link`, `booking.pre_reservation_expired`, `booking.late_approval_refund` | tenant | nucleo | yes | — |
| `account.set_password` | tenant (counter-created customer) | nucleo | no | — |
| `subscription.activated`, `subscription.renewal_charge`, `subscription.renewal_reminder`, `subscription.renewal_approved`, `subscription.renewal_failed`, `subscription.suspended`, `subscription.ended`, `subscription.cancelled`, `subscription.switched`, `subscription.period_ending`, `subscription.price_change`, `subscription.next_period_conflicts`, `subscription.sale_link`, `subscription.compensation`, `extra_hours.purchased`, `credit.granted`, `payment.late_refund` (receita REC-159) | tenant | receita | yes | — |
| `subscription.card_reregister` | tenant | gestao | "Atualize seu cartão" | — |
| `quote.received` | requester | gestao | no | — |
| `privacy.account_deleted` | requester | gestao | no | — |
| `staff.new_booking`, `staff.payment_received`, `staff.booking_cancelled`, `staff.new_subscription`, `staff.renewal_failed`, `staff.pre_reservation_expired`, `staff.new_quote_request` | staff recipients | gestao | no | the matching key |
| `staff.payment_issue` | staff recipients | gestao | no | — (always sent) |
| `staff.holiday_review`, `staff.invite` | admins / invitee | gestao | no | — |
| `system.test` | recipients | gestao | no | — |

### ICS serializer and feeds

- **Purpose**: RFC 5545 output for feeds and per-booking files.
- **Location**: `apps/api/src/lib/ics.ts` (hardened from nucleo), `apps/api/src/modules/ics/ics-feed.service.ts`, `apps/api/src/routes/ics.ts`
- **Interfaces**:
  - `icsEvent(e: { uid; sequence; dtstamp: Date; start: Date; end: Date; summary; location?; description?; status?: 'CONFIRMED'|'TENTATIVE'|'CANCELLED' }): string[]`; `icsCalendar(events: string[][], opts: { method?: 'PUBLISH'|'REQUEST'|'CANCEL'; name: string }): string`; nucleo's `buildIcs({ method, events[], organizerEmail? })` is re-implemented on top of them with its signature unchanged (CRLF, fold 75 octets on UTF-8 boundaries, escape `\\ ; , \n`).
  - `issueFeed(tx, ctx, { scope, roomId?, userId? }): Promise<{ url: string; prefix: string }>`; `revokeFeed(tx, ctx, id)`; `renderFeed(db, tokenRow, now): Promise<string>`.
  - Routes: `GET /api/admin/integrations/calendar` (feeds list), `POST /api/admin/integrations/calendar/feeds` `{ scope: 'clinic'|'room', roomId? }` (201), `DELETE /api/admin/integrations/calendar/feeds/:id` (204); `GET /api/app/calendar-feed` (`{ active, prefix, createdAt }`), `POST /api/app/calendar-feed` (201 `{ url }`), `DELETE /api/app/calendar-feed` (204); `GET /api/app/bookings/:id/ics` is nucleo's route (nucleo T21), switched by gestao T10 to `METHOD:PUBLISH` / `METHOD:CANCEL` (GES-50); `GET /ics/:token.ics` (public; `Cache-Control: private, max-age=300`).
  - Booking pre-reservation and `held_for_renewal` events use `STATUS:TENTATIVE`; LOCATION = "Bravô Clinic — <sala>, Praia Brava, Itajaí – SC".

### Gateway configuration

- **Location**: `apps/api/src/modules/integrations/gateway-config.service.ts`, `apps/api/src/routes/admin/integrations-gateway.ts`
- **Interfaces**: built on nucleo's `listGatewayAdapters()`, `resolveGateway()` and `PaymentGateway.verifyCredentials` (R5). `GET /api/admin/integrations/gateway` → `{ activeProvider, productionWarning, adapters: [{ provider, label, fields, configured, enabled, environment, secretHint, webhookUrl }] }`; `PUT /api/admin/integrations/gateway/:provider` `{ enabled, environment, config, secrets }` (empty secret keeps stored); `POST /api/admin/integrations/gateway/:provider/test` → `{ ok, message }`; `POST /api/admin/integrations/gateway/:provider/activate` → 200 and card re-register e-mails (dedupe `card_reregister:<subscriptionId>:<auditId>`).

### Notification admin

- **Location**: `apps/api/src/routes/admin/integrations-notifications.ts`
- **Interfaces**: `GET /api/admin/integrations/notifications` → `{ providerConfigured, recipients, events }`; `POST .../recipients` `{ email }`; `PATCH .../recipients/:id` `{ active }`; `DELETE .../recipients/:id`; `PUT .../events` record; `POST .../test` `{ to? }` → `{ results: [{ to, status }] }`; `GET /api/admin/integrations/outbox?status&cursor`.

### MCP server (AD-011, AD-028)

- **Location**: `apps/api/src/modules/mcp/mcp-token.service.ts`, `apps/api/src/mcp/server.ts`, `apps/api/src/mcp/tools/*.ts`, `apps/api/src/routes/admin/integrations-mcp.ts`
- **Interfaces**:
  - `issueToken(tx, ctx, input): Promise<{ token: string; record }>`, `revokeToken`, `listTokens`, `authenticateBearer(db, header, now): Promise<{ token; owner: AuthContext } | null>`.
  - `POST /mcp` (and `GET`/`DELETE` per streamable HTTP) mounted in `routes/mcp.ts`: order = `mcp.enabled` (404) → bearer (401) → rate limit `mcp:token:<id>` (429) → transport. Admin: `GET /api/admin/integrations/mcp` → `{ enabled, serverUrl, serverUrlWarning, tools: [{ name, description, scope, destructive }], tokens }`, `PUT /api/admin/integrations/mcp` `{ enabled }`, `POST .../tokens`, `DELETE .../tokens/:id`.
  - `defineTool({ name, description, scope: 'read'|'write', destructive?: boolean, input: ZodSchema, preview?: (db, ctx, input) => Promise<string>, run: (db, ctx, input) => Promise<unknown> })`; wrapper validates input, enforces scope and `confirm: true`, writes `mcp.<tool>` audit, maps `AppError` to tool errors `{ code, message, details }`.

### MCP tool catalog

`ctx.origin = 'mcp'`, actor = token owner (admin). The Service column names the producer function (nucleo design §Components, receita design §API services); the tool wrapper builds its arguments from `ctx` and the tool input (R10).

| Tool | Scope | Destructive | Service |
| --- | --- | --- | --- |
| `agenda_list` (from, to, roomId?, status?) | read | no | nucleo `adminCalendarEvents` |
| `availability_get` (roomSlug, date) | read | no | nucleo `getDayAvailability` |
| `booking_get` (id or code) | read | no | nucleo `serializeBookingDetail` |
| `bookings_search` (q, status, from, to) | read | no | nucleo `listBookings` |
| `booking_create` (customerId, roomId, start, end, confirmManually?, justification?) | write | no | nucleo `staffCreateBooking` (`kind: 'booking'`) |
| `pre_reservation_create` (customerId, roomId, start, end, expiresInHours) | write | no | nucleo `staffCreateBooking` (`kind: 'pre_reservation'`) |
| `booking_confirm_manual` (bookingId, justification) | write | no | nucleo `confirmManual` |
| `booking_check_in` (bookingId) | write | no | nucleo `checkIn` |
| `booking_resend_payment_link` (bookingId) | write | no | nucleo `resendPaymentLink` |
| `booking_reschedule` (bookingId, start, end, exception?, justification?) | write | no | nucleo `applyReschedule` (actor `admin`) |
| `booking_cancel` (bookingId, reason, resolution?) | write | yes | nucleo `previewCancellation` (preview) + `cancelBooking` (actor clinic) |
| `refund_create` (chargeId, amountCents, reason) | write | yes | nucleo `requestRefund` |
| `block_create` (roomIds, start, end, tag) | write | no | nucleo `createBlocks` |
| `block_remove` (blockId) | write | yes | nucleo `deleteBlock` |
| `slot_discount_apply` (roomIds, start, end, percent) | write | no | receita `applyDiscount` |
| `slot_discount_remove` (id) | write | yes | receita `removeDiscount` |
| `subscriptions_list` (status?, customerId?) | read | no | receita `listAdminSubscriptions` |
| `subscription_sell` (customerId, categoryId, baseOn, roomId?, payment) | write | no | receita `sellSubscription` |
| `subscription_cancel` (subscriptionId, justification) | write | yes | receita `cancelPreview` (preview) + `cancelSubscription` |
| `coupons_list` | read | no | receita coupons service list (T11) |
| `coupon_create` (code, type, discountKind, value, ...) | write | no | receita coupons service create (T11, `couponInput`) |
| `coupon_set_enabled` (couponId, enabled) | write | no | receita coupons service toggle (T11) |
| `credit_grant` (customerId, amountCents, justification) | write | no | receita `grantCredit` (source `manual`) |
| `customers_search` (q) / `customer_get` (id) | read | no | gestao customers |
| `customer_notes_update` (id, notes) | write | no | gestao customers |
| `finance_summary` (from, to, grouping, regime) | read | no | gestao finance report |
| `finance_dre` (from, to, regime) → DRE matrix JSON | read | no | gestao finance report |
| `expenses_list` (from, to, categoryId?) | read | no | gestao expenses |
| `expense_create` (date, categoryId, description, amountCents, recurrence?) | write | no | gestao expenses |
| `expense_delete` (expenseId) | write | yes | gestao expenses |
| `manual_receipt_create` (...) | write | no | gestao receipts |
| `quotes_list` (status?) | read | no | gestao quotes |
| `quote_update_status` (id, status, notes?) | write | no | gestao quotes |
| `rooms_list` | read | no | gestao rooms |
| `categories_list` / `policies_get` | read | no | nucleo `listCategories` / policies service GET |
| `audit_list` (filters) | read | no | gestao audit |

Not exposed (AD-028): users/roles, integrations and credentials, MCP tokens, LGPD export/deletion, calendar/price/policy writes, closed days.

### Finance services

- **Location**: `apps/api/src/modules/finance/expenses.service.ts`, `apps/api/src/jobs/recurring-expenses.ts`, `apps/api/src/modules/finance/receipts.service.ts`, `apps/api/src/modules/finance/finance-report.service.ts`, `apps/api/src/modules/finance/dre-xlsx.ts`
- **Routes** (admin only): `GET/POST /api/admin/finance/expense-categories`, `PATCH /api/admin/finance/expense-categories/:id`; `GET /api/admin/finance/expenses?from&to&categoryId&cursor`, `POST`, `PATCH /:id`, `DELETE /:id`; `PUT /api/admin/finance/expenses/:id/attachment` (binary), `GET .../attachment` (302), `DELETE .../attachment`; `GET/POST /api/admin/finance/receipts`, `DELETE /:id` `{ justification }`; `GET /api/admin/finance/summary`; `GET /api/admin/finance/dre.xlsx`.
- `loadFacts(db, { from, to }): Promise<{ charges; refunds; receipts; expenses }>` loads charges approved in range OR whose booking starts/cancels in range OR whose period overlaps range, plus refunds completed in range or attached to those charges; `buildSummary` = core `recognize` + `summarize` + `compare`; `renderDreXlsx(matrix, meta): Promise<Uint8Array>` (sheet "DRE", number format `"R$" #,##0.00;-"R$" #,##0.00`, bold lines 5 and 7, frozen header).
- Recurrence: `nextOccurrences(parentDate, recurrence, lastChildDate | null, today)` (core helper in `finance/report.ts`), job `recurring-expenses` daily `0 9 * * *` UTC.

### Admin operations services

- **Location**: `apps/api/src/modules/extras/extra-services.service.ts` (+ `extras-step.ts`, nucleo `CheckoutStep` `extras` order 300, R6), `apps/api/src/modules/extras/quote-requests.service.ts`, `apps/api/src/modules/rooms/rooms-admin.service.ts`, `apps/api/src/modules/customers/customers.service.ts`, `apps/api/src/modules/users/staff-users.service.ts`, `apps/api/src/routes/admin/audit.ts`
- **Routes**: extras `GET/POST /api/admin/extra-services`, `PATCH /:id`; `GET /api/public/extra-services`; quotes `POST /api/public/quote-requests`, `GET /api/app/quote-requests`, `GET /api/admin/quote-requests?status&cursor`, `PATCH /api/admin/quote-requests/:id` `{ status?, staffNotes? }`; rooms `GET/POST /api/admin/rooms`, `PATCH /:id`, `PUT /api/admin/rooms/:id/photo-uploads/:uploadId/:variant` (binary webp), `POST /api/admin/rooms/:id/photos` `{ uploadId, alt, width, height }`, `PATCH /api/admin/rooms/:id/photos/:photoId` `{ alt?, isCover?, displayOrder? }`, `PUT /api/admin/rooms/:id/photos/order` `{ ids }`, `DELETE /api/admin/rooms/:id/photos/:photoId`; customers `GET /api/admin/customers?q&cursor`, `GET /:id`, `GET /:id/bookings?cursor`, `PATCH /:id/notes`, `PATCH /:id` (admin), `POST /:id/anonymize` (admin); users `GET/POST /api/admin/users`, `PATCH /:id` `{ role?, status? }`, `POST /:id/totp-reset` `{ justification }`; audit `GET /api/admin/audit`.

### Reception allowlist

Reception (MFA-verified) may call only: nucleo `GET /api/admin/calendar/events`, `GET /api/admin/rooms/:roomId/availability`, `GET /api/admin/calendar/closed-days`, `GET /api/admin/bookings`, `GET /api/admin/bookings/export.csv`, `GET /api/admin/bookings/:id`, `POST /api/admin/bookings` (without `confirmManually`), `POST /api/admin/bookings/:id/resend-link`, `POST /api/admin/bookings/:id/check-in`, `GET/POST /api/admin/blocks`, `DELETE /api/admin/blocks/:id`, `GET /api/admin/customers/search`, `POST /api/admin/customers`; receita `GET /api/admin/slot-discounts`, `GET /api/admin/subscriptions`, `GET /api/admin/subscriptions/:id`, `GET /api/admin/subscriptions/:id/ledger`, `GET /api/admin/customers/:userId/credits`; gestao `GET /api/admin/customers*`, `PATCH /api/admin/customers/:id/notes`; fundacao `GET /api/admin/session`. Every other `/admin/*` route (policies, manual confirmation, cleanup exceptions, discounts, subscription sale, refunds, categories, calendar config, coupons, finance, integrations, extras, rooms, users, audit, usage, anonymize, customer profile edit) is admin-only. The sweep test (T44) keeps this table as `RECEPTION_ALLOWLIST` (method + path pattern).

### Privacy (LGPD) and maintenance jobs

- **Location**: `apps/api/src/modules/privacy/privacy.service.ts`, `apps/api/src/jobs/maintenance.ts` (`email-retry` every 5 min, `retention` weekly `0 8 * * 0` UTC), `apps/api/src/jobs/holidays.ts` (`holiday-reminder` `0 11 * * *`, `import-holidays` `0 7 * * 1` calling nucleo `importNationalHolidays(db, year, deps, { renameExisting: false })`), `apps/api/src/modules/usage/usage.service.ts`
- **Routes**: `GET /api/app/me/data-export`; `POST /api/app/me/deletion` `{ password? , confirmText? }`; `GET /api/app/me/consents`; `GET /api/admin/usage`.

### LGPD anonymization

In one transaction: `users` → `status='deleted'`, `name='Usuário removido'`, `email='deleted-<id>@anon.invalid'`, `email_verified_at`, `password_hash`, `google_sub`, `doc_type`, `doc_number`, `phone`, `profession`, `professional_registry`, `notes` → null, `deleted_at=now`; revoke sessions; delete `user_totp`, `push_subscriptions`, `auth_tokens`; revoke `ics_feed_tokens` of the user; `saved_cards.deleted_at=now` (gateway card deletion best effort after commit); `quote_requests` of the user → `name='Removido'`, `email=null`, `phone='removido'`; `email_outbox` rows to the old address created before the request → `to_address='deleted-<id>@anon.invalid'`, `html=''`, `text_body=''`, `attachments='[]'`. Kept: bookings, charges, refunds, ledgers, subscriptions, consents, audit rows (fiscal/legal retention). The `privacy.account_deleted` confirmation is queued before the outbox rewrite and excluded from it.

### Web: Admin screens (lane B)

- **Location**: `apps/web/src/components/ui/{StatTile,EvolutionChart,FileUpload,CopyField,TokenList}.tsx`; `apps/web/src/features/admin-finance/`, `admin-integrations/`, `admin-extras/`, `admin-customers/`, `admin-rooms/`, `admin-users/`, `admin-audit/`; pages under `apps/web/src/pages/admin/`.
- **Pages**: `/admin/financeiro` (tabs Visão geral, Despesas, Recebimentos manuais, button "Exportar DRE (.xlsx)" → `GET /api/admin/finance/dre.xlsx` with the URL params), `/admin/integracoes` (tabs Pagamentos, Calendário, MCP, E-mails, Consumo), `/admin/servicos-extras` (tabs Serviços, Pedidos — funnel columns Novo, Em contato, Orçamento enviado, Fechado, Perdido with keyboard-accessible "Mover para" menu, no drag-only interaction), `/admin/clientes`, `/admin/clientes/:id`, `/admin/salas`, `/admin/salas/:id`, `/admin/usuarios`, `/admin/auditoria`.
- **Components**: `StatTile({ label, valueCents, delta?: { cents, percent } })`; `EvolutionChart({ buckets, series: ('net'|'expenses'|'result')[] })` hand-rolled SVG (no chart library; bronze/walnut/champagne-safe palette with text labels, `<table className="sr-only">` fallback); `FileUpload({ accept, maxBytes, onFile, progress })`; `CopyField({ value, label })` (clipboard + "Copiado" toast); `TokenList({ tokens, onRevoke })`; `prepareRoomPhoto(file): Promise<{ large: Blob; small: Blob; width; height }>` (canvas `toBlob('image/webp', 0.82)`).
- Hooks per feature with TanStack Query keys `['admin','finance','summary', params]`, `['admin','integrations', tab]`, `['admin','customers', q]`, etc.

### Web: public and tenant (lane B)

- `/servicos-extras` page (`pages/public/ExtrasPage.tsx`), `QuoteRequestForm` (shared by page, Home `QuoteModal` and `/app/orcamentos`), `/app/orcamentos`; `ExtrasAddonPicker` registered in nucleo's slot `checkout.summary.extras` (props `{ draft, onChange(addons) }`); `/app/perfil/notificacoes` (`usePushSubscription()` with `Notification.requestPermission`, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`); `public/push-sw.js` imported via `workbox.importScripts` in `vite-plugin-pwa` (keeps fundacao's generateSW); `/app/perfil/privacidade`; `CalendarSyncCard` (personal feed link with Google/Outlook instructions) on `/app/agenda`; the "Baixar .ics" link on `/app/minhas-reservas/:id` is nucleo's (T41).
- `lib/analytics.ts` (created by nucleo T29 with GA4-only `track()`; gestao T42 replaces the loader, keeps `track(event, props)` and nucleo's call sites, and supersedes `VITE_GA4_ID`-only gating with `VITE_ANALYTICS_PROVIDER` + provider key): `initAnalytics(env)`, `track(event: FunnelEvent, props?: AllowedProps)`, `usePageViews()`; events `page_view`, `view_room`, `select_slot`, `begin_checkout`, `purchase` (nucleo names), `subscription_purchased`, `quote_requested`, `signup_completed`; allowed props `roomSlug`, `categoryType`, `paymentMethod`, `valueBucket` (`'<100'|'100-300'|'300-1000'|'>1000'` BRL).
- `write-redirects.mjs` adds `/media/*` before the SPA fallback when `STORAGE_PUBLIC_ORIGIN` is set (https only, trailing slash stripped).

### Hardening

- `apps/web/e2e/mvp-journey.spec.ts`, `apps/web/e2e/admin-config.spec.ts`, `apps/web/e2e/a11y.spec.ts` (`@axe-core/playwright`, both themes via `localStorage['bravo-theme']`), `apps/web/lighthouserc.cjs` (`npm run lhci -w apps/web` runs `vite build` + `lhci autorun` against `vite preview`, mobile preset, assertions of GES-143). E2E helpers read `email_outbox` through `pg` with `DATABASE_URL_TEST` (never printed).
- `scripts/smoke.mjs` adds: `GET /api/public/extra-services` 200 with ≥ 1 item, `GET /servicos-extras` 200, `GET /api/ics/xxxxxxxx.ics` 404, `POST /api/mcp` without token → 401 or 404 (disabled).

---

## Data Models

Tables and columns are those of `docs/architecture.md` §5.5 with the refinements listed in §Data layer. API payloads (camelCase):

```typescript
interface FinanceSummary {
  regime: 'cash' | 'accrual'; grouping: 'week' | 'month' | 'quarter'; from: string; to: string;
  buckets: Array<{ key: string; label: string; from: string; to: string } & Totals>;
  totals: Totals; previous: { from: string; to: string } & Totals;
  comparison: Record<keyof Totals, { deltaCents: number; deltaPercent: number | null }>;
  byRevenueCategory: Record<RevenueCategory, number>; byExpenseCategory: Array<{ id: string; name: string; cents: number }>;
}
interface McpTokenView { id: string; name: string; scope: 'read' | 'read_write'; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null }
interface UsageReport {
  db: { bytes: number; limitBytes: number; percent: number; warning: boolean };
  storage: { buckets: Record<'room-photos' | 'expense-attachments', number> | null; bytes: number | null; limitBytes: number; percent: number | null; warning: boolean; storageError?: string };
  emails: { month: number; monthLimit: number; today: number; dayLimit: number; warning: boolean };
  largestTables: Array<{ name: string; totalBytes: number; estimatedRows: number }>;
}
```

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| Upload too large / wrong type | 413 `PAYLOAD_TOO_LARGE` / 415 `UNSUPPORTED_MEDIA_TYPE` (new codes, added to `lib/errors.ts`) | "Arquivo maior que 5 MB" / "Formato não suportado" |
| Object storage down | 503 `STORAGE_UNAVAILABLE` on upload; failed delete after commit only logged | Toast with retry |
| Room inactivation with commitments | 409 `ROOM_HAS_FUTURE_COMMITMENTS` + `details[]` (booking codes, subscription ids) | Modal listing what to reallocate |
| Last admin | 409 `LAST_ADMIN` | "É preciso manter ao menos um administrador ativo" |
| LGPD blockers | 409 `HAS_ACTIVE_COMMITMENTS` + list | Modal lists reservations/subscriptions to resolve |
| Gateway test failure | 200 `{ ok: false, message }` | Inline red alert with provider message (no secrets) |
| Resend/push failures | Outbox `failed` + retry job; push pruned | None for the requester |
| BrasilAPI failure | `job_runs.status='error'` for the year | Holidays stay as seeded |
| MCP errors | Tool error `{ code, message, details }` (`FORBIDDEN`, `CONFIRMATION_REQUIRED`, `VALIDATION_FAILED`, service codes); 401/404/429 at HTTP level | AI assistant reads the pt-BR message |
| Feed abuse | 429 with `Retry-After` | Calendar client retries later |
| Report range invalid | 422 `VALIDATION_FAILED` | Field error on the date picker |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| --- | --- | --- | --- |
| nucleo/receita names drift during their execution | `.specs/features/nucleo/design.md` Cross-feature interface map | Integration rework | R1..R17 cite producer tasks; T43/T44 are explicit bridge/sweep tasks; semantics fixed by AD-025/AD-027 |
| Netlify proxy caching of `/media/*` responses is not verified | `apps/web/scripts/write-redirects.mjs` (T36) | Room-page LCP above budget | Objects carry immutable `Cache-Control`; T48 measures LCP; fallback is Netlify Image CDN `remote_images` for the storage origin (flagged uncertain) |
| Free-tier limits change (Neon storage, object storage, Resend) | `packages/core/src/settings/catalog.ts` `usage.limits` (T1) | Wrong percentages | Editable setting; values flagged uncertain; panel shows raw bytes too |
| MCP streamable HTTP through the Netlify proxy is cut at ~26 s | `apps/api/src/routes/mcp.ts` (T13) | Long tool calls fail | Screen shows native `API_FUNCTION_URL/mcp`; tools are short request/response |
| `@hono/mcp` 0.3 API surface may differ from the SDK examples | `apps/api/src/mcp/server.ts` (T13) | Transport wiring breaks | Worker checks the installed version's README (Knowledge Verification Chain step 3/4) before coding; fallback is the SDK `StreamableHTTPServerTransport` with Node req/res adapter |
| Finance facts query grows with history | `finance-report.service.ts` (T18) | Slow on free tier | Range ≤ 731 days; indexes `charges(status, created_at)`, add `charges(approved_at)` partial where approved in the gestao migration |
| ListObjectsV2 over many objects is slow | `lib/storage.ts totalBytes` (T4) | Usage endpoint latency | Cap 10 000 objects; result marked approximate beyond cap |
| Audit rows for every MCP read grow the log | `mcp/server.ts` (T13) | Table growth | Accepted (AD-011); usage panel shows `audit_log` size; retention excludes audit by design |
| Anonymization keeps consents/audit with IPs | `privacy.service.ts` (T25) | LGPD questions | Legal-basis retention documented in Assumptions; reviewed by the clinic's legal contact (PRD §11) |
| Browser WebP encoding unsupported (old Safari) | `prepareRoomPhoto` (T36) | Upload impossible on that browser | Admin is desktop-first; detect `canvas.toBlob` WebP support and show "Use Chrome, Edge ou Firefox atualizados" |
| Analytics scripts hurt LCP | `lib/analytics.ts` (T42) | Budget miss | Load after `load` event via `requestIdleCallback`; Lighthouse CI runs with analytics env unset and set |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Finance computation | Load facts for the range, compute in core | Exact cents, unit-tested PRD examples, identical in browser (AD-027) |
| Chart | Hand-rolled SVG | One chart type; no 60 KB+ library on the Admin bundle |
| Expense recurrence | Materialize children daily | Future rows never pollute reports; idempotent |
| Push SW | `workbox.importScripts(['push-sw.js'])` | Keeps fundacao's `generateSW` setup |
| MCP server lifecycle | Stateless, one `McpServer` per request | Serverless function; no session affinity |
| ICS time encoding | UTC `Z` times | Valid RFC 5545 without VTIMEZONE |
| Lane split | Backend lane and frontend lane in separate worktrees, HTTP contracts in this file | Halves wall-clock time; frontend tests mock `fetch` |

## Web-assumed API contract (lane B, Phase 7 → confirm in lane A)

Lane B coded these response shapes where the Finance services section above was silent. Lane A implements them exactly as listed, or changes the web types in `apps/web/src/features/admin-finance/contracts.ts` in the same task and notes it. The web validates its MSW fixtures against those schemas.

| Endpoint | Assumed shape / rule |
| --- | --- |
| `GET /admin/finance/summary` | `FinanceSummary` of §Data Models; every `Totals` obeys net = gross + discounts + refunds + fees and result = net + expenses; `byExpenseCategory[].cents` has the sign of `expensesCents` (negative; the web shows the magnitude); `buckets` carry `key`, `label`, `from`, `to` and `Totals` |
| `GET /admin/finance/dre.xlsx?from&to&regime` | The web fetches it with the session cookie and saves it as `dre-<regime>-<from>-<to>.xlsx`; errors use the JSON envelope |
| `GET /admin/finance/expense-categories` | `{ items: [{ id, name, displayOrder, active }] }` in display order, inactive rows included |
| `POST` / `PATCH /admin/finance/expense-categories(/:id)` | 201 / 200 with the category; `PATCH` takes any of `name`, `displayOrder`, `active`; the web reorders by swapping the `displayOrder` of two neighbours in two calls, so seeded orders must be distinct |
| `GET /admin/finance/expenses?from&to&categoryId&cursor` | `{ items: Expense[], nextCursor: string \| null }`, `Expense = { id, date, categoryId, categoryName, description, amountCents, recurrence, recurrenceParentId: string \| null, attachmentName: string \| null, attachmentContentType: string \| null }` |
| `POST` / `PATCH /admin/finance/expenses(/:id)` | 201 / 200 with the `Expense`; `PATCH` takes the whole `expenseInputSchema` body |
| `DELETE /admin/finance/expenses/:id` | 204; the web sends an empty JSON body |
| `PUT /admin/finance/expenses/:id/attachment` | Raw file body, `Content-Type` = the file's media type; 200 with the updated `Expense` (a 204 is also accepted); 413 / 415 as in GES-17 |
| `GET /admin/finance/expenses/:id/attachment` | 302 to the presigned URL; the web opens it in a new tab through a plain link |
| `DELETE /admin/finance/expenses/:id/attachment` | 204 |
| `GET /admin/finance/receipts?from&to&cursor` | `{ items: ManualReceipt[], nextCursor }`, `ManualReceipt = { id, date, revenueCategory, method, amountCents, description: string \| null, customerName: string \| null, bookingCode: string \| null }` |
| `POST /admin/finance/receipts` | 201 with the `ManualReceipt`; the form sends `userId` when a customer is picked and never sends `bookingId` (no booking picker exists yet) |
| `DELETE /admin/finance/receipts/:id` | Body `{ justification }`, 204 |

### Phases 8 and 9 (Integrações and admin operations)

Same rule: lane A implements these shapes, or changes the response schemas in `apps/web/src/features/admin-integrations/contracts.ts`, `admin-extras/contracts.ts`, `admin-customers/contracts.ts`, `admin-rooms/contracts.ts`, `admin-users/contracts.ts` or `admin-audit/contracts.ts` in the same task and notes it. The web validates its MSW fixtures against those schemas.

| Endpoint | Assumed shape / rule |
| --- | --- |
| `GET /admin/integrations/gateway` | `{ activeProvider, productionWarning, adapters: [{ provider, label, fields: [{ key, label, secret }], configured, enabled, environment: 'test' \| 'production' \| null, secretHint: string \| null, config: Record<fieldKey, string>, webhookUrl }] }`. `fields` is R5's `credentialFields`; `config` holds the current values of the non-secret fields (the design omits them); `secretHint` is the single `••••` + last 4 hint of the stored secrets, shown as the placeholder of every secret field; the sandbox comes back `configured: true`, `enabled: true`, `fields: []` |
| `PUT /admin/integrations/gateway/:provider` | Body = `gatewayCredentialsSchema`: `config` has every non-secret field, `secrets` has every secret field and sends `''` for the ones the admin did not retype (the stored value is kept). 200 with the adapter row (the web ignores the body and reloads); `POST .../test` 200 `{ ok, message }`; `POST .../activate` 200 with any body |
| `GET /admin/integrations/calendar` | `{ feeds: [{ id, scope: 'clinic' \| 'room', roomId \| null, roomName \| null, prefix, createdAt }], rooms: [{ id, name }] }`: active feeds only; `rooms` are all rooms a room feed can be issued for |
| `POST /admin/integrations/calendar/feeds` | 201 `{ url, prefix }`; `DELETE .../feeds/:id` 204 |
| `GET /admin/integrations/notifications` | `{ providerConfigured, recipients: [{ id, email, active }], events }` with the 7 booleans of `notifications.events`; `POST .../recipients` 201 with the recipient; `PATCH .../recipients/:id` `{ active }` 200 with the recipient; `DELETE` 204; `PUT .../events` 200 with the record; `POST .../test` body `{}` or `{ to }` answers `{ results: [{ to, status }] }`, `status` one of `pending`, `sent`, `failed`, `not_sent` |
| `GET /admin/integrations/outbox?status&cursor` | `{ items: [{ id, to, template, subject, status, attempts, lastError \| null, createdAt, sentAt \| null }], nextCursor }`, newest first, last 30 days |
| `GET /admin/integrations/mcp` | `{ enabled, serverUrl, serverUrlWarning: string \| null, tools: [{ name, description, scope: 'read' \| 'write', destructive }], tokens: McpTokenView[] }`; `PUT` body `{ enabled }` (any 200); `POST .../tokens` 201 `{ token, record: McpTokenView }`; `DELETE .../tokens/:id` 204 |
| `GET /admin/usage` | `UsageReport` of §Data Models; `percent` is 0..100; `emails.warning` is one flag, so the web colors each e-mail bar from its own percent (≥ 80) |
| `GET /admin/extra-services` | `{ items: [{ id, name, description, referencePriceCents \| null, unit, saleMode, status, displayOrder }] }`, inactive ones included; `POST` 201 and `PATCH /:id` 200 return the service; `PATCH` takes the whole `extraServiceInputSchema` body |
| `GET /admin/quote-requests?cursor` | `{ items: [{ id, status, serviceId, serviceName, name, phone, email \| null, description, desiredOn \| null, bookingCode \| null, staffNotes \| null, createdAt }], nextCursor }`, newest first; the web sends no `status` filter (the funnel needs every status). `PATCH /:id` takes `{ status }` or `{ staffNotes }`, 200 with the request; an invalid move is 409 and the web shows "O pedido mudou de status. Atualize a página." |
| `GET /admin/customers?q&cursor` | `{ items: [{ id, name, email, phone (E.164) \| null, docMasked \| null }], nextCursor }`; an empty `q` lists the first page |
| `GET /admin/customers/:id` | `{ profile: { id, name, email, phone, docMasked, docType, profession, professionalRegistry, notes, createdAt }, bookings: { items: [{ id, code, roomName, startsAt, endsAt, status, totalCents }], nextCursor }, subscriptions: [{ id, categoryName, roomName \| null, status, baseOn, nextChargeOn \| null, balanceMinutes }], extraLots: [{ id, source, remainingMinutes, expiresOn \| null }], credits: [{ id, source, remainingCents, expiresOn \| null }], couponUses: [{ id, code, status, discountCents, usedAt }], consents: [{ id, kind, version, acceptedAt }], quoteRequests: [{ id, serviceName, status, createdAt }] }`; `bookings` is the first page and `GET /:id/bookings?cursor` answers `{ items, nextCursor }` for the next ones |
| `PATCH /admin/customers/:id`, `POST /admin/customers/:id/anonymize` | Body = `customerProfileSchema` (phone sent as typed, the schema normalizes it to E.164) and `{ justification }`; any 200. `HAS_ACTIVE_COMMITMENTS` (409) carries `details: { bookings: [{ code }], subscriptions: [{ id }] }` |
| `GET /admin/rooms` | `{ items: [{ id, name, slug, description, idealFor, equipment, displayOrder, status, photos: [{ id, storageKey, alt, isCover, displayOrder, width, height }] }] }`, inactive rooms included, photos in display order. There is no `GET /admin/rooms/:id`: the editor reads this list. `width`/`height` are those of the `large` variant. `POST`/`PATCH` take the whole `roomInputSchema` body and answer the room; `ROOM_HAS_FUTURE_COMMITMENTS` (409) carries the same `details` as above |
| `PUT /admin/rooms/:id/photo-uploads/:uploadId/:variant` | Raw `image/webp` body, any 2xx (204); `POST .../photos` 201 with the photo; `PATCH .../photos/:photoId` 200 with the photo; `PUT .../photos/order` `{ ids }` with every photo id, any 2xx; `DELETE .../photos/:photoId` 204. The browser sends `large` first, then `small`, then registers |
| `GET /admin/users` | `{ items: [{ id, name, email, role, status: 'active' \| 'disabled', totpConfirmed, lastLoginAt \| null }] }`, every staff account; `POST` 201 with the user; `PATCH /:id` 200 with the user; `POST /:id/totp-reset` any 2xx; `LAST_ADMIN` (409) is shown as "É preciso manter ao menos um administrador ativo" whatever message the API sends |
| `GET /admin/audit?actorId&origin&actionPrefix&entityType&entityId&from&to&cursor` | `{ items: [{ id: number, at, actorUserId \| null, actorName \| null, actorRole \| null, origin, action, entityType, entityId \| null, justification \| null, before, after }], nextCursor }`, newest first; the web leaves `limit` at its default |

Build note for the `/media/*` proxy (GES-108): `apps/web/scripts/write-redirects.mjs` reads `STORAGE_PUBLIC_ORIGIN` at build time (https only; unset leaves the rule out). Declaring it in `.env.example`, `netlify.toml` docs and the release steps is left to the integration phase.

### Phase 10 (public and tenant UI)

Same rule: lane A implements these shapes, or changes the response schemas in `apps/web/src/features/extras/contracts.ts`, `calendar-sync/contracts.ts` or `privacy/contracts.ts` in the same task and notes it. The web validates its MSW fixtures against those schemas.

| Endpoint | Assumed shape / rule |
| --- | --- |
| `GET /public/extra-services` | `{ items: [{ id, name, description, referencePriceCents \| null, unit, saleMode }] }`: active services in display order (the public rows carry `id`; the add-on picker and the quote form need it) |
| `POST /public/quote-requests` | Body = `quoteRequestInputSchema` output: `phone` as E.164, `email`, `desiredOn` and `bookingId` left out when empty, `website` always sent (`''` for people). 201 with any body. 422 `details: [{ path, message }]` with the field path (`bookingId`...) is shown under that field; 429 is shown as a fixed pt-BR text whatever the message. The web does not call it while the form is invalid |
| `GET /app/quote-requests?cursor` | `{ items: [{ id, status, serviceName, description, desiredOn \| null, bookingCode \| null, createdAt }], nextCursor }`: only the session user's requests, newest first |
| checkout add-on | The quote and booking bodies carry `addons: { extras: [{ serviceId, quantity }] }` (`addons` is left out when nothing is picked). Hourly services: `quantity` 1..ceil(minutes ÷ 60); `project` services: `quantity` 1. `Quote.extensions.extras` is not read by the web; the quote `lines` of kind `extra` and `extrasCents` show the priced lines |
| `GET /public/config` | Adds `vapidPublicKey: string \| null` (GES-75); absent counts as `null` |
| `POST /app/push/subscriptions` | Body = `PushSubscription.toJSON()` parsed by `pushSubscriptionSchema` (`endpoint`, `keys.p256dh`, `keys.auth`; `expirationTime` is dropped). 201 with any body. `DELETE` sends `{ endpoint }` and gets 204 |
| `GET /app/calendar-feed` | `{ active: boolean, prefix: string \| null, createdAt: string \| null }`; `POST` answers 201 `{ url }`. The web keeps the URL in memory only and shows the prefix afterwards |
| `GET /app/me/consents` | `{ items: [{ id, kind, version, acceptedAt }] }`, `kind` one of `booking_policy`, `recurring_charge`, `subscription_terms` (unknown kinds are shown as stored) |
| `GET /app/me/data-export` | The JSON file as an attachment. The web fetches it with the session cookie and saves it as `bravo-meus-dados-<yyyy-mm-dd>.json` (São Paulo date); errors use the JSON envelope (429 `TOO_MANY_ATTEMPTS` message is shown as is) |
| `POST /app/me/deletion` | Body `{ password }`, or `{ confirmText: 'EXCLUIR' }` when the person ticks "Minha conta usa apenas o login com Google" (the session payload has no password flag). 200 with any body; 401 `INVALID_CREDENTIALS` keeps the modal open; 409 `HAS_ACTIVE_COMMITMENTS` carries `details: { bookings: [{ code }], subscriptions: [{ id }] }` (pending charges have no list; the message covers them). On 200 the web drops the cached session and goes to `/` |
| analytics | No API. `VITE_ANALYTICS_PROVIDER` (`posthog` \| `ga4`) with `VITE_GA4_ID` or `VITE_POSTHOG_KEY` (+ optional `VITE_POSTHOG_HOST`, default `https://us.i.posthog.com`); events carry only `roomSlug`, `categoryType`, `paymentMethod`, `valueBucket` plus a redacted `page_path` (ids and tokens in paths become `:id`) |

## Lane A notes (Phases 1–2)

Precondition check (R1–R17, before Phase 1 work resumed at T3): every contract exists. Three R10 service names differ from the table; T14 must call the shipped names (nothing is re-implemented):

| R10 name in this design | Shipped name |
| --- | --- |
| nucleo `serializeBookingDetail` | `loadBookingDetail(db, booking, now, registry?)` in `modules/booking/booking-serializer.service.ts` |
| nucleo `listBookings` | `listAdminBookings(db, filters, cursor)` in `modules/admin/booking-queries.service.ts` |
| nucleo `applyReschedule` | `rescheduleBooking(deps, ctx, input)` in `modules/booking/reschedule.service.ts` |

Also: R12 `getCustomerSubscriptions` takes `(db, userId, now)`; R9 `registerJob`/`runJob` live in `jobs/runner.ts` (re-exported by `jobs/index.ts`) and `verifyTriggerRequest` in `lib/trigger-auth.ts`.

Implementation notes:

- **T3**: one generated migration `0007_gestao` holds every table, check and partial/expression index (drizzle-kit expresses them all); `charges_approved_at_idx` is declared in `db/schema/payments.ts`. Expense categories and extra services are seeded into empty tables only, so a renamed or edited row is never re-added or overwritten.
- **T4**: `AppDeps.storage` is optional in the type; `createApp` always sets it (`createS3Storage(env)` by default). Without `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_ENDPOINT_URL_S3` every storage call answers 503 `STORAGE_UNAVAILABLE`. `env.ts` accepts the four `AWS_*` vars.
- **T5**: `emit(tx, ctx, event, { env })` takes the env as a fourth argument (staff templates need `APP_BASE_URL`). An explicit `event.to` replaces the recipient list (invite, holiday review, test e-mail to one address). The dedupe key uses the event name without `staff.` (`staff:new_booking:<entityId>:<recipientId>`). `withNotifications(deps, ctx, fn)` runs `fn` in one transaction and dispatches after commit; T43's staff port can use it.
- **T6**: the web contract (`usePushSubscription`) matches: `POST` body `{ endpoint, keys }` (extra keys such as `expirationTime` are dropped), 201 `{ endpoint }`; `DELETE` body `{ endpoint }`, 204, scoped to the session user. `vapidPublicKey` is non-null only when all three `VAPID_*` vars are set, the same condition under which pushes are sent. Fundacao's exact-shape `GET /public/config` test now includes `vapidPublicKey: null`.
- **T7**: gestao templates take `(data, { APP_BASE_URL })` and build absolute links from site paths; `renderStaffEmail` renders a staff template from the loose `notifyStaff` payload with neutral fallbacks.
- **T8**: `PRODID` changed to the GES-47 value `-//Bravo Clinic//Salas Inteligentes//PT-BR` for every output, attachments included; `icsCalendar` writes `METHOD` only when given and `X-WR-CALNAME` for the feed name.
- **T9**: `email-retry` and `retention` are registered jobs (`/jobs/email-retry`, `/jobs/retention`); their schedule triggers stay for T49, which owns the gestao edits to `neon.ts`.
- Production env needed: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (already passed through by `neon.ts`); `AWS_*` storage vars are injected by Neon once T49 declares the buckets.

## Lane A notes (Phases 3–4)

Contract check: every route below was compared with what `apps/web/src` sends and reads (lane B is the de facto consumer).

- **T10**: the web contracts match (`GET /admin/integrations/calendar` → `{ feeds, rooms }` with active feeds only and the active rooms; `POST .../feeds` 201 `{ url, prefix }`; `GET /app/calendar-feed` → `{ active, prefix, createdAt }`; `POST` 201 `{ url }`; `DELETE` 204). `adminRoutes` guards `/integrations` and `/integrations/*` with `requireRole('admin')` once for every Integrações route (GES-120). Regenerating a feed writes `ics_feed.revoke` for the replaced token and `ics_feed.issue` for the new one. The feed rate-limit bucket is keyed by the token id (`ics_feed:<id>`), so unknown tokens never create buckets. The per-booking `.ics` (nucleo's route) now answers `METHOD:PUBLISH`; e-mail attachments keep `REQUEST`/`CANCEL`, and nucleo's `bookingIcs` accepts any `IcsMethod`. Clinic feeds mark `pre_reserved` and `held_for_renewal` as `STATUS:TENTATIVE`.
- **T11**: matches the web's `GatewayOverview` (adapters also carry `active`, which the web ignores). `configured` = every secret field has a stored value (sandbox always); `environment` is `'test'` for the sandbox and `null` for a provider never saved. Secrets are one AES-GCM JSON object in `secret_ciphertext` (the format nucleo's `loadGatewayConfig` reads); the hint comes from the first secret field (`accessToken`). Audit rows list the stored credential keys as `storedFields` (keys named `secret*` would be redacted by the logger). `PUT` on the sandbox is 422 `POLICY_VIOLATION`, unknown fields 422 on `config.<key>`/`secrets.<key>`, unknown provider 404. "Testar conexão" uses the stored credentials. `activate` answers `{ activeProvider, reregisterEmails }`; re-activating the active provider is a no-op (no audit, no e-mails). `audit()` now returns the new row id (used in the dedupe key `card_reregister:<subscriptionId>:<auditId>`).
- **T12**: matches the web (`{ providerConfigured, recipients, events }`; recipient rows `{ id, email, active }`; `PUT .../events` echoes the record; test → `{ results: [{ to, status }] }`; outbox `{ items, nextCursor }`, 50 per page, newest first). Audit actions: `notification_recipient.create|update|delete`, `notification_events.update`. The test e-mail is rate limited per admin (`email_test:<sha256(userId)>`, 5 per fixed hour) and uses `emit('system.test')` with a fresh entity id, so repeated tests are never deduplicated; an explicit `to` is lower-cased.
- **T13**: transport = the SDK's own `WebStandardStreamableHTTPServerTransport` (stateless, `enableJsonResponse: true`) mounted with `app.all('/mcp')`, instead of `@hono/mcp` (its 0.3 line declares a non-optional peer `hono-rate-limiter`; the SDK transport takes the Web `Request` directly, the fallback this design allowed). New dependency `@modelcontextprotocol/sdk@^1.32.2`. `tools/list` and `tools/call` are handled on `McpServer.server` so the wrapper owns validation (core zod schemas, advertised as JSON Schema via `z.toJSONSchema`) and the error shape: results carry `structuredContent` (the tool result, or `{ error: { code, message, details } }` with `isError: true`). `defineTool`'s `preview`/`run` take `(toolContext, input)`, where the tool context holds the app deps, the audit `ctx` (origin `mcp`, actor = token owner), the owner `AuthContext` and the token id. Every call — refused ones included — writes `mcp.<tool>` (entity `mcp_token`/<id>, `after: { arguments, ok, error? }`) after the call. Token prefix = `bmcp_` + 6 chars. `/mcp` is exempt from the JSON content-type guard (the transport answers in JSON-RPC); 401 carries `WWW-Authenticate: Bearer`. `AppDeps.mcpTools` lets tests inject tools; the admin tab lists the same catalog. New optional env `API_FUNCTION_URL`. `PUT /admin/integrations/mcp` audits `integration.mcp_update`.
- **T14**: the 25 nucleo/receita tools of the catalog are registered in `mcp/tools/{nucleo,receita}.ts` (ordered by `CATALOG_ORDER` in `mcp/tools/index.ts`) with the shipped producer names (`loadBookingDetail`, `listAdminBookings`, `rescheduleBooking`). Tool arguments are the Admin route bodies/queries of the same service, not the informal names of the table: customers are `userId` (core `staffCreateBookingSchema`, `adminSaleInput`, credit route param), slots are `date` + `startMinute`/`endMinute`, `subscriptions_list` takes the route's `status`/`type`/`search`/`cursor` (the service has no customer filter), path ids become `bookingId`/`blockId`/`subscriptionId`/`couponId`/`id`. `booking_create`/`pre_reservation_create` fix `kind` and re-parse the full core schema so its refinements still apply. `refund_create` = nucleo `requestRefund` (reason `manual`, audit `refund.request` with the typed reason as justification) followed by `processRefund`. Previews (pt-BR, `details.preview`): booking cancel (refund/retained amounts from `previewCancellation`), refund, block removal, slot-discount removal, subscription cancel (`cancelPreview`). `booking_get` takes `id` or `code`. Bookings created through MCP keep nucleo's `source = 'admin'`; their audit rows carry origin `mcp`.
- **T15**: matches the web contracts for categories (`{ items }`, inactive included, ordered by `displayOrder`) and expenses (`{ items, nextCursor }`, 50 per page, newest date first; `PATCH` accepts a partial body and keeps `recurrence` when it is left out; `PUT .../attachment` answers 200 with the `Expense`). **Mismatch**: the web's `api.upload` sends only the raw file and its `Content-Type`, so the original file name is unknown; the API reads an optional `X-File-Name` header (URI-encoded) and otherwise names the file `comprovante.<ext>`. Resolution: server-side fallback kept; T43 (integration) can make `upload()` send `X-File-Name` (no web edit in lane A). An edit may keep an inactive category the expense already has; a changed category must be active (422 on `categoryId`). New categories go to the end of the order (`max + 1`); name clashes are checked case-insensitively (409 `CONFLICT`). `adminRoutes` guards `/finance/*` with `requireRole('admin')`. Audit actions: `expense.create|update|delete`, `expense.attachment_upload|attachment_delete`, `expense_category.create|update`. Object keys are `expenses/<expenseId>/<uuid>`; a replaced object is deleted after commit and a failed commit deletes the new one. MCP tools `expenses_list`, `expense_create`, `expense_delete` (destructive, `expenseId`).
- **T16**: job `recurring-expenses` registered in `jobs/index.ts` (trigger `0 9 * * *` UTC left to T49). Children continue after the latest child ever created, deleted ones included, so deleting a materialized child never brings it back; deleted parents and parents switched to `none` produce nothing; each child is audited `expense.create` with origin `job`; stats `{ parents, created }`.
