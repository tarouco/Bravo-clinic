# Gestão Specification

## Problem Statement

After `nucleo` and `receita`, the clinic can sell rooms, packages and fixed schedules, but the Administrador geral still has no consolidated finance view, cannot export a DRE, cannot connect the payment gateway, calendars, AI assistant or notification e-mails from the Admin, and cannot manage extra services, customers, rooms, staff users or the audit trail. Tenants have no push notifications, no calendar feed and no LGPD self-service. This feature closes PRD §9 step 3 ("Gestão") plus the remaining Admin/PWA items, then hardens and ships the MVP to production.

## Goals

- [ ] The Administrador geral sees receipts, expenses and result per week, month or quarter in Caixa and Competência, and exports a DRE `.xlsx` whose 7 lines match the screen totals to the cent.
- [ ] From Admin → Integrações the admin configures the gateway, issues a clinic ICS link, issues an MCP token used by an MCP client, and sets notification e-mails, without touching code or env vars (except provider API keys).
- [ ] A tenant receives e-mail and web push for every §7.2 event, subscribes a personal ICS feed, downloads a per-booking `.ics`, exports and deletes their data.
- [ ] The MVP definition journey (PRD §9: discover room → book → pay in sandbox → receive `.ics` → reschedule) passes as a Playwright e2e on a mobile viewport, axe reports zero WCAG 2.1 AA violations on the key pages, and Lighthouse mobile LCP ≤ 2.5 s on `/`, `/salas` and `/salas/principal`.
- [ ] Production runs the gestao migration, buckets and triggers, and the extended smoke check exits 0.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Booking, checkout, gateway adapters, webhooks, reconciliation, Gestão de Reservas, policies, booking jobs (expire/no-show/balances/reminders) | `nucleo` (AD-013) |
| Packages, fixed schedules, renewals, extra hours, credits, coupons, slot discounts, Perfil → Compras | `receita` (AD-013) |
| Tenant e-mail templates for booking/subscription events (confirmation, reminders, cancellation, reschedule, renewal) | Owned by nucleo/receita; gestao only adds web push and routes them through the notification catalog (AD-025) |
| Two-way calendar sync / OAuth to Google or Microsoft | PRD "Fora do escopo (MVP)" and Fase 2 |
| WhatsApp notifications, NFS-e, bank reconciliation | PRD "Fora do escopo (MVP)" |
| Staff web push | PRD §7.2 lists push for the tenant app only |
| MCP OAuth authorization | PRD §8 allows revocable tokens; OAuth deferred |
| MCP tools that manage users/roles, integration credentials, MCP tokens, LGPD actions or calendar/price/policy configuration | Security boundary (AD-028); those stay in the Admin UI |
| Neon compute/function-invocation usage figures | Needs a Neon API key inside the function; the panel links to the Neon console instead |
| Cookie banner | Removed in PRD v1.2; analytics runs cookieless |
| Server-side image transcoding | Native image libraries are a bundling risk on Neon Functions; the browser resizes to WebP (AD-026) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| How Caixa and Competência treat discounts and credits | Line 1 (gross) = cash received + discounts + credits used; line 2 deducts discounts (coupon/slot) and credits used; both dated with the receipt they belong to | DRE line 2 exists only if line 1 is pre-discount; net result is unaffected | n |
| Competência date of a cancelled or expired booking that kept money | `cancelled_at` local date (retained deposit is earned on cancellation) | The booking is never used; PRD only defines the used case | n |
| Competência of extra hours purchases | Purchase payment date in both regimes | Extra hours have no service period of their own (usable any day within 90 days) | n |
| Competência spread of subscription periods | Even split per local day of `[starts_on, ends_on)`; leftover cents go one each to the earliest days | Exact integer cents, deterministic, sums back to the price | n |
| Bookings paid with package minutes or fixed-schedule occurrences | Produce no revenue line; the subscription period is the revenue | Avoids double counting | n |
| Charge chargebacks | Counted as refunds (line 3) on the date the charge became `charged_back` | Economically a reversal | n |
| Manual receipts with category `other` | DRE line 1 gets an extra sub-row "Outras receitas" only when it is non-zero in the range | Keeps the 7 PRD lines; schema allows `other` | n |
| DRE expense sub-rows | One per expense category with a non-zero total in the range, by `display_order` | Avoids 14 empty rows | n |
| Report range limit | `from`..`to` at most 731 days | Free-tier compute; two years covers yearly comparison | n |
| Default Financeiro view | Caixa, grouping month, last 6 months including the current one | Most common monthly review (PRD §3 "revisão mensal") | n |
| Week definition | ISO week, Monday to Sunday, local dates | Brazil business convention; matches §5.2 Mon–Sun calendar | n |
| Expense recurrence | Parent row stores the rule; a daily job creates one child row per occurrence on its date (day clamped to month end) | Future expenses never appear before they happen; idempotent | n |
| Expense attachment formats | PDF, JPEG, PNG, WebP up to 5 MiB, private bucket, presigned GET for 300 s | Receipts are PDFs or photos; private by nature | n |
| Room photo pipeline | Browser converts to WebP `large` (≤ 1600 px) and `small` (≤ 800 px); API stores both in a `public_read` bucket; site serves them same-origin through `/media/*` | LCP budget without native image libraries on the function (AD-026) | n |
| Room photos per room | Max 12, alt text required (1..200 chars) | Gallery size; WCAG 2.1 AA alt text | n |
| Resend API key location | Stays in function env `RESEND_API_KEY` (AD-008); Integrações shows only configured / not configured | Fundacao already dispatches from env; no second secret store | n |
| Notification recipients limit | Up to 10 addresses | Small clinic; protects Resend free quota | n |
| Staff event "nova reserva" moment | When a booking first reaches `confirmed` or `paid` | Unpaid checkouts are noise | n |
| MCP tool scope | Tools listed in design §MCP tool catalog; read tools for `read` tokens, all for `read_write` | PRD examples covered; security-sensitive admin areas excluded (AD-028) | n |
| MCP read calls in the audit log | Every call writes one `audit_log` row (`mcp.<tool>`), reads included | AD-011 "every call audited with origin MCP" | y |
| MCP server URL | `API_FUNCTION_URL` env + `/mcp` (native function URL); when unset the screen shows `${APP_BASE_URL}/api/mcp` with a warning about the 26 s proxy limit | Netlify proxy cuts long streams (`docs/architecture.md` §6.1) | n |
| MCP token format and expiry | `bmcp_` + 43 base64url chars; optional expiry 1..365 days; default no expiry | Recognizable prefix for secret scanners; revocation is the main control | n |
| ICS feed windows | Clinic/room feed: today − 90 days .. today + 180 days; tenant feed: today − 30 days .. today + 180 days | Keeps feeds small; covers 90-day booking horizon and next fixed-schedule period | n |
| Cancelled bookings in feeds | Omitted from subscription feeds (snapshot semantics); the per-booking `.ics` of a cancelled booking is `METHOD:CANCEL` | Calendar clients drop events missing from a refreshed feed | n |
| ICS times | `DTSTART`/`DTEND` in UTC (`Z`), no `VTIMEZONE` | RFC 5545 valid, avoids timezone tables; clients display local time | n |
| Feed rate limit | 60 requests per hour per token | Google/Outlook poll every few hours | n |
| Web push payload | `{ title, body, url, tag }`, ≤ 3 KB, first name and booking time only | Lock-screen privacy | n |
| Push failure pruning | 404/410 deletes the subscription; 5 consecutive other failures delete it | Standard push hygiene | n |
| Quote form spam control | 5 requests per hour per IP + honeypot field `website` (non-empty → 202, nothing stored) | No CAPTCHA (bot-detection is out of policy for a small site) | n |
| Online extras pricing | `reference_price_cents` is the unit price; unit `hour` quantity 1..ceil(booking minutes / 60), unit `project` quantity 1; add-ons follow the booking's deposit/balance/refund rules | §5.6 "cobrado junto com a reserva" | n |
| Online extras availability | Only in single-booking checkout (not packages) | PRD ties extras to a booked room | n |
| Staff invitation | New staff gets a set-password e-mail (password-reset token valid 72 h); promoting an existing tenant changes the role in place | Reuses fundacao reset flow | n |
| Staff role change effect | Revokes all sessions of the target user | Privilege changes must apply at once (AD-021) | n |
| LGPD deletion | Anonymize, never hard-delete; keep bookings, charges, ledgers and audit rows linked to the anonymized id (fiscal retention) | `docs/architecture.md` §5.1; Brazilian fiscal record-keeping | n |
| LGPD deletion blockers | Future non-terminal bookings, active/suspended subscriptions, pending charges | Deleting would break money obligations | n |
| LGPD deletion confirmation | Password re-entry; Google-only accounts type `EXCLUIR` | Prevents accidental or session-hijack deletion | n |
| Data export format | Synchronous JSON download, max 3 per 24 h | Small datasets per tenant | n |
| Retention periods | Revoked/expired sessions and used/expired auth tokens: 30 days; rate-limit windows: 2 days; expired idempotency keys: deleted; e-mail bodies older than 180 days blanked (row kept) | "Retenção mínima" (PRD §8) | n |
| Consents and audit rows on deletion | Kept unchanged (append-only, legal basis) | Proof of consent is a legal obligation | n |
| Free-tier limits shown | Setting `usage.limits` defaults: DB 512 MiB, object storage 1 GiB, e-mails 3000/month and 100/day | Neon/Resend free figures change; editable setting, flagged uncertain in design | n |
| Usage warning threshold | 80 % | Common capacity-planning trigger | n |
| Analytics provider | `VITE_ANALYTICS_PROVIDER` = `posthog` or `ga4`; unset → disabled | PRD §3 "GA4 ou PostHog" | n |
| Analytics privacy | Cookieless (PostHog `persistence: 'memory'`, GA4 `client_storage: 'none'`), no PII properties, Admin never tracked | LGPD without cookie banner | n |
| Holiday import source | BrasilAPI `GET https://brasilapi.com.br/api/feriados/v1/{year}`, national only; skip dates that already have a national holiday | Seed names differ from BrasilAPI names; date is the stable key | n |
| Holiday reminder recipients | All active admin users | §5.2 "avisa o Administrador geral" | n |
| Reception permissions | Allowed: Gestão de Reservas operations (list, calendar, create booking, create pre-reservation, check-in, resend link, blocks) and Clientes (read + notes); everything else 403 | PRD §7.3 Perfis; manual confirmation, cleanup exceptions, discounts and policies are admin actions | n |
| Lighthouse thresholds | LCP ≤ 2500 ms, CLS ≤ 0.1, accessibility ≥ 0.95, mobile preset | PRD §8 performance + WCAG goal | n |
| Production deploy | Last phase; runs only after explicit user go-ahead | Skill blast-radius rule | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Revenue recognition engine ⭐ MVP

