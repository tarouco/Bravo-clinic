# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Test both sides of every numeric bound in a validation rule, including the value just below the minimum
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `validation` · harmful: 0
- features: fundacao
- evidence: M1 packages/core/src/validation/auth-schemas.ts:10 (FND-17) (validation)
- last seen: 2026-10-26T04:00:05Z

### L-002 - Write deploy smoke ACs only for content present in the served HTML, not text rendered client-side
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ops` · harmful: 0
- features: fundacao
- evidence: FND-129 scripts/smoke.mjs:33 (ops)
- last seen: 2026-10-26T04:00:07Z

### L-003 - When a spec names a timeout value, assert that exact value with fake timers, not just that an abort signal exists
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `api` · harmful: 0
- features: fundacao
- evidence: FND-80 apps/api/src/lib/email.int.test.ts:84 (api)
- last seen: 2026-10-26T04:00:09Z

### L-004 - Assert every column-type convention the spec names with an information_schema query, not only one of them
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `db` · harmful: 0
- features: fundacao
- evidence: FND-36 apps/api/src/db/migrations.int.test.ts:92 (db)
- last seen: 2026-10-26T04:00:12Z

### L-005 - When an AC names a responsive breakpoint, assert the breakpoint visibility classes
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `web` · harmful: 0
- features: fundacao
- evidence: FND-95 apps/web/src/components/layout/Header.tsx:35 (web)
- last seen: 2026-10-26T04:00:14Z

### L-006 - When a page accepts several input formats, test each format through the page, not only through the shared schema
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `web` · harmful: 0
- features: fundacao
- evidence: FND-113 apps/web/src/pages/auth/TwoFactorPages.test.tsx:53 (web)
- last seen: 2026-10-26T04:00:16Z

### L-007 - Derive expected migration counts from the migration journal instead of hard-coding them
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `db` · harmful: 0
- features: fundacao
- evidence: FND-31 apps/api/src/db/migrations.int.test.ts:88 (db)
- last seen: 2026-10-26T04:00:19Z

### L-008 - In page tests that load data, wait for the loading state to clear before the first findBy query instead of relying on the default 1 s timeout
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `web` · harmful: 0
- features: nucleo
- evidence: apps/web/src/pages/app/AgendaPage.test.tsx:32 (NUC-190, fundacao validation iteration 2) (web)
- last seen: 2026-10-26T14:02:48Z

### L-009 - For an allow-only transition table, test every disallowed (from, to) pair with it.each, not one sample per kind.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/api state machines` · harmful: 0
- features: gestao
- evidence: A7 apps/api/src/modules/extras/quote-requests.service.ts:183 (apps/api state machines)
- last seen: 2026-10-28T12:03:30Z

### L-010 - Every soft-delete filter feeding a report needs a fixture with a deleted row next to a live one.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/api reports` · harmful: 0
- features: gestao
- evidence: A19 apps/api/src/modules/finance/finance-report.service.ts:226 (apps/api reports)
- last seen: 2026-10-28T12:03:30Z

### L-011 - Test a percentage threshold at exactly the threshold and one step below, not only well above it.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `thresholds` · harmful: 0
- features: gestao
- evidence: A12 apps/api/src/modules/usage/usage.service.ts:12 (thresholds)
- last seen: 2026-10-28T12:03:31Z

### L-012 - When the spec names a timeout value, assert the value or abort time, not just a simulated TimeoutError.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `external calls` · harmful: 0
- features: gestao
- evidence: GES-37 gateway-config.service.ts:36; GES-132 holiday-import.ts:11 (external calls)
- last seen: 2026-10-28T12:03:31Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