**User Story**: As the Administrador geral, I want receipts derived automatically from approved payments in both regimes, so that the numbers need no spreadsheet.

**Why P1**: US-16 first criterion; every Financeiro view and the DRE depend on it.

**Acceptance Criteria**:
1. The finance engine SHALL map `charges.purpose` to revenue categories: `booking_deposit`, `booking_balance`, `booking_full`, `booking_difference` → `rental_single`; `subscription_initial` → `subscription_initial`; `subscription_renewal` → `subscription_renewal`; `extra_hours` → `extra_hours`; `extra_service` → `extra_services`. [GES-01]
2. WHILE the regime is Caixa the engine SHALL date each approved non-credit charge and its fee on the local date of `approved_at`, each manual receipt on its `date`, and each approved refund on the local date of `completed_at`. [GES-02]
3. WHILE the regime is Competência the engine SHALL date a booking-linked receipt on the local date of the booking's `starts_at`, or on the local date of `cancelled_at` when the booking ended `cancelled_*` or `expired`. [GES-03]
4. WHILE the regime is Competência the engine SHALL spread a subscription-period receipt evenly over the local days of `[starts_on, ends_on)`, giving leftover cents one each to the earliest days, so that 616000 cents over 30 days yields 10 days of 20534 and 20 days of 20533. [GES-04]
5. The engine SHALL date extra-hours receipts on the purchase payment date in both regimes. [GES-05]
6. The engine SHALL add booking `discount_cents`, subscription-period `discount_cents` and approved `method = 'credit'` charges to line 1 (gross) and deduct the same amounts on line 2, dated with the receipt they belong to. [GES-06]
7. The engine SHALL report approved refunds and `charged_back` charges on line 3 under the category of the original charge, and `fee_cents` of approved non-credit charges on line 4. [GES-07]
8. WHEN a booking has `booking_extra_items` THEN the engine SHALL split each of its receipts between `extra_services` (half-up share `amount × extras / total`) and `rental_single` (the rest). [GES-08]
9. The engine SHALL produce no revenue entry for bookings with `payment_mode` `package` or `subscription`. [GES-09]
10. The engine SHALL be a pure `@bravo/core` module whose totals for the same inputs are identical in browser and server. [GES-10]

**Independent Test**: unit tests over fixture rows covering each AC and the PRD money examples.

---

### P1: Expenses and manual receipts ⭐ MVP

**User Story**: As the Administrador geral, I want to record expenses (with recurrence and receipt attachments) and manual receipts, so that the result is complete.

**Why P1**: US-16 second criterion and §7.3.3.

**Acceptance Criteria**:
1. WHEN an admin posts a valid expense (date, active category, description 1..200 chars, amount 1..100000000 cents, recurrence `none|monthly|quarterly|yearly`) THEN the API SHALL return 201 with the expense and write audit action `expense.create`. [GES-11]
2. IF the expense category is inactive or unknown THEN the API SHALL return 422 `VALIDATION_FAILED` with `details[0].path = "categoryId"`. [GES-12]
3. WHEN an admin edits or deletes an expense THEN the API SHALL update it (delete = set `deleted_at`), write audit `expense.update` or `expense.delete` with before/after, and reports SHALL exclude deleted rows. [GES-13]
4. WHEN the daily `recurring-expenses` job runs THEN the system SHALL create one child expense (`recurrence_parent_id` set, `recurrence = 'none'`) for every due occurrence of each active recurring parent with date ≤ today, clamping the day to the month's last day, and a re-run SHALL create no duplicates. [GES-14]
5. WHEN a parent's recurrence is set to `none` THEN the job SHALL create no further children and existing children SHALL remain unchanged. [GES-15]
6. WHEN an admin uploads an attachment of type PDF, JPEG, PNG or WebP up to 5 MiB whose magic bytes match its declared type THEN the API SHALL store it in the private bucket `expense-attachments` and set `attachment_key`, `attachment_name` and `attachment_content_type`. [GES-16]
7. IF the attachment exceeds 5 MiB THEN the API SHALL return 413 `PAYLOAD_TOO_LARGE`, and IF its type or magic bytes are not allowed THEN the API SHALL return 415 `UNSUPPORTED_MEDIA_TYPE`. [GES-17]
8. WHEN an admin requests an expense attachment THEN the API SHALL respond 302 to a presigned URL valid for 300 seconds and the object SHALL never be publicly readable. [GES-18]
9. WHEN an admin creates, renames, reorders or deactivates an expense category THEN the API SHALL apply it with audit, and IF a name duplicates an existing one case-insensitively THEN the API SHALL return 409 `CONFLICT`. [GES-19]
10. WHEN an admin posts a manual receipt (date, revenue category, method `cash|card_machine|pix_direct`, amount 1..100000000 cents, optional description, customer and booking) THEN the API SHALL return 201 and write audit `manual_receipt.create`. [GES-20]
11. IF an admin deletes a manual receipt without a justification of 5..500 chars THEN the API SHALL return 422, and with one it SHALL set `deleted_at` and write audit `manual_receipt.delete` with the justification. [GES-21]

**Independent Test**: integration tests through `app.request()` with a stubbed object-storage client.

---

### P1: Financeiro overview ⭐ MVP

**User Story**: As the Administrador geral, I want totals grouped by week, month or quarter with an evolution chart and the previous-period comparison, so that I see the trend at a glance.

**Why P1**: US-16 third and fourth criteria.

**Acceptance Criteria**:
1. WHEN an admin calls `GET /api/admin/finance/summary?from&to&grouping&regime` THEN the API SHALL return one bucket per week, month or quarter intersecting the range, each with `grossCents`, `discountsCents`, `refundsCents`, `feesCents`, `netCents`, `expensesCents` and `resultCents`, plus range totals and per-category breakdowns. [GES-22]
2. The summary SHALL use ISO weeks (Monday–Sunday), calendar months and calendar quarters on America/Sao_Paulo dates, clipping the first and last bucket to the range. [GES-23]
3. WHEN the summary is computed THEN the API SHALL also return totals for the previous range of equal length ending the day before `from`, with absolute deltas and percentage deltas rounded to one decimal, and `null` percentages when the previous value is 0. [GES-24]
4. IF `to` is before `from` or the range exceeds 731 days THEN the API SHALL return 422 `VALIDATION_FAILED`. [GES-25]
5. WHEN the admin opens `/admin/financeiro` THEN the page SHALL show regime Caixa, grouping month and the last 6 months by default, with stat tiles for net revenue, expenses and result showing the delta versus the previous range. [GES-26]
6. The evolution chart SHALL plot net revenue, expenses and result per bucket as an SVG with a visible legend and an equivalent data table available to screen readers. [GES-27]
7. WHEN the admin changes regime, grouping or range THEN the page SHALL refetch the summary and keep the choice in the URL search params so the export uses the same selection. [GES-28]

**Independent Test**: integration test of the endpoint over seeded charges/refunds/expenses; component tests of the page with mocked fetch.

---

### P1: DRE export ⭐ MVP

**User Story**: As the Administrador geral, I want a DRE spreadsheet for the selected period and regime, so that my accountant gets it without rework.

**Why P1**: US-16 fifth criterion and §7.3.3.

**Acceptance Criteria**:
1. WHEN an admin calls `GET /api/admin/finance/dre.xlsx?from&to&regime` THEN the API SHALL return 200 with content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and file name `dre-<regime>-<from>-<to>.xlsx`. [GES-29]
2. The DRE sheet SHALL have one column per calendar month intersecting the range, labelled `mmm/aaaa` in pt-BR, followed by a `Total` column. [GES-30]
3. The DRE sheet SHALL contain, in order, the lines "1. Receita bruta" (sub-rows Locação avulsa, Assinaturas, Horas extras, Serviços extras, and Outras receitas only when non-zero), "2. (−) Descontos, cupons e créditos concedidos", "3. (−) Estornos e reembolsos", "4. (−) Taxas do gateway de pagamento", "5. = Receita líquida", "6. (−) Despesas operacionais" (one sub-row per expense category with a non-zero total) and "7. = Resultado do período". [GES-31]
4. The DRE cells SHALL be numeric BRL values with deductions negative, and in every column line 5 SHALL equal lines 1+2+3+4 and line 7 SHALL equal lines 5+6 exactly. [GES-32]
5. The DRE `Total` column SHALL equal the range totals returned by the summary endpoint for the same `from`, `to` and `regime`. [GES-33]
6. The DRE sheet SHALL start with header rows naming the clinic, the regime ("Caixa" or "Competência"), the period `dd/mm/aaaa a dd/mm/aaaa` and the generation timestamp in local time. [GES-34]

**Independent Test**: integration test parses the returned workbook with exceljs and checks labels and sums.

---

### P1: Payment gateway configuration ⭐ MVP

**User Story**: As the Administrador geral, I want to choose and configure the active gateway, so that no gateway setting lives in code.

**Why P1**: US-17 and PRD §8 generic gateway.

**Acceptance Criteria**:
1. WHEN an admin calls `GET /api/admin/integrations/gateway` THEN the API SHALL list every registered adapter with label, credential field descriptors, `configured`, `enabled`, `environment`, `secretHint`, `active` and `webhookUrl` = `${APP_BASE_URL}/api/webhooks/pagamentos/<provider>`, and SHALL never include a secret value. [GES-35]
2. WHEN an admin saves credentials THEN the API SHALL store secret fields AES-256-GCM encrypted in `integration_settings.secret_ciphertext`, store `secret_hint` as `••••` plus the last 4 characters, keep stored secrets for fields sent empty, and write audit `integration.gateway_update` without secret values. [GES-36]
3. WHEN an admin runs "Testar conexão" THEN the API SHALL call the adapter's credential check with a 10-second timeout and return 200 `{ ok, message }`, with `ok = false` and a pt-BR message on rejection or timeout. [GES-37]
4. WHEN an admin activates a provider that is configured and enabled (the sandbox always qualifies) THEN the API SHALL set `payment.active_gateway`, write audit `integration.gateway_activate`, and leave every existing charge's `provider` unchanged. [GES-38]
5. IF an admin activates a provider that is not configured or not enabled THEN the API SHALL return 422 `POLICY_VIOLATION`. [GES-39]
6. WHEN the active provider changes THEN the system SHALL queue one `subscription.card_reregister` e-mail per active auto-renew subscription whose saved card belongs to another provider, deduplicated per subscription and switch. [GES-40]
7. WHILE `NEON_BRANCH` is `production` and the active gateway is `sandbox` or its environment is `test` the Integrações page SHALL show a warning banner "Pagamentos em modo de teste". [GES-41]

**Independent Test**: integration tests with the sandbox adapter and a stubbed Mercado Pago `fetch`.

---

### P1: Calendar feeds and .ics files ⭐ MVP

**User Story**: As the Administrador geral and as a tenant, I want secret calendar links and `.ics` files, so that bookings show up in Google Calendar or Outlook.

**Why P1**: US-04 third criterion, US-17 first criterion, §7.3.4, §8.

**Acceptance Criteria**:
1. WHEN an admin creates a clinic feed (scope `clinic`, or `room` with a room id) THEN the API SHALL return the URL `${APP_BASE_URL}/api/ics/<token>.ics` with the raw token once, store only its SHA-256 hash and 6-char prefix, revoke the previous active feed of the same scope and room, and write audit `ics_feed.issue`. [GES-42]
2. WHEN a feed is revoked THEN the API SHALL set `revoked_at`, write audit `ics_feed.revoke`, and requests to that URL SHALL return 404. [GES-43]
3. WHEN a clinic feed URL is fetched THEN the API SHALL return a VCALENDAR with one VEVENT per booking in status `pre_reserved`, `awaiting_payment`, `held_for_renewal`, `confirmed`, `paid`, `completed` or `no_show` and per active block, starting within today − 90 days .. today + 180 days, filtered by room for `room` scope, with SUMMARY "<primeiro nome> · <sala>" for bookings and "<tag> · <sala>" for blocks. [GES-44]
4. WHEN a tenant calls `POST /api/app/calendar-feed` THEN the API SHALL create or regenerate the tenant's single active personal feed and return its URL once. [GES-45]
5. WHEN a personal feed URL is fetched THEN the API SHALL return only that user's bookings in status `held_for_renewal`, `confirmed`, `paid` or `completed` within today − 30 days .. today + 180 days, with SUMMARY "Bravô Clinic · <sala>". [GES-46]
6. The ICS output SHALL follow RFC 5545: CRLF line endings, lines folded at 75 octets, escaped TEXT values, `VERSION:2.0`, `PRODID:-//Bravo Clinic//Salas Inteligentes//PT-BR`, `CALSCALE:GREGORIAN`, `UID` = `bookings.ics_uid` (blocks `block-<id>@bravo-clinic`), `SEQUENCE` = `ics_sequence`, `DTSTAMP`, and `DTSTART`/`DTEND` in UTC. [GES-47]
7. The ICS output SHALL NOT contain a cleanup-buffer event, another customer's personal data in a personal feed, or payment amounts. [GES-48]
8. WHEN a booking is rescheduled THEN the next feed fetch SHALL return the same UID with the new times and a SEQUENCE one higher, and WHEN it is cancelled the event SHALL be absent from the feed. [GES-49]
9. WHEN the owner calls `GET /api/app/bookings/:id/ics` THEN the API SHALL return a `text/calendar` file with `METHOD:PUBLISH` and one VEVENT, or `METHOD:CANCEL` with `STATUS:CANCELLED` for a cancelled booking; IF the booking belongs to another user THEN the API SHALL return 404. [GES-50]
10. IF a feed token receives more than 60 requests in one hour THEN the API SHALL return 429 with `Retry-After`. [GES-51]
11. IF the token is unknown, revoked or malformed THEN the API SHALL return 404 without revealing which case applies. [GES-52]

**Independent Test**: integration tests fetch feeds and parse them with a minimal RFC 5545 line parser.

---

### P1: MCP server ⭐ MVP

**User Story**: As the Administrador geral, I want to operate the clinic from my AI assistant with revocable, scoped tokens, so that I can manage it from anywhere safely.

**Why P1**: US-17 second criterion, §7.3.4, §7.6, §8, AD-011.

**Acceptance Criteria**:
1. WHEN an admin creates an MCP token (name 1..60 chars, scope `read` or `read_write`, optional expiry 1..365 days) THEN the API SHALL return the raw token `bmcp_<43 base64url chars>` once, store its SHA-256 hash and prefix, and write audit `mcp_token.issue`. [GES-53]
2. WHEN an admin lists or revokes tokens THEN the API SHALL never return raw tokens, and revocation SHALL set `revoked_at` and write audit `mcp_token.revoke`. [GES-54]
3. WHILE setting `mcp.enabled` is false the `/mcp` endpoint SHALL return 404 `FEATURE_DISABLED`. [GES-55]
4. IF a request to `/mcp` has no bearer token, an unknown, revoked or expired token, or a token whose owner is no longer an active admin THEN the API SHALL return 401 `UNAUTHENTICATED`. [GES-56]
5. WHEN an MCP client calls `tools/list` THEN the server SHALL return the tools of design §MCP tool catalog, limited to read tools for `read` tokens. [GES-57]
6. IF a `read` token calls a write tool THEN the server SHALL return a tool error with code `FORBIDDEN` and change nothing. [GES-58]
7. IF a destructive tool is called without `confirm: true` THEN the server SHALL return a tool error with code `CONFIRMATION_REQUIRED` and a pt-BR preview of the effect, and change nothing. [GES-59]
8. IF a token exceeds `mcp.rate_limit_per_minute` requests in a minute THEN the API SHALL return 429 `TOO_MANY_ATTEMPTS` with `Retry-After`. [GES-60]
9. WHEN any tool is called THEN the system SHALL write an `audit_log` row with origin `mcp`, action `mcp.<tool>`, actor = token owner and entity = the token id, and mutations SHALL additionally carry their service audit row with origin `mcp`. [GES-61]
10. WHEN tool arguments fail the shared `@bravo/core` schema THEN the server SHALL return a tool error `VALIDATION_FAILED` with the pt-BR field messages. [GES-62]
11. WHEN an admin opens the MCP tab THEN the API SHALL return the server URL (`API_FUNCTION_URL` + `/mcp`, or the proxied URL with a warning when unset), `enabled`, the tool catalog with scope and destructive flags, and the tokens. [GES-63]
12. WHEN a token authenticates THEN the system SHALL update `last_used_at` at most once per minute. [GES-64]

**Independent Test**: integration tests drive `/mcp` with the MCP SDK client over the in-process app.

---

### P1: Notification e-mails ⭐ MVP

**User Story**: As the Administrador geral, I want to choose who gets which clinic notices and to test the e-mail setup, so that I never miss a booking, payment or lead.

**Why P1**: US-10, US-17 third criterion, §7.3.4, AD-008.

**Acceptance Criteria**:
1. WHEN an admin adds a notification recipient THEN the API SHALL store the lower-cased e-mail as active, and IF it duplicates an existing one THEN 409 `CONFLICT`, and IF 10 recipients already exist THEN 422 `POLICY_VIOLATION`. [GES-65]
2. WHEN an admin saves event toggles THEN the API SHALL store `notifications.events` for the keys `new_booking`, `payment_received`, `booking_cancelled`, `new_subscription`, `renewal_failed`, `pre_reservation_expired`, `new_quote_request`, and IF an unknown key is sent THEN 422. [GES-66]
3. WHEN a staff event occurs and its toggle is on THEN the notification service SHALL queue one `staff.<event>` e-mail per active recipient in the caller's transaction with dedupe key `staff:<event>:<entityId>:<recipientId>`. [GES-67]
4. WHILE a staff event's toggle is off the notification service SHALL queue no e-mail for that event. [GES-68]
5. WHEN a booking first reaches `confirmed` or `paid`, a non-credit charge is approved, a booking enters any `cancelled_*` status, a subscription's first period is paid, a renewal fails, a pre-reservation expires, or a quote request is created THEN the system SHALL emit `new_booking`, `payment_received`, `booking_cancelled`, `new_subscription`, `renewal_failed`, `pre_reservation_expired` or `new_quote_request` respectively. [GES-69]
6. WHEN an admin sends a test e-mail THEN the API SHALL queue template `system.test` to every active recipient (or to the address given) and return each outbox row's final status, and IF more than 5 tests are sent in one hour by that admin THEN 429. [GES-70]
7. WHEN an admin lists the outbox THEN the API SHALL return rows of the last 30 days with recipient, template, subject, status, attempts, last error and timestamps, filterable by status, without HTML bodies. [GES-71]
8. WHEN the `email-retry` job runs (every 5 minutes) THEN the system SHALL dispatch rows with status `failed` and `attempts < 5` created in the last 48 hours, and rows still `pending` 5 minutes after creation. [GES-72]
9. The system SHALL have a pt-BR template (subject, HTML, text, no emoji, absolute links on `APP_BASE_URL`) for every event of the notification catalog owned by gestao (design §Notification catalog). [GES-73]
10. WHILE `RESEND_API_KEY` is absent the E-mails tab SHALL show "Provedor de e-mail não configurado — mensagens ficam registradas no histórico". [GES-74]

**Independent Test**: integration tests with `fetch` stubbed for Resend.

---

### P1: Web push ⭐ MVP

**User Story**: As a tenant, I want push notifications on my phone, so that I see confirmations and reminders without opening e-mail.

**Why P1**: PRD §7.2 "e-mail + web push", §8 VAPID.

**Acceptance Criteria**:
1. WHEN `GET /api/public/config` is called THEN the response SHALL include `vapidPublicKey`, `null` when VAPID env vars are unset. [GES-75]
2. WHEN a logged-in user posts a push subscription (https endpoint ≤ 1000 chars, base64url `p256dh` and `auth`) THEN the API SHALL upsert it by endpoint for that user, reassigning an endpoint previously owned by another user, and return 201. [GES-76]
3. WHEN the user deletes a subscription by endpoint THEN the API SHALL remove it and return 204. [GES-77]
4. WHERE VAPID is configured, WHEN a tenant event of the notification catalog is emitted for user U THEN after commit the system SHALL send a push with payload `{ title, body, url, tag }` of at most 3 KB to each of U's subscriptions. [GES-78]
5. IF the push service answers 404 or 410 THEN the system SHALL delete that subscription, and IF it fails otherwise THEN the system SHALL increment `failure_count` and delete the subscription at 5 consecutive failures. [GES-79]
6. WHEN a push succeeds THEN the system SHALL set `last_success_at` and reset `failure_count` to 0. [GES-80]
7. WHERE VAPID is not configured the system SHALL attempt no push and the originating request SHALL still succeed. [GES-81]
8. WHEN the service worker receives a push THEN it SHALL show a notification with the payload title and body and the brand icon, and WHEN the user clicks it THEN it SHALL focus an open app window or open the payload URL. [GES-82]
9. WHEN the tenant opens `/app/perfil/notificacoes` THEN the page SHALL offer "Ativar notificações" / "Desativar", and IF push is unsupported, permission is denied, or iOS runs outside an installed PWA THEN it SHALL show the matching pt-BR explanation instead of the button. [GES-83]

**Independent Test**: integration tests with `web-push` stubbed; component test of the settings page; unit test of the SW handler.

---

### P1: Extra services catalog and online add-on ⭐ MVP

**User Story**: As the Administrador geral, I want to configure extra services and sell them on quote or online with a booking, so that I capture high-margin demand.

**Why P1**: §5.6, US-19, §7.3.6.

**Acceptance Criteria**:
1. WHEN an admin creates or edits a service (name 2..80, description ≤ 1000, reference price 0..10000000 cents or null, unit `hour|project`, sale mode `quote|online`, status, display order) THEN the API SHALL save it with audit `extra_service.create` / `extra_service.update`. [GES-84]
2. IF a service is set to `online` with a null reference price THEN the API SHALL return 422 `VALIDATION_FAILED` on `referencePriceCents`. [GES-85]
3. WHEN `GET /api/public/extra-services` is called THEN the API SHALL return active services ordered by display order with name, description, reference price, unit and sale mode. [GES-86]
4. WHEN a visitor opens `/servicos-extras` THEN the page SHALL list active services with price "R$ 80,00/h", "R$ X/projeto" or "Sob consulta" when null, and a quote form. [GES-87]
5. WHEN checkout input includes extras of active `online` services THEN the add-on SHALL price each line at the frozen unit price × quantity, add the sum to the booking total before the deposit/balance split, store `booking_extra_items`, and show each line in the summary. [GES-88]
6. IF an extra is inactive, in `quote` mode, or its quantity is outside 1..ceil(booking minutes ÷ 60) for unit `hour` or ≠ 1 for unit `project` THEN the checkout SHALL return 422 `VALIDATION_FAILED`. [GES-89]

**Independent Test**: integration tests of the service routes and of nucleo's checkout with the add-on registered.

---

### P1: Quote request funnel ⭐ MVP

**User Story**: As a visitor or tenant, I want to request a quote for filming, videomaker or marketing, and as the admin I want to work those leads through a funnel.

**Why P1**: US-10, US-19, §5.6, §7.3.6.

**Acceptance Criteria**:
1. WHEN `POST /api/public/quote-requests` receives an active service, name 2..120, BR phone, optional e-mail, description 10..2000, optional desired date within today..today + 365 and optional booking THEN the API SHALL return 201 and store status `new`, linking the session user when present. [GES-90]
2. IF the booking id does not belong to the session user (or there is no session) THEN the API SHALL return 422 `VALIDATION_FAILED` on `bookingId`. [GES-91]
3. IF one IP sends more than 5 quote requests in an hour THEN the API SHALL return 429 `TOO_MANY_ATTEMPTS`. [GES-92]
4. IF the honeypot field `website` is non-empty THEN the API SHALL return 202 and store nothing. [GES-93]
5. WHEN a quote request is stored THEN the system SHALL emit `new_quote_request` and, when an e-mail was given, queue `quote.received` to the requester. [GES-94]
6. WHEN an admin changes a quote status THEN the API SHALL allow only `new → contacted → quote_sent → won|lost` and any non-terminal → `lost`, guarded by `WHERE status = <from>`, write audit `quote_request.status`, and IF the transition is invalid THEN return 409 `INVALID_TRANSITION`. [GES-95]
7. WHEN an admin lists quote requests THEN the API SHALL return them newest first, filterable by status, with service, contact, desired date, linked booking code and staff notes (≤ 2000 chars, editable). [GES-96]
8. WHEN a tenant opens `/app/orcamentos` THEN the page SHALL list only that tenant's requests with status labels. [GES-97]
9. WHEN a visitor submits the Home quote modal THEN the web SHALL post to the API and show "Pedido enviado. Retornaremos em breve.", keeping the WhatsApp link as a secondary action. [GES-98]

**Independent Test**: integration tests of the routes; component tests of the forms.

---

### P1: Clientes ⭐ MVP

**User Story**: As the admin or the reception, I want a customer profile with history, subscriptions, balances, credits, coupons and notes, so that I serve customers well.

**Why P1**: §7.3.7.

**Acceptance Criteria**:
1. WHEN staff search `GET /api/admin/customers?q` THEN the API SHALL return tenants matching name or e-mail (case-insensitive substring), document digits or phone digits, 50 per page with a cursor, excluding `deleted` users. [GES-99]
2. WHEN staff open a customer THEN the API SHALL return profile, bookings (newest first, paginated, with status labels and room), subscriptions with base date, next charge and minute balance, active extra-minute lots, available credits, coupon uses, consents and quote requests. [GES-100]
3. WHEN admin or reception saves notes (≤ 4000 chars) THEN the API SHALL store `users.notes` and write audit `customer.notes`. [GES-101]
4. IF reception edits profile fields (name, phone, profession, registry) THEN the API SHALL return 403 `FORBIDDEN`, while an admin edit SHALL be saved with audit `customer.update`. [GES-102]

**Independent Test**: integration tests with receita factories; component tests of list and detail.

---

### P1: Salas admin ⭐ MVP

**User Story**: As the Administrador geral, I want to maintain rooms and their photos, so that the site shows accurate rooms.

**Why P1**: §5.1, §7.3.7, §7.6.

**Acceptance Criteria**:
1. WHEN an admin creates or edits a room (name 2..60, unique kebab-case slug 2..40, description ≤ 2000, up to 8 "ideal para" tags ≤ 40 chars, up to 30 equipment items ≤ 80 chars, display order) THEN the API SHALL save it with audit `room.create` / `room.update`. [GES-103]
2. IF an admin inactivates a room with future non-terminal bookings or active/suspended fixed-schedule subscriptions on it THEN the API SHALL return 409 `ROOM_HAS_FUTURE_COMMITMENTS` with the booking codes and subscription ids, and leave the room active. [GES-104]
3. WHEN an admin uploads the `large` and `small` WebP variants for an upload id and then registers the photo with alt text 1..200 chars THEN the API SHALL verify both objects exist in bucket `room-photos`, insert `room_photos` with `storage_key = rooms/<roomId>/<uploadId>`, and write audit `room_photo.create`. [GES-105]
4. IF a variant upload is not `image/webp`, exceeds 5 MiB, or the room already has 12 photos THEN the API SHALL return 415, 413 or 422 respectively. [GES-106]
5. WHEN an admin reorders photos, sets the cover, edits alt text or deletes a photo THEN the API SHALL apply it with audit, keep at most one cover per room, and delete the objects after commit on delete. [GES-107]
6. The API SHALL expose room photo URLs as `/media/<storage_key>-<variant>.webp`, and objects SHALL be written with `Cache-Control: public, max-age=31536000, immutable`. [GES-108]
7. WHEN the browser prepares a photo THEN the Salas page SHALL resize it to WebP `large` (longest side ≤ 1600 px) and `small` (≤ 800 px) before upload and show progress. [GES-109]

**Independent Test**: integration tests with a stubbed S3 client; component test of the upload flow with a fake canvas encoder.

---

### P1: Usuários and audit log ⭐ MVP

**User Story**: As the Administrador geral, I want to manage staff accounts and read the audit trail, so that access is controlled and traceable.

**Why P1**: §7.3.7, §8.

**Acceptance Criteria**:
1. WHEN an admin lists users THEN the API SHALL return staff accounts with name, e-mail, role, status, 2FA confirmed flag and last login. [GES-110]
2. WHEN an admin adds staff with a new e-mail and role `admin|reception` THEN the API SHALL create the user without password, queue `staff.invite` with a set-password link valid 72 hours, and write audit `user.invite`; WHEN the e-mail belongs to a tenant THEN it SHALL change that user's role with audit `user.role_change`; IF the e-mail belongs to staff THEN 409 `CONFLICT`. [GES-111]
3. WHEN an admin changes a staff user's role, disables or enables them THEN the API SHALL apply it, revoke all of that user's sessions and write audit with before/after. [GES-112]
4. IF an admin targets their own account for role change or disabling THEN the API SHALL return 422 `POLICY_VIOLATION`, and IF the change would leave no active admin THEN 409 `LAST_ADMIN`. [GES-113]
5. WHEN an admin resets another staff user's 2FA with a justification of 5..500 chars THEN the API SHALL delete that user's `user_totp`, revoke their sessions and write audit `user.totp_reset`. [GES-114]
6. WHEN an admin queries `GET /api/admin/audit` with optional actor, origin, action prefix, entity type, entity id and date range THEN the API SHALL return matching rows newest first, at most 100 per page with a cursor, including actor name and role. [GES-115]
7. WHEN the admin opens a row on `/admin/auditoria` THEN the page SHALL show date, user, origin label (Web, App, Admin, MCP, Job, Sistema), action, entity, justification and the before/after JSON. [GES-116]

**Independent Test**: integration tests per role; component tests of both pages.

---

### P1: Reception restrictions end-to-end ⭐ MVP

**User Story**: As the Administrador geral, I want the reception limited to operations and customers everywhere, so that finance, configuration and integrations stay with me.

**Why P1**: §7.3 Perfis, §8 "controle de acesso por perfil".

**Acceptance Criteria**:
1. The API SHALL return 403 `FORBIDDEN` to an MFA-verified reception session for every `/admin/*` route except the reception allowlist of design §Reception allowlist. [GES-117]
2. WHEN a test enumerates the mounted Hono routes THEN every `/admin/*` route SHALL be classified as allowlisted or admin-only, and the test SHALL fail on any unclassified route. [GES-118]
3. WHEN a reception user opens any Admin URL outside `reservas` (without `politicas`) and `clientes` THEN the web SHALL render the 403 page, and the Admin navigation SHALL show only Gestão de Reservas and Clientes. [GES-119]
4. IF a reception user calls any `/admin/integrations/*` route, including MCP token creation THEN the API SHALL return 403 `FORBIDDEN`. [GES-120]

**Independent Test**: route-table sweep integration test; router guard component test.

---

### P1: LGPD self-service ⭐ MVP

**User Story**: As a tenant, I want to export my data, see my consents and delete my account, so that my LGPD rights are respected.

**Why P1**: PRD §8 LGPD.

**Acceptance Criteria**:
1. WHEN a user calls `GET /api/app/me/data-export` THEN the API SHALL return a JSON attachment `bravo-meus-dados-<date>.json` with profile, consents, bookings, charges and refunds (no provider payloads), subscriptions, ledgers, credits, coupon uses, quote requests, push subscriptions (endpoint origin only) and e-mails sent (subject, date), and write audit `user.data_export`. [GES-121]
2. The export SHALL exclude password hashes, TOTP secrets, recovery codes, token hashes and gateway card tokens. [GES-122]
3. IF a user requests more than 3 exports in 24 hours THEN the API SHALL return 429 `TOO_MANY_ATTEMPTS`. [GES-123]
4. WHEN a user without blockers confirms deletion (current password, or the text `EXCLUIR` for Google-only accounts) THEN the API SHALL anonymize the account per design §LGPD anonymization, revoke all sessions, clear the cookie, queue `privacy.account_deleted` to the original address, write audit `user.anonymize` and return 200. [GES-124]
5. IF the user has future non-terminal bookings, active or suspended subscriptions, or pending charges THEN the API SHALL return 409 `HAS_ACTIVE_COMMITMENTS` with the list and change nothing. [GES-125]
6. IF the password or confirmation text is wrong THEN the API SHALL return 401 `INVALID_CREDENTIALS` and change nothing. [GES-126]
7. WHEN an admin anonymizes a customer on request with a justification of 5..500 chars THEN the API SHALL apply the same blockers and effects, and IF reception calls it THEN 403. [GES-127]
8. WHEN the tenant opens `/app/perfil/privacidade` THEN the page SHALL list consents (kind label, version, date) and offer "Baixar meus dados" and "Excluir minha conta" with a confirmation modal describing what is kept and what is erased. [GES-128]
9. WHEN the weekly `retention` job runs THEN the system SHALL delete sessions and auth tokens expired, used or revoked more than 30 days ago, rate-limit windows older than 2 days and expired idempotency keys, blank `html`, `text_body` and `attachments` of outbox rows older than 180 days, and record the counts in `job_runs.stats`. [GES-129]

**Independent Test**: integration tests over factories from all features.

---

### P1: Holiday jobs ⭐ MVP

**User Story**: As the Administrador geral, I want national holidays imported and a yearly reminder to review state and municipal ones, so that the calendar stays right.

**Why P1**: §5.2, US-11, AD-007 (daily holiday reminder and holiday import owned by gestao per `docs/architecture.md` §8).

**Acceptance Criteria**:
1. WHEN the daily `holiday-reminder` job runs on the local date equal to `calendar.holiday_review_reminder` THEN the system SHALL queue `staff.holiday_review` to every active admin once per year (dedupe `holiday_review:<year>:<userId>`), and on other dates SHALL do nothing. [GES-130]
2. WHEN the weekly `import-holidays` job runs THEN the system SHALL fetch BrasilAPI for the current and next year and insert each national holiday whose date has no national holiday yet, with `source = 'brasilapi'`, `is_closed = false`, leaving existing rows unchanged. [GES-131]
3. IF BrasilAPI fails, times out after 10 seconds or returns an unexpected shape for a year THEN the job SHALL change no rows for that year, still process the other year, and record the error in `job_runs`. [GES-132]

**Independent Test**: integration tests with `now` injected and BrasilAPI `fetch` stubbed.

---

### P1: Analytics funnel ⭐ MVP

**User Story**: As the clinic, I want funnel events from day one, so that I can measure conversion (PRD §3).

**Why P1**: PRD §3 "eventos de funil instrumentados desde o dia 1".

**Acceptance Criteria**:
1. WHERE `VITE_ANALYTICS_PROVIDER` is unset the web SHALL request no third-party analytics script and `track()` SHALL be a no-op. [GES-133]
2. WHERE the provider is `posthog` or `ga4` the web SHALL load its script only after the window `load` event and in cookieless mode. [GES-134]
3. WHEN the funnel steps happen THEN the web SHALL send `page_view`, `view_room`, `select_slot`, `begin_checkout`, `purchase` (event names kept from nucleo NUC-206), `subscription_purchased`, `quote_requested` and `signup_completed` with only whitelisted properties (room slug, category type, payment method, value bucket), never name, e-mail, phone or document. [GES-135]
4. WHILE the route is under `/admin` the web SHALL send no analytics event. [GES-136]

**Independent Test**: unit tests of `lib/analytics.ts` with a fake provider.

---

### P2: Free-tier usage panel

**User Story**: As the Administrador geral, I want a simple view of free-tier consumption, so that I plan the move to a paid plan.

**Why P2**: PRD §8 "painel simples de consumo"; operations work without it.

**Acceptance Criteria**:
1. WHEN an admin calls `GET /api/admin/usage` THEN the API SHALL return database bytes (`pg_database_size`), object-storage bytes per bucket, e-mails sent this month and today, the 10 largest tables with total size and estimated rows, each with its limit from `usage.limits` and the percentage used. [GES-137]
2. WHEN any usage reaches 80 % of its limit THEN the API SHALL flag it `warning: true` and the Consumo tab SHALL highlight it. [GES-138]
3. IF listing object storage fails THEN the API SHALL return the other figures with storage fields `null` and `storageError` set. [GES-139]

**Independent Test**: integration test with a stubbed S3 list.

---

### P1: MVP hardening and production release ⭐ MVP

**User Story**: As the clinic owner, I want the MVP verified end to end, accessible and fast, and deployed, so that the clinic can open.

**Why P1**: PRD §9 MVP definition, §8 performance and compatibility.

**Acceptance Criteria**:
1. WHEN `npm run e2e -w apps/web` runs on a 390×844 mobile viewport THEN the MVP journey SHALL pass: open `/salas`, open a room, pick a slot, sign up, accept the policy, pay in the sandbox, see "Confirmada", find the confirmation outbox row with an `.ics` attachment whose UID equals the booking's `ics_uid`, reschedule, and find a new `.ics` with the same UID and SEQUENCE + 1 and the personal feed showing the new time. [GES-140]
2. WHEN the admin e2e runs THEN it SHALL pass: admin logs in with TOTP, changes a category price, creates an expense with a PDF attachment, exports the DRE and the downloaded workbook has the 7 lines, issues a clinic ICS link that returns a VCALENDAR, issues an MCP token whose `tools/list` call succeeds, and revokes it. [GES-141]
3. WHEN the axe suite runs on `/`, `/salas`, `/salas/principal`, `/reservar`, `/servicos-extras`, `/login`, `/app`, `/app/minhas-reservas`, `/app/perfil/privacidade`, `/admin/reservas`, `/admin/financeiro`, `/admin/integracoes` and `/admin/clientes` in Day and Night themes THEN it SHALL report zero violations tagged `wcag2a`, `wcag2aa`, `wcag21a` or `wcag21aa`. [GES-142]
4. WHEN Lighthouse CI runs the mobile preset on `/`, `/salas` and `/salas/principal` THEN LCP SHALL be ≤ 2500 ms, CLS ≤ 0.1 and the accessibility score ≥ 0.95. [GES-143]
5. WHEN the production release runs with the user's go-ahead THEN the gestao migration SHALL be applied, the function SHALL be deployed with buckets `room-photos` and `expense-attachments` and the gestao triggers, and `node scripts/smoke.mjs https://bravo-clinic.netlify.app` SHALL exit 0 including the gestao checks. [GES-144]

**Independent Test**: the e2e, axe and Lighthouse commands; smoke against production.

---

## Edge Cases

- IF a charge is approved in one month for a booking used in the next THEN Caixa SHALL count it in the approval month and Competência in the usage month. (GES-02, GES-03)
- IF a subscription period crosses the report range edge THEN Competência SHALL count only the days inside the range. (GES-04)
- IF a refund is approved but its charge predates the range THEN Caixa SHALL still report the refund in the refund's month. (GES-02, GES-07)
- IF two admins regenerate the same clinic feed concurrently THEN exactly one feed SHALL stay active (partial unique index) and the other request SHALL get 409 `CONFLICT`. (GES-42)
- IF the recurring-expenses job is interrupted and re-run THEN no duplicate child SHALL exist (unique `(recurrence_parent_id, date)`). (GES-14)
- WHEN a monthly expense starts on the 31st THEN children SHALL fall on the 30th, 28th/29th or 31st of each month. (GES-14)
- IF two admins move the same quote request concurrently THEN only the first transition SHALL apply and the second SHALL get 409 `INVALID_TRANSITION`. (GES-95)
- IF a push endpoint is reused by a new user on a shared device THEN it SHALL be reassigned and the previous user SHALL stop receiving pushes there. (GES-76)
- IF an MCP destructive call repeats with `confirm: true` after a booking already changed state THEN the service SHALL return 409 `INVALID_TRANSITION` as a tool error. (GES-59)
- IF the DRE range starts mid-month THEN the first month column SHALL include only days from `from`. (GES-30)
- IF the summary range contains no data THEN every bucket SHALL be returned with zeros and percentage deltas `null`. (GES-22, GES-24)
- IF an expense attachment is replaced THEN the previous object SHALL be deleted after commit and a failed delete SHALL be logged without failing the request. (GES-16)
- IF a room photo registration references an upload id whose objects are missing THEN the API SHALL return 422 and insert nothing. (GES-105)
- IF a deleted (anonymized) user's personal feed URL is fetched THEN the API SHALL return 404. (GES-52, GES-124)
- IF BrasilAPI returns a holiday on a date that already has bookings THEN it SHALL still be inserted as open (`is_closed = false`) so prices of kept bookings never change. (GES-131)
- IF the notification emit runs inside a transaction that rolls back THEN no e-mail row and no push SHALL be produced. (GES-67, GES-78)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Task(s) | Status |
| --- | --- | --- | --- | --- |
| GES-01 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-02 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-03 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-04 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-05 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-06 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-07 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-08 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-09 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-10 | P1: Revenue recognition engine | Tasks | T2 | Verified |
| GES-11 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-12 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-13 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-14 | P1: Expenses and manual receipts | Tasks | T16 | Verified |
| GES-15 | P1: Expenses and manual receipts | Tasks | T16 | Verified |
| GES-16 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-17 | P1: Expenses and manual receipts | Tasks | T4, T15 | Verified |
| GES-18 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-19 | P1: Expenses and manual receipts | Tasks | T15 | Verified |
| GES-20 | P1: Expenses and manual receipts | Tasks | T17 | Verified |
| GES-21 | P1: Expenses and manual receipts | Tasks | T17 | Verified |
| GES-22 | P1: Financeiro overview | Tasks | T2, T18 | Verified |
| GES-23 | P1: Financeiro overview | Tasks | T2 | Verified |
| GES-24 | P1: Financeiro overview | Tasks | T2, T18 | Verified |
| GES-25 | P1: Financeiro overview | Tasks | T1, T18 | Verified |
| GES-26 | P1: Financeiro overview | Tasks | T29 | Verified |
| GES-27 | P1: Financeiro overview | Tasks | T28, T29 | Verified |
| GES-28 | P1: Financeiro overview | Tasks | T29 | Verified |
| GES-29 | P1: DRE export | Tasks | T19 | Verified |
| GES-30 | P1: DRE export | Tasks | T2, T19 | Verified |
| GES-31 | P1: DRE export | Tasks | T2, T19 | Verified |
| GES-32 | P1: DRE export | Tasks | T2, T19 | Verified |
| GES-33 | P1: DRE export | Tasks | T19 | Verified |
| GES-34 | P1: DRE export | Tasks | T19 | Verified |
| GES-35 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-36 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-37 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-38 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-39 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-40 | P1: Payment gateway configuration | Tasks | T11 | Verified |
| GES-41 | P1: Payment gateway configuration | Tasks | T11, T31 | Verified |
| GES-42 | P1: Calendar feeds and .ics files | Tasks | T10, T32 | Verified |
| GES-43 | P1: Calendar feeds and .ics files | Tasks | T10 | Verified |
| GES-44 | P1: Calendar feeds and .ics files | Tasks | T10 | Verified |
| GES-45 | P1: Calendar feeds and .ics files | Tasks | T10, T41 | Verified |
| GES-46 | P1: Calendar feeds and .ics files | Tasks | T10 | Verified |
| GES-47 | P1: Calendar feeds and .ics files | Tasks | T8 | Verified |
| GES-48 | P1: Calendar feeds and .ics files | Tasks | T8, T10 | Verified |
| GES-49 | P1: Calendar feeds and .ics files | Tasks | T10, T45 | Verified |
| GES-50 | P1: Calendar feeds and .ics files | Tasks | T10, T41 | Verified |
| GES-51 | P1: Calendar feeds and .ics files | Tasks | T10 | Verified |
| GES-52 | P1: Calendar feeds and .ics files | Tasks | T10 | Verified |
| GES-53 | P1: MCP server | Tasks | T13 | Verified |
| GES-54 | P1: MCP server | Tasks | T13 | Verified |
| GES-55 | P1: MCP server | Tasks | T13 | Verified |
| GES-56 | P1: MCP server | Tasks | T13 | Verified |
| GES-57 | P1: MCP server | Tasks | T14 | Verified |
| GES-58 | P1: MCP server | Tasks | T14 | Verified |
| GES-59 | P1: MCP server | Tasks | T14 | Verified |
| GES-60 | P1: MCP server | Tasks | T13 | Verified |
| GES-61 | P1: MCP server | Tasks | T13, T14 | Verified |
| GES-62 | P1: MCP server | Tasks | T14 | Verified |
| GES-63 | P1: MCP server | Tasks | T13, T33 | Verified |
| GES-64 | P1: MCP server | Tasks | T13 | Verified |
| GES-65 | P1: Notification e-mails | Tasks | T12 | Verified |
| GES-66 | P1: Notification e-mails | Tasks | T12 | Verified |
| GES-67 | P1: Notification e-mails | Tasks | T5 | Verified |
| GES-68 | P1: Notification e-mails | Tasks | T5 | Verified |
| GES-69 | P1: Notification e-mails | Tasks | T43 | Verified |
| GES-70 | P1: Notification e-mails | Tasks | T12 | Verified |
| GES-71 | P1: Notification e-mails | Tasks | T12 | Verified |
| GES-72 | P1: Notification e-mails | Tasks | T9 | Verified |
| GES-73 | P1: Notification e-mails | Tasks | T7 | Verified |
| GES-74 | P1: Notification e-mails | Tasks | T12, T32 | Verified |
| GES-75 | P1: Web push | Tasks | T6 | Verified |
| GES-76 | P1: Web push | Tasks | T6 | Verified |
| GES-77 | P1: Web push | Tasks | T6 | Verified |
| GES-78 | P1: Web push | Tasks | T5 | Verified |
| GES-79 | P1: Web push | Tasks | T5 | Verified |
| GES-80 | P1: Web push | Tasks | T5 | Verified |
| GES-81 | P1: Web push | Tasks | T5 | Verified |
| GES-82 | P1: Web push | Tasks | T40 | Verified |
| GES-83 | P1: Web push | Tasks | T40 | Verified |
| GES-84 | P1: Extra services catalog and online add-on | Tasks | T20 | Verified |
| GES-85 | P1: Extra services catalog and online add-on | Tasks | T1, T20 | Verified |
| GES-86 | P1: Extra services catalog and online add-on | Tasks | T20 | Verified |
| GES-87 | P1: Extra services catalog and online add-on | Tasks | T38 | Verified |
| GES-88 | P1: Extra services catalog and online add-on | Tasks | T20, T39 | Verified |
| GES-89 | P1: Extra services catalog and online add-on | Tasks | T20 | Verified |
| GES-90 | P1: Quote request funnel | Tasks | T21 | Verified |
| GES-91 | P1: Quote request funnel | Tasks | T21 | Verified |
| GES-92 | P1: Quote request funnel | Tasks | T21 | Verified |
| GES-93 | P1: Quote request funnel | Tasks | T21 | Verified |
| GES-94 | P1: Quote request funnel | Tasks | T21 | Verified |
| GES-95 | P1: Quote request funnel | Tasks | T21 | Implementing |
| GES-96 | P1: Quote request funnel | Tasks | T21, T34 | Verified |
| GES-97 | P1: Quote request funnel | Tasks | T21, T38 | Verified |
| GES-98 | P1: Quote request funnel | Tasks | T38 | Verified |
| GES-99 | P1: Clientes | Tasks | T23, T35 | Verified |
| GES-100 | P1: Clientes | Tasks | T23, T35 | Verified |
| GES-101 | P1: Clientes | Tasks | T23 | Verified |
| GES-102 | P1: Clientes | Tasks | T23 | Verified |
| GES-103 | P1: Salas admin | Tasks | T22, T36 | Verified |
| GES-104 | P1: Salas admin | Tasks | T22 | Verified |
| GES-105 | P1: Salas admin | Tasks | T22 | Verified |
| GES-106 | P1: Salas admin | Tasks | T4, T22 | Verified |
| GES-107 | P1: Salas admin | Tasks | T22 | Verified |
| GES-108 | P1: Salas admin | Tasks | T1, T22, T36 | Verified |
| GES-109 | P1: Salas admin | Tasks | T36 | Verified |
| GES-110 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-111 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-112 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-113 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-114 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-115 | P1: Usuários and audit log | Tasks | T24 | Verified |
| GES-116 | P1: Usuários and audit log | Tasks | T37 | Verified |
| GES-117 | P1: Reception restrictions end-to-end | Tasks | T44 | Verified |
| GES-118 | P1: Reception restrictions end-to-end | Tasks | T44 | Verified |
| GES-119 | P1: Reception restrictions end-to-end | Tasks | T44 | Verified |
| GES-120 | P1: Reception restrictions end-to-end | Tasks | T13, T44 | Verified |
| GES-121 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-122 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-123 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-124 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-125 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-126 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-127 | P1: LGPD self-service | Tasks | T25 | Verified |
| GES-128 | P1: LGPD self-service | Tasks | T41 | Verified |
| GES-129 | P1: LGPD self-service | Tasks | T9 | Verified |
| GES-130 | P1: Holiday jobs | Tasks | T26 | Verified |
| GES-131 | P1: Holiday jobs | Tasks | T26 | Verified |
| GES-132 | P1: Holiday jobs | Tasks | T26 | Verified |
| GES-133 | P1: Analytics funnel | Tasks | T42 | Verified |
| GES-134 | P1: Analytics funnel | Tasks | T42 | Verified |
| GES-135 | P1: Analytics funnel | Tasks | T42 | Verified |
| GES-136 | P1: Analytics funnel | Tasks | T42 | Verified |
| GES-137 | P2: Free-tier usage panel | Tasks | T27, T33 | Verified |
| GES-138 | P2: Free-tier usage panel | Tasks | T27, T33 | Implementing |
| GES-139 | P2: Free-tier usage panel | Tasks | T27 | Verified |
| GES-140 | P1: MVP hardening and production release | Tasks | T45 | Verified |
| GES-141 | P1: MVP hardening and production release | Tasks | T46 | Verified |
| GES-142 | P1: MVP hardening and production release | Tasks | T47 | Implemented |
| GES-143 | P1: MVP hardening and production release | Tasks | T48 | In Tasks |
| GES-144 | P1: MVP hardening and production release | Tasks | T49, T50 | In Tasks |

**ID format:** `GES-NN`.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 144 total, 144 mapped to tasks, 0 unmapped.

### Implicit-requirement dimensions sweep

| Dimension | Coverage |
| --- | --- |
| Input validation & bounds | GES-11, GES-12, GES-17, GES-19..21, GES-25, GES-53, GES-62, GES-65, GES-66, GES-76, GES-84, GES-85, GES-89..91, GES-103, GES-106; shared zod schemas in core (AD-024) |
| Failure / partial-failure states | GES-37 (gateway test timeout), GES-72 (e-mail retry), GES-79/81 (push failures never fail requests), GES-132 (BrasilAPI), GES-139 (storage listing), attachment/photo object deletion after commit (edge cases) |
| Idempotency / retry / duplicate handling | GES-14 (unique child per date), GES-40 and GES-67 (outbox dedupe keys), GES-130 (yearly dedupe), GES-131 (insert only missing dates), GES-76 (upsert by endpoint), GES-105 (registration by upload id) |
| Auth boundaries & rate limits | GES-26/117..120 (roles), GES-51 (feed 60/h), GES-56/60 (MCP bearer, per-minute limit), GES-70 (test e-mail 5/h), GES-92 (quote 5/h/IP), GES-123 (export 3/24h), GES-102/127 (admin-only actions) |
| Concurrency / ordering | Partial unique index on active clinic/room feeds (edge case), guarded quote transitions GES-95, unique `(recurrence_parent_id, date)`, MCP rate-limit counter via atomic upsert (fundacao), notification emit in caller's transaction GES-67 |
| Data lifecycle / expiry | GES-18 (300 s presigned URLs), GES-53 (token expiry), GES-79 (push pruning), GES-124 (anonymization), GES-129 (retention purge), feed windows GES-44/46 |
| Observability | GES-61 (MCP audit), every mutation audited (GES-11..21, 36, 38, 42, 43, 53, 54, 84, 95, 101..107, 111..114, 121, 124), GES-71 (outbox list), GES-115/116 (audit screen), job runs stats GES-129/132, GES-137 (usage) |
| External-dependency failure | GES-37 (gateway), GES-72/74 (Resend absent/failing), GES-79/81 (push service), GES-132 (BrasilAPI), GES-139 (object storage), GES-133 (analytics unset) |
| State-transition integrity | GES-95 (quote funnel), GES-104 (room inactivation guard), GES-113 (last admin), GES-125 (LGPD blockers), GES-38/39 (gateway activation preconditions); booking/subscription machines: N/A because nucleo/receita own them (`docs/architecture.md` §3) |

---

## Success Criteria

- [ ] The DRE exported for any month equals the Financeiro screen to the cent in both regimes (Verifier recomputes one month by hand from seeded rows).
- [ ] An MCP client (Claude) connected with a `read_write` token lists the agenda, creates a pre-reservation and launches an expense, each visible in the audit log with origin MCP.
- [ ] The Google Calendar subscription to the clinic feed shows a new booking after the next refresh, and the tenant's personal feed shows a reschedule with the same event.
- [ ] Playwright MVP journey, admin journey, axe suite and Lighthouse CI all pass in CI.
- [ ] Every GES requirement verified by the Verifier with file:line evidence.
