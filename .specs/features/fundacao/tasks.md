# Fundação Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/fundacao/design.md`
**Spec**: `.specs/features/fundacao/spec.md`
**Blueprint**: `docs/architecture.md`
**Status**: Approved

Worker rules specific to this feature:

- Before installing any package run `npm view <pkg>@<line> version` and pin the newest patch of the line in `docs/architecture.md` §1.
- Never print secret values. `.env` (root, git-ignored) holds `DATABASE_URL_TEST` (Neon `dev`); read it only through config loaders.
- Phase 14 deploys to production: it runs only after the user gives an explicit go-ahead in chat for that phase (skill blast-radius rule).

---

## Test Coverage Matrix

> Generated from project guidelines and spec - confirm before Execute. Guidelines found: `.specs/STATE.md` AD-010 (Vitest everywhere; core unit; API integration against Neon `dev` via `DATABASE_URL_TEST`; web Testing Library), AD-018 (postgres:17 in CI). No existing tests (greenfield) - strong defaults applied on top of AD-010.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `packages/core` domain helpers | unit | All branches; 1:1 to spec ACs; every listed edge case and every PRD example value asserted verbatim | `packages/core/src/**/*.test.ts` | `npm test -w packages/core` |
| `apps/api` pure libs (env, crypto, totp, logger redaction) | unit | All branches; 1:1 to the ACs they implement | `apps/api/src/**/*.test.ts` | `npm test -w apps/api` |
| `apps/api` routes, middleware, services | integration (`app.request()` + real Postgres) | Every route: happy path + each listed edge case + each documented error code/status; persisted rows asserted, not only responses | `apps/api/src/**/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` migrations and DB constraints | integration | Each constraint/trigger: accepted case + rejected case with SQLSTATE | `apps/api/src/db/*.int.test.ts` | `npm test -w apps/api` |
| `apps/api` Drizzle schema files, migration SQL generation | none | - (build gate; behavior verified by the next task's integration tests, merge-forward) | - | build gate only |
| `apps/web` components, hooks, pages with logic | unit (Testing Library + jsdom) | Every AC of the component: rendered text/roles/attributes and interactions; error states | `apps/web/src/**/*.test.tsx` | `npm test -w apps/web` |
| `apps/web` config (Tailwind tokens, tokens.css, manifest, index.html, redirects generator) | unit | Every token/field named by the AC asserted by value | `apps/web/src/**/*.test.ts`, `apps/web/scripts/*.test.mjs` | `npm test -w apps/web` |
| Repo config (tsconfig, eslint, package.json, CI workflow, netlify.toml) | none | - (build gate; the command itself is the check) | - | build gate only |
| Operational steps (migrate/seed/deploy on Neon and Netlify) | none | - (verified by the smoke check of T78 and Done-when checks) | - | build gate only |
| Production deploy | e2e smoke | `/api/health`, `/`, `/api/public/config` | `scripts/smoke.mjs` | `node scripts/smoke.mjs <siteUrl>` |

## Gate Check Commands

> Generated from the planned root scripts - confirm before Execute. Commands become available as Phase 1 lands; until then each Phase 1 task runs the subset that exists.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test -w <workspace touched>` (`npm test -w packages/core` or `npm test -w apps/web` or `npm test -w apps/api`) |
| Full | After tasks with integration tests | `npm run typecheck && npm test -w apps/api` |
| Build | After phase completion or config/schema-only tasks | `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order. `[P]` marks a task with no dependency inside its phase (parallel-safe if a future harness allows it).

### Phase 1: Workspace tooling

```
T1 → T2 → T3 → T4
```

### Phase 2: Core helpers

```
T5 [P]
T6 → T10
T7 → T8
T9 [P]
T11 [P]
```

### Phase 3: API skeleton

```
T12 → T13 → T14 → T16 → T17
T12 → T15 → T16
```

### Phase 4: Base schema, migrations and seeds

```
T18 → T21
T19 → T21
T20 → T21
T21 → T22 → T23
```

### Phase 5: Security and platform services

```
T24 → T27 → T28
T25 [P]
T26 [P]
T29 [P]
T30 [P]
```

### Phase 6: Auth endpoints

```
T31 [P]
T32 → T35
T32 → T37
T33 [P]
T34 [P]
T36 [P]
```

### Phase 7: Web scaffold and design tokens

```
T38 → T39 → T40 → T41
T39 → T42
```

### Phase 8: Base UI components

```
T43 → T46
T43 → T48
T43 → T49
T44 [P]
T45 → T49
T47 [P]
```

### Phase 9: Data layer and public layout

```
T50 → T51 → T54
T50 → T53 → T54
T52 → T54
```

### Phase 10: Home page

```
T55 → T61
T56 → T61
T57 → T61
T58 → T61
T59 → T61
T60 → T61
```

### Phase 11: Routing, guards and auth pages

```
T62 → T63 → T64 → T68
T62 → T64
T62 → T65
T63 → T65
T62 → T66
T63 → T66
T62 → T67
T63 → T67
```

### Phase 12: Shells, PWA and SEO

```
T69 [P]
T70 [P]
T71 [P]
T72 [P]
```

### Phase 13: Delivery configuration

```
T73 → T75
T74 [P]
```

### Phase 14: First production deploy (explicit go-ahead required)

```
T76 → T77 → T78
```

---

## Task Breakdown

### Phase 1: Workspace tooling

#### T1: Create root workspace manifest

**What**: Root `package.json` (private, `"type": "module"`, workspaces `apps/web`, `apps/api`, `packages/core`, engines node ≥ 24, scripts `typecheck`, `lint`, `format`, `test`, `build`, `dev`, `db:migrate`, `db:seed` per design §Workspace tooling) plus `.nvmrc` (24), `.editorconfig`, `.prettierrc.json`, and `.env.example` listing every variable name of `docs/architecture.md` §10 with empty values; confirm `.gitignore` keeps `.env*` ignored except `.env.example`.
**Where**: `package.json` (+ `.nvmrc`, `.editorconfig`, `.prettierrc.json`, `.env.example`)
**Depends on**: None
**Reuses**: `docs/architecture.md` §2, §10
**Requirement**: FND-01, FND-130

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm install` at the root exits 0 (workspace folders may be empty stubs with their own `package.json` created in later tasks; create `apps/web/package.json`, `apps/api/package.json`, `packages/core/package.json` minimal stubs here so install resolves)
- [x] `.env.example` contains only names with empty values; `git check-ignore .env` prints `.env`
- [x] Gate check passes: `npm install`

**Tests**: none
**Gate**: build (partial: `npm install`)

**Commit**: `chore(repo): add npm workspaces manifest and env template`

---

#### T2: Add strict TypeScript base config

**What**: `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `module`/`moduleResolution` `Bundler` (web/core) and `NodeNext`-compatible settings documented for api, `target` ES2023, `skipLibCheck`; per-workspace `tsconfig.json` extending it; each workspace `typecheck` script = `tsc --noEmit -p .`.
**Where**: `tsconfig.base.json`
**Depends on**: T1
**Reuses**: none
**Requirement**: FND-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm run typecheck` exits 0 with an empty `src/index.ts` in each workspace
- [x] A deliberate `const a: string[] = []; const b: string = a[0];` fails typecheck (verify, then remove)
- [x] Gate check passes: `npm run typecheck`

**Tests**: none
**Gate**: build (partial: `npm run typecheck`)

**Commit**: `chore(repo): add strict typescript base config`

---

#### T3: Configure ESLint and Prettier

**What**: Flat `eslint.config.js` using `typescript-eslint` recommended-type-checked, `eslint-plugin-react-hooks` for `apps/web`, Prettier compatibility, ignores (`dist`, `coverage`, `apps/api/drizzle`), and a `no-restricted-imports` + `no-restricted-globals` (`fetch`) rule for `packages/core/src/**` (excluding `*.test.ts`) forbidding `pg`, `drizzle-orm`, `hono`, `react`, `react-dom`, `node:*`.
**Where**: `eslint.config.js`
**Depends on**: T2
**Reuses**: none
**Requirement**: FND-03, FND-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm run lint` exits 0 on the tree
- [x] Adding `import 'pg'` to `packages/core/src/index.ts` makes `npm run lint` exit non-zero with `no-restricted-imports` (verify, then revert)
- [x] Gate check passes: `npm run typecheck && npm run lint`

**Tests**: none
**Gate**: build (partial: `npm run typecheck && npm run lint`)

**Commit**: `chore(repo): add eslint flat config with core purity rule`

---

#### T4: Scaffold @bravo/core with Vitest

**What**: `packages/core/package.json` (`name: @bravo/core`, `exports: { ".": "./src/index.ts" }`, dependency `zod`, scripts `test: vitest run`, `typecheck`), `vitest.config.ts` (node environment), `src/index.ts` barrel.
**Where**: `packages/core/`
**Depends on**: T3
**Reuses**: none
**Requirement**: FND-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm test -w packages/core` runs Vitest (passes with no test files via `passWithNoTests: true`, removed in T5)
- [x] A temporarily failing test makes the command exit non-zero (verify, then delete)
- [x] Gate check passes: `npm run typecheck && npm run lint && npm test -w packages/core`

**Tests**: none
**Gate**: build

**Commit**: `chore(core): scaffold @bravo/core package with vitest`

---

### Phase 2: Core helpers

#### T5: Implement money helpers [P]

**What**: `assertCents`, `formatBRL`, `parseBRLToCents`, `percentOfCents`, `basisPointsOfCents`, `mulDivRoundHalfUp`, `ceilDiv` per `docs/architecture.md` §7.1; export from the barrel; remove `passWithNoTests`.
**Where**: `packages/core/src/money.ts`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §7.1
**Requirement**: FND-07, FND-08, FND-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `formatBRL(160000) === 'R$ 1.600,00'`, `formatBRL(9700) === 'R$ 97,00'`, `formatBRL(0)`
- [x] Tests assert `percentOfCents(14550, 50) === 7275`, `percentOfCents(9701, 50) === 4851`, `mulDivRoundHalfUp(28000, 60, 150) === 11200`
- [x] Tests assert `parseBRLToCents` for "1.600,00", "R$ 97", "97,5" and `null` for "abc", "", "1,2,3"
- [x] `assertCents(1.5)` throws
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 12 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add integer-cents money helpers`

---

#### T6: Implement São Paulo time helpers [P]

**What**: `CLINIC_TZ`, `LocalDate`, `localToUtc`, `utcToLocal`, `addDays`, `weekdayOf`, `localDayRangeUtc`, `diffDays`, `formatDateBR`, `formatTimeBR`, `formatDateTimeBR`, `minuteToHHMM` via `Intl.DateTimeFormat` (no hard-coded offsets).
**Where**: `packages/core/src/time.ts`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §7.2
**Requirement**: FND-10, FND-11, FND-12, FND-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `localToUtc('2026-10-27', 600).toISOString() === '2026-10-27T13:00:00.000Z'` and minute 1440 → `'2026-10-28T03:00:00.000Z'`
- [x] Tests assert `utcToLocal(new Date('2026-10-28T02:30:00Z'))` deep-equals `{ date: '2026-10-27', minuteOfDay: 1410, weekday: 2 }`
- [x] Tests assert `formatDateTimeBR(new Date('2026-10-27T13:00:00Z')) === '27/10/2026 10:00'`, `minuteToHHMM(1440) === '00:00'`, `weekdayOf('2026-11-02') === 1`, `addDays('2026-12-31', 1) === '2027-01-01'`
- [x] A test reads `time.ts` source and asserts it contains no `-03:00` / `-0300` literal (FND-12)
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 10 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add america/sao_paulo time helpers`

---

#### T7: Implement CPF/CNPJ validation [P]

**What**: `parseDocument(input)` (strip non-digits, 11 → CPF, 14 → CNPJ, check digits, reject all-equal) and `formatDocument`.
**Where**: `packages/core/src/validation/document.ts`
**Depends on**: T4
**Reuses**: none
**Requirement**: FND-14, FND-15, FND-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `parseDocument('529.982.247-25')` → `{ type: 'cpf', digits: '52998224725' }` and `parseDocument('11.222.333/0001-81')` → `{ type: 'cnpj', digits: '11222333000181' }`
- [x] Tests assert `null` for `'111.111.111-11'`, `'529.982.247-24'`, `'11.222.333/0001-80'`, `'1234567890'`, `''`
- [x] Tests assert `formatDocument` round-trips both samples
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add cpf and cnpj validation`

---

#### T8: Implement shared auth schemas

**What**: zod `passwordSchema`, `emailSchema`, `phoneSchema`, `signupSchema` (document refined by `parseDocument` with message "CPF ou CNPJ inválido"; `acceptTerms`/`acceptPrivacy` `z.literal(true)`), `loginSchema`, `passwordResetRequestSchema`, `passwordResetConfirmSchema`, `totpCodeSchema`; pt-BR messages.
**Where**: `packages/core/src/validation/auth-schemas.ts`
**Depends on**: T7
**Reuses**: `parseDocument` (T7)
**Requirement**: FND-17, FND-44 (schema half), FND-47 (schema half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert passwords "abc12" (short), "abcdefgh" (no digit), "12345678" (no letter), 129 chars → rejected with exactly "A senha precisa ter de 8 a 128 caracteres, com letras e números"; "senha123" accepted
- [x] Tests assert signup with document "529.982.247-24" fails at path `document` with "CPF ou CNPJ inválido"; `acceptTerms: false` fails
- [x] Tests assert `emailSchema.parse('  Ana@Ex.com ') === 'ana@ex.com'`, phone "(47) 99999-0000" → "+5547999990000", `totpCodeSchema` accepts "123 456" → "123456"
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 12 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add shared auth validation schemas`

---

#### T9: Implement typed settings catalog [P]

**What**: `settingsCatalog` with every key, schema, default and scope of `docs/architecture.md` §4; `SettingKey`, `SettingValue<K>`, `parseSetting`, `settingDefaults`, `SettingValidationError`.
**Where**: `packages/core/src/settings/catalog.ts`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §4
**Requirement**: FND-18, FND-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A test asserts the catalog key set equals the §4 key list (literal array in the test) and each default equals the §4 value (e.g. `payment.deposit_percent` 50, `payment.balance_reminder_hours_before` [48, 36, 26], `calendar.cleanup_minutes` 30, `policy.reschedule_window_days` 60)
- [x] A test asserts every default passes its own schema
- [x] Tests assert `parseSetting('payment.deposit_percent', 150)` throws `SettingValidationError` whose message contains `payment.deposit_percent`; `parseSetting('calendar.slot_minutes', 25)` throws
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add typed settings catalog with factory defaults`

---

#### T10: Add 2026–2027 holiday seed data

**What**: `holidaySeed` constant with the 28 rows of design.md §Holiday seed.
**Where**: `packages/core/src/calendar/holidays-seed.ts`
**Depends on**: T6
**Reuses**: `LocalDate`, `weekdayOf` (T6)
**Requirement**: FND-39 (data)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert 28 rows: 20 `national`, 2 `state`, 6 `municipal`
- [x] Tests assert the SC/Itajaí rows (2026-06-04, 2026-06-15, 2026-08-16, 2026-12-08, 2027-05-27, 2027-06-15, 2027-08-15, 2027-12-08) and that only 2027-08-15 has `needsReview: true`
- [x] Tests assert `weekdayOf('2026-08-16') === 7` and `weekdayOf('2027-08-15') === 7` (Data Magna on Sunday) and no duplicate (date, name)
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add 2026-2027 national, sc and itajai holiday seed`

---

#### T11: Implement role access and navigation maps [P]

**What**: `Role`, `isStaff`, `AdminSection`, `adminSectionMeta` (labels pt-BR + paths `/admin/<key>`), `adminSectionsFor(role)`, `appNav` (Reservar `/app/reservar`, Minhas reservas `/app/minhas-reservas`, Agenda `/app/agenda`, Compras `/app/compras`, Perfil `/app/perfil`).
**Where**: `packages/core/src/access.ts`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §6.1, §9.1
**Requirement**: FND-74 (sections), FND-117 (labels), FND-118 (app nav)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `adminSectionsFor('admin')` equals `['calendario','reservas','financeiro','integracoes','cupons','servicos-extras','clientes','salas','usuarios','auditoria']` and `adminSectionsFor('reception')` equals `['reservas','clientes']`, `adminSectionsFor('tenant')` equals `[]`
- [x] Tests assert labels Calendário, Gestão de Reservas, Financeiro, Integrações, Cupons, Serviços Extras, Clientes, Salas, Usuários, Log de auditoria
- [x] Tests assert `appNav` labels in order Reservar, Minhas reservas, Agenda, Compras, Perfil
- [x] Gate check passes: `npm test -w packages/core`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(core): add role access and navigation maps`

---

### Phase 3: API skeleton

#### T12: Scaffold @bravo/api with env parsing

**What**: `apps/api/package.json` (deps hono, @hono/node-server, @hono/zod-validator, zod, pg, drizzle-orm, @neon/functions, jose, otpauth, @bravo/core; dev drizzle-kit, tsx, esbuild, @types/pg), `tsconfig.json`, `vitest.config.ts` (loads root `.env` with Vite `loadEnv`, sets `DATABASE_URL = DATABASE_URL_TEST` and fixed test-only `SESSION_SECRET`/`ENCRYPTION_KEY`/`APP_BASE_URL=http://localhost:5173`/`EMAIL_FROM`, `fileParallelism: false`), and `src/env.ts` (`envSchema`, `parseEnv`, `getEnv`, `EnvError`).
**Where**: `apps/api/src/env.ts`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §10
**Requirement**: FND-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert `parseEnv` without `SESSION_SECRET` throws `EnvError` whose `variables` include `SESSION_SECRET` and whose message does not contain any provided value
- [ ] Tests assert a 31-char `SESSION_SECRET`, an `ENCRYPTION_KEY` that is not 32 bytes base64, a non-URL `APP_BASE_URL`, an invalid `EMAIL_FROM` each fail with that variable named
- [ ] Tests assert a valid env parses and optional `RESEND_API_KEY`/`GOOGLE_*` stay `undefined` when absent
- [ ] Gate check passes: `npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): scaffold api workspace with validated env`

---

#### T13: Add request context and JSON logger

**What**: `lib/logger.ts` (`logger.info|warn|error`, `redact`) and `middleware/request-context.ts` (requestId from valid inbound `X-Request-Id` or new ULID-like id, `X-Request-Id` response header, one log line per request with method, path, status, durationMs, userId when known).
**Where**: `apps/api/src/middleware/request-context.ts` (+ `apps/api/src/lib/logger.ts`)
**Depends on**: T12
**Reuses**: design §API configuration and context
**Requirement**: FND-27

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (minimal Hono app + `app.request`) assert response header `X-Request-Id` exists, inbound valid id is echoed, invalid inbound id (`"x y"`) is replaced
- [ ] Tests spy on stdout and assert exactly one JSON line with `requestId`, `method`, `path`, `status`, `durationMs`
- [ ] Tests assert `redact({ password: 'a', nested: { token: 'b', Authorization: 'c' }, code: '1', ok: 1 })` replaces the four sensitive values with `"[redacted]"` and keeps `ok`
- [ ] Gate check passes: `npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add request id middleware and redacting json logger`

---

#### T14: Add error model, JSON guard and app factory

**What**: `lib/errors.ts` (`AppError` + helpers, `onError` mapping AppError/ZodError(422)/pg `23P01`(409 SLOT_TAKEN)/`23505`(409 CONFLICT)/other(500), `notFoundHandler`), `middleware/require-json.ts` (415 for mutating requests without `application/json`, skipping `/webhooks/*` and `/jobs/*`), `middleware/validate.ts` (zod-validator wrapper producing `details[].path`), and `app.ts` `createApp(deps)` wiring request-context → require-json → routes → handlers.
**Where**: `apps/api/src/app.ts` (+ `apps/api/src/lib/errors.ts`, `apps/api/src/middleware/require-json.ts`, `apps/api/src/middleware/validate.ts`)
**Depends on**: T13
**Reuses**: error envelope `docs/architecture.md` §6.2
**Requirement**: FND-24, FND-25, FND-26, FND-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Integration tests via `createApp().request()` with test-only routes assert: 422 body `{ error: { code: 'VALIDATION_FAILED', message: 'Dados inválidos', details: [{ path: 'name', message: <schema message> }], requestId } }`
- [ ] Unknown path → 404 `error.code === 'NOT_FOUND'`
- [ ] Throwing route → 500 `{ code: 'INTERNAL', message: 'Erro interno', requestId }` and body contains no `"stack"` and no `at ` frames
- [ ] POST with `text/plain` → 415 `UNSUPPORTED_MEDIA_TYPE`; POST to `/webhooks/x` with `text/plain` is not rejected by the guard
- [ ] Simulated pg error code `23P01` → 409 `SLOT_TAKEN`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add error envelope, json guard and app factory`

---

#### T15: Add database client and transaction helper

**What**: `createDb(url)` (pg Pool max 5 + `attachDatabasePool`), default `db`, `Db`/`Tx` types, `withTransaction(db, fn)`.
**Where**: `apps/api/src/db/client.ts`
**Depends on**: T12
**Reuses**: neon-functions pool pattern
**Requirement**: FND-28

**Tools**:

- MCP: NONE
- Skill: `neon-postgres`

**Done when**:

- [ ] Integration test (against `DATABASE_URL_TEST`) creates a temp table, inserts inside `withTransaction` then throws, and asserts the row count is 0 afterwards
- [ ] Integration test asserts a successful callback commits and returns its value
- [ ] Test setup fails with "DATABASE_URL_TEST is required for integration tests" when the variable is missing (no silent skip)
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 3 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add pg pool, drizzle client and transaction helper`

---

#### T16: Add health route

**What**: `GET /health` (public `/api/health`) running `select 1` with a 10 s timeout; 200 `{ status: 'ok', db: 'ok', branch }` or 503 `{ status: 'degraded', db: 'error' }`; mounted in `createApp`.
**Where**: `apps/api/src/routes/health.ts`
**Depends on**: T14, T15
**Reuses**: `createApp` deps injection (db)
**Requirement**: FND-21, FND-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Integration test asserts 200 and body `{ status: 'ok', db: 'ok', branch: null }` with the test DB (and `branch: 'dev'` when `NEON_BRANCH=dev` is injected)
- [ ] Integration test with an injected db whose `execute` rejects asserts 503 `{ status: 'degraded', db: 'error' }`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 2 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add health route with database check`

---

#### T17: Add Neon entry, local dev server and bundle check

**What**: `src/index.ts` (`export default createApp()`), `src/dev.ts` (`@hono/node-server` on port 8787 loading root `.env`), scripts `dev` (`tsx watch src/dev.ts`) and `bundle` (`esbuild src/index.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/index.mjs --packages=bundle` with `pg-native` external).
**Where**: `apps/api/src/index.ts` (+ `apps/api/src/dev.ts`)
**Depends on**: T16
**Reuses**: neon-functions Hono entry pattern
**Requirement**: FND-21 (served locally), FND-127 (entry consumed by neon.ts)

**Tools**:

- MCP: NONE
- Skill: `neon-functions`

**Done when**:

- [ ] `npm run bundle -w apps/api` exits 0 and produces `apps/api/dist/index.mjs` that includes `@bravo/core` code (proves workspace TS bundles)
- [ ] `npm run dev -w apps/api` serves `GET http://localhost:8787/health` → 200 (manual check)
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): add neon function entry and local dev server`

---

### Phase 4: Base schema, migrations and seeds

#### T18: Define identity schema

**What**: Drizzle tables `users`, `sessions`, `authTokens`, `userTotp`, `consents`, `rateLimitBuckets` exactly as `docs/architecture.md` §5.2 (checks, unique and partial indexes).
**Where**: `apps/api/src/db/schema/identity.ts`
**Depends on**: T15
**Reuses**: §5.2 DDL
**Requirement**: FND-36

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every column, check and index of the six tables in §5.2 is declared
- [ ] Money/instant/date conventions hold (no `timestamp without time zone`)
- [ ] Gate check passes: `npm run typecheck && npm run lint`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): define identity tables schema`

---

#### T19: Define rooms and calendar schema

**What**: Drizzle tables `rooms`, `roomPhotos`, `settings`, `businessHours`, `holidays`, `closedDays`, `blockRecurrences`, `blocks`, `roomOccupancy` (`tstzrange` customType) per §5.2.
**Where**: `apps/api/src/db/schema/calendar.ts`
**Depends on**: T15
**Reuses**: §5.2 DDL
**Requirement**: FND-36

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every column/check/index Drizzle can express is declared; the exclusion constraint, period shape check, gist index and `closed_days_uq` are left to T21's custom migration (comment points there)
- [ ] Gate check passes: `npm run typecheck && npm run lint`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): define rooms and calendar tables schema`

---

#### T20: Define platform schema

**What**: Drizzle tables `auditLog`, `emailOutbox`, `integrationSettings` per §5.2 plus `schema/index.ts` barrel exporting all base tables.
**Where**: `apps/api/src/db/schema/platform.ts`
**Depends on**: T15
**Reuses**: §5.2 DDL
**Requirement**: FND-36

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Columns, checks and indexes of the three tables declared; `schema/index.ts` exports identity, calendar and platform
- [ ] Gate check passes: `npm run typecheck && npm run lint`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): define audit, outbox and integration settings schema`

---

#### T21: Generate base migrations

**What**: `drizzle.config.ts` (schema `src/db/schema/index.ts`, out `drizzle`, dialect postgresql); run `drizzle-kit generate --name=base` and `drizzle-kit generate --custom --name=base_constraints`, then write the custom SQL of design.md §Data Models.
**Where**: `apps/api/drizzle/0001_base_constraints.sql` (+ generated `0000_base.sql`, `meta/`)
**Depends on**: T18, T19, T20
**Reuses**: design.md custom migration SQL
**Requirement**: FND-30, FND-31, FND-32..35 (verified in T22, merge-forward)

**Tools**:

- MCP: NONE
- Skill: `neon-postgres`

**Done when**:

- [ ] `drizzle/meta/_journal.json` lists `0000_base` then `0001_base_constraints`
- [ ] Running `drizzle-kit generate` again reports no schema changes
- [ ] Gate check passes: `npm run typecheck && npm run lint`

**Tests**: none
**Gate**: build

**Commit**: `feat(api): add base migrations with occupancy exclusion constraint`

---

#### T22: Add migration runner and integration test harness

**What**: `src/db/migrate.ts` (`runMigrations(url)`, CLI using `DATABASE_URL_UNPOOLED ?? DATABASE_URL`; root/api script `db:migrate`), `test/global-setup.ts` (requires `DATABASE_URL_TEST`, refuses when it equals `DATABASE_URL` from `.env` or contains `NEON_BRANCH_PRODUCTION`, runs migrations once), `test/setup.ts` (truncate all `public` tables before each test), `test/factories.ts` (`createUser`, `loginAs`, `currentTotp` stubs filled as later tasks need them), and `src/db/migrations.int.test.ts`.
**Where**: `apps/api/src/db/migrate.ts` (+ `apps/api/test/`)
**Depends on**: T21
**Reuses**: drizzle `migrate()`
**Requirement**: FND-30, FND-31, FND-32, FND-33, FND-34, FND-35

**Tools**:

- MCP: NONE
- Skill: `neon-postgres`

**Done when**:

- [ ] Test asserts all 18 base tables exist (`information_schema.tables`) and `pg_extension` has `btree_gist`
- [ ] Test runs `runMigrations` a second time and asserts the drizzle migrations table row count is unchanged
- [ ] Test inserts two active overlapping occupancy rows for one room and asserts the second fails with `code === '23P01'`
- [ ] Tests assert `[09:00,11:30)` + `[11:30,12:30)` both insert; an overlap with an `active = false` row inserts; overlapping rows in different rooms insert
- [ ] Tests assert `UPDATE audit_log ...` and `DELETE FROM consents ...` raise errors containing `append_only_table`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 8 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add migration runner and db integration harness`

---

#### T23: Add idempotent seed script with admin bootstrap

**What**: `runSeed(db, opts)` inserting settings defaults (`settingDefaults()`), 8 `business_hours` rows, 3 rooms (design.md §Room seed), 28 holidays (`holidaySeed`), and optional admin bootstrap (password policy check, scrypt hash, verified e-mail, audit `user.bootstrap_admin` origin `system`); all with `ON CONFLICT DO NOTHING`; CLI `tsx src/db/seed.ts` reading `ADMIN_BOOTSTRAP_*`; script `db:seed`. The scrypt hash uses `lib/crypto.ts` if present, else a local implementation moved to `lib/crypto.ts` in T24.
**Where**: `apps/api/src/db/seed.ts`
**Depends on**: T22, T9, T10
**Reuses**: `settingDefaults` (T9), `holidaySeed` (T10)
**Requirement**: FND-20, FND-37, FND-38, FND-39, FND-40, FND-41, FND-42

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts `settings` row count equals the catalog key count and `payment.deposit_percent` value is `50`
- [ ] Test asserts the 3 rooms (slug, name, ideal_for, active, order) and 8 business-hours rows (mon–fri 420–1440, sat/sun/holiday 540–1440)
- [ ] Test asserts 28 holidays, all `is_closed = false`, only 2027-08-15 `needs_review`
- [ ] Test edits a setting and a room name, reruns the seed, and asserts no duplicates and the edits survive
- [ ] Test with bootstrap env and no admin asserts one admin with `email_verified_at` set and an `audit_log` row `user.bootstrap_admin`; rerun with a different bootstrap e-mail creates no second admin
- [ ] Test with bootstrap password "abc" asserts the error "ADMIN_BOOTSTRAP_PASSWORD does not meet the password policy" and no user
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add idempotent seeds and admin bootstrap`

---

### Phase 5: Security and platform services

#### T24: Implement crypto library

**What**: `hashPassword`, `verifyPassword`, `randomToken`, `sha256Hex`, `encryptSecret`, `decryptSecret` per design §Security libraries (seed switches to this module if T23 used a local copy).
**Where**: `apps/api/src/lib/crypto.ts`
**Depends on**: T12
**Reuses**: `node:crypto`
**Requirement**: FND-51, FND-70

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert `verifyPassword(pw, await hashPassword(pw))` is true, false for another password, and the hash starts with `scrypt$16384$8$1$`
- [ ] Tests assert two hashes of the same password differ (salt)
- [ ] Tests assert `decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP', key), key)` round-trips, ciphertext ≠ plaintext, and a tampered ciphertext throws
- [ ] Tests assert `sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'` and `randomToken()` is 43 base64url chars
- [ ] Gate check passes: `npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add password hashing, token and secret encryption helpers`

---

#### T25: Implement audit helper [P]

**What**: `audit(tx, ctx, input)` writing `audit_log` with actor, role, origin, action, entity, justification, before/after (redacted with `redact`), IP, requestId; `RequestContext` type and `originFromPath(path)` (`/admin` → admin, `/app` → app, `/public` → web).
**Where**: `apps/api/src/lib/audit.ts`
**Depends on**: T22
**Reuses**: `redact` (T13)
**Requirement**: FND-75

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts a committed transaction leaves one row with every field equal to the input (actor id, role, origin, action, entity type/id, justification, before, after, ip, request id)
- [ ] Test asserts a rolled-back transaction leaves zero rows
- [ ] Test asserts `before: { password_hash: 'x' }` is stored redacted
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 3 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add transactional audit log helper`

---

#### T26: Implement e-mail outbox and auth templates [P]

**What**: `queueEmail`, `dispatchEmails` (Resend REST, 10 s timeout, statuses `sent`/`not_sent`/`failed`) and pt-BR templates `verifyEmailTemplate`, `passwordResetTemplate` with a shared layout.
**Where**: `apps/api/src/lib/email.ts` (+ `apps/api/src/emails/templates/`)
**Depends on**: T22
**Reuses**: `email_outbox` table
**Requirement**: FND-77, FND-78, FND-79, FND-80

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts `queueEmail` inside a transaction writes a `pending` row with to/template/subject/html/text, and a rolled-back transaction writes none
- [ ] Test with `RESEND_API_KEY` and stubbed `fetch` returning `{ id: 'em_1' }` asserts status `sent`, `provider_message_id = 'em_1'`, and the request had `Authorization: Bearer <key>` and the outbox subject
- [ ] Test without the key asserts status `not_sent` and `fetch` not called
- [ ] Tests with `fetch` rejecting and with a 500 response assert status `failed`, `attempts = 1`, non-empty `last_error`, and that `dispatchEmails` resolves (does not throw)
- [ ] Test asserts the verify template subject "Confirme seu e-mail na Bravô Clinic" and that html contains the link
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add transactional email outbox with resend dispatch`

---

#### T27: Implement session service

**What**: JWT issue/verify (`jose`, HS256, `SESSION_SECRET`), `sessions` rows, lifetimes (tenant 2592000 s, staff 43200 s), `resolveSession`, `markSessionMfaVerified`, `revokeSession`, `revokeAllSessions`, cookie helpers (`bravo_session`, HttpOnly, Secure, SameSite=Lax, Path=/).
**Where**: `apps/api/src/auth/session.ts`
**Depends on**: T24
**Reuses**: `withTransaction` (T15)
**Requirement**: FND-52 (cookie), FND-56, FND-58

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts a tenant session cookie string contains `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`; staff → `Max-Age=43200` and `expires_at` ≈ now + 12h
- [ ] Tests assert `resolveSession` returns null for a token signed with another secret, an expired `exp`, a revoked session row, and a session row past `expires_at`
- [ ] Test asserts `revokeAllSessions` revokes every active session of the user only
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add revocable jwt session service`

---

#### T28: Implement auth middleware chain

**What**: `requireAuth` (401 `UNAUTHENTICATED`), `requireStaff` (403 `FORBIDDEN` for tenant, 403 `MFA_ENROLLMENT_REQUIRED` without confirmed TOTP, 403 `MFA_REQUIRED` when session not MFA-verified), `requireRole('admin')`; mount on `/app/*` and `/admin/*` in `createApp`; role read from the user row (demotion takes effect immediately).
**Where**: `apps/api/src/middleware/auth.ts`
**Depends on**: T27
**Reuses**: `resolveSession` (T27)
**Requirement**: FND-56, FND-63, FND-66 (guard half), FND-71, FND-72, FND-73

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (test-only routes `/app/ping`, `/admin/ping`, `/admin/admin-only` registered in a test app) assert: no cookie → 401; tenant on `/admin/ping` → 403 `FORBIDDEN`; staff without TOTP → 403 `MFA_ENROLLMENT_REQUIRED`; staff with TOTP but unverified session → 403 `MFA_REQUIRED`; verified reception on `/admin/admin-only` → 403 `FORBIDDEN`; verified admin → 200
- [ ] Test demotes a logged-in admin to tenant in the DB and asserts the next `/admin/ping` → 403
- [ ] Test asserts a revoked session → 401 `UNAUTHENTICATED`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 8 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add auth, staff mfa and role guards`

---

#### T29: Implement CSRF origin check [P]

**What**: `csrf(appBaseUrl)` on POST/PUT/PATCH/DELETE under `/app/*` and `/admin/*`: `Origin` (or `Referer` origin) must equal `new URL(APP_BASE_URL).origin`, else 403 `CSRF_REJECTED`; requests without both headers are rejected; mounted in `createApp`.
**Where**: `apps/api/src/middleware/csrf.ts`
**Depends on**: T14
**Reuses**: `AppError`
**Requirement**: FND-59

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert POST `/app/x` with `Origin: https://evil.example` → 403 `CSRF_REJECTED`; with the app origin → passes to the next handler; without Origin but with matching Referer → passes; with neither → 403
- [ ] Tests assert GET `/app/x` with a foreign Origin is not blocked and POST `/public/x` is not checked
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add origin-based csrf protection`

---

#### T30: Implement database-backed rate limiter [P]

**What**: `consumeRateLimit` and `peekRateLimit` over `rate_limit_buckets` (fixed windows, `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`), returning `retryAfterSeconds` to the window end; helper `rateLimitKey(kind, raw)` hashing raw identifiers with `sha256Hex`.
**Where**: `apps/api/src/middleware/rate-limit.ts`
**Depends on**: T22
**Reuses**: `sha256Hex` (T24 if done, else `node:crypto` directly)
**Requirement**: FND-54 (mechanism), FND-50 (mechanism), FND-69 (mechanism)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts limit 5 / 900 s: calls 1–5 `allowed: true`, call 6 `allowed: false` with `0 < retryAfterSeconds ≤ 900`
- [ ] Test asserts a new window (injected `now` + 900 s) allows again, and different keys are independent
- [ ] Test runs 10 concurrent `consumeRateLimit` calls with limit 5 and asserts exactly 5 allowed
- [ ] Test asserts stored keys contain no raw e-mail
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 4 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add postgres fixed-window rate limiter`

---

### Phase 6: Auth endpoints

#### T31: Implement signup endpoint [P]

**What**: `modules/auth/signup.service.ts` + `POST /public/auth/signup`: validate `signupSchema`, create tenant (lower-cased e-mail, document digits/type, scrypt hash), consents `terms` + `privacy` (versions `terms-2026-10`, `privacy-2026-10`, IP, user agent), verification token (24 h, hash stored), `auth.verify_email` outbox row, session cookie; map unique violations to 409 `EMAIL_TAKEN` / `DOCUMENT_TAKEN`; dispatch e-mail after commit.
**Where**: `apps/api/src/routes/public/auth/signup.ts` (+ `apps/api/src/modules/auth/signup.service.ts`)
**Depends on**: T25, T26, T27, T29, T8
**Reuses**: `signupSchema` (T8), `queueEmail` (T26), `issueSession` (T27)
**Requirement**: FND-43, FND-44, FND-45, FND-46, FND-47

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts 201 body has `user.email`, `user.role === 'tenant'`, no `passwordHash`; DB row has hash prefix `scrypt$`; `Set-Cookie` contains `bravo_session=`; two `consents` rows (terms, privacy) with version and IP; one `auth_tokens` row `email_verify` whose `token_hash` is 64 hex chars; one `email_outbox` row template `auth.verify_email` whose html contains `/verificar-email?token=` with a token that hashes to the stored hash
- [ ] Test asserts invalid document → 422 with detail `{ path: 'document', message: 'CPF ou CNPJ inválido' }`
- [ ] Tests assert duplicate e-mail with different case → 409 `EMAIL_TAKEN`; duplicate document → 409 `DOCUMENT_TAKEN`; `acceptTerms: false` → 422 and zero users
- [ ] Test fires two concurrent signups with the same e-mail and asserts one 201 and one 409
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add tenant signup with consents and verification email`

---

#### T32: Implement login, logout and me endpoints

**What**: `modules/auth/login.service.ts` + routes `POST /public/auth/login` (lockout via `peekRateLimit`/`consumeRateLimit` on failures: 5 per e-mail per 15 min, 30 per IP per 15 min; staff with confirmed TOTP → `{ mfaRequired: true }` and unverified session; staff login audited `auth.login_staff`; `last_login_at`), `POST /app/auth/logout`, `GET /app/me`.
**Where**: `apps/api/src/routes/public/auth/login.ts` (+ `apps/api/src/routes/app/me.ts`, `apps/api/src/modules/auth/login.service.ts`)
**Depends on**: T28, T30
**Reuses**: `verifyPassword`, `issueSession`, `revokeSession`
**Requirement**: FND-52, FND-53, FND-54, FND-55, FND-57, FND-66 (login half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts tenant login → 200 `{ user, mfaRequired: false }`, a `sessions` row, cookie with `Max-Age=2592000`
- [ ] Tests assert wrong password and unknown e-mail both → 401 `INVALID_CREDENTIALS` with message "E-mail ou senha incorretos"
- [ ] Test asserts 5 wrong passwords then the correct one → 429 `TOO_MANY_ATTEMPTS` with a numeric `Retry-After`
- [ ] Test asserts logout → 204, cookie `Max-Age=0`, session `revoked_at` set, and reusing the old cookie on `/app/me` → 401
- [ ] Test asserts `/app/me` body keys exactly `id, name, email, role, emailVerified, docType, mfa` and `mfa` = `{ enrolled: false, verified: false }` for a tenant
- [ ] Test asserts staff with confirmed TOTP → 200 `{ mfaRequired: true }` and an audit row `auth.login_staff`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 7 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add login with lockout, logout and me endpoints`

---

#### T33: Implement e-mail verification endpoints [P]

**What**: `modules/auth/email-verification.service.ts` + `POST /public/auth/verify-email` and `POST /app/auth/verify-email/resend` (3 per user per hour; already verified → 409 `CONFLICT`).
**Where**: `apps/api/src/routes/public/auth/verify-email.ts` (+ `apps/api/src/modules/auth/email-verification.service.ts`)
**Depends on**: T26, T28, T30
**Reuses**: token helpers (T24), `queueEmail`
**Requirement**: FND-48, FND-49, FND-50

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts a valid token → 200 `{ verified: true }`, `email_verified_at` set, token `used_at` set
- [ ] Tests assert the same token again → 400 `INVALID_TOKEN`; unknown token → 400; token created 24h + 1 min ago (injected `now`) → 400
- [ ] Test asserts resend → 202 and a new outbox row; the 4th resend within an hour → 429
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add email verification and resend endpoints`

---

#### T34: Implement password reset endpoints [P]

**What**: `modules/auth/password-reset.service.ts` + `POST /public/auth/password-reset/request` (always 202; 5 per e-mail per hour silently capped; token 60 min) and `/confirm` (policy check, update hash, revoke all sessions, mark token used, audit `auth.password_reset`).
**Where**: `apps/api/src/routes/public/auth/password-reset.ts` (+ `apps/api/src/modules/auth/password-reset.service.ts`)
**Depends on**: T25, T26, T27
**Reuses**: `revokeAllSessions` (T27), `passwordResetConfirmSchema` (T8)
**Requirement**: FND-60, FND-61, FND-62

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert request for an unknown e-mail → 202 and no outbox row; for a known e-mail → 202 and one `auth.password_reset` row
- [ ] Test asserts confirm with a valid token → 200; login with the new password works; an older session cookie → 401; audit row `auth.password_reset`
- [ ] Tests assert reused token, unknown token and token older than 60 min → 400 `INVALID_TOKEN` and the hash unchanged
- [ ] Test asserts confirm with password "abc" → 422
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 6 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add password reset request and confirm endpoints`

---

#### T35: Implement staff TOTP endpoints

**What**: `auth/totp.ts` (secret, otpauth URI, verify with window 1 and replay check, recovery codes) + `modules/auth/totp.service.ts` + routes `POST /app/auth/totp/enroll` (staff only), `/confirm`, `/verify` (5 failures per user per 15 min → 429); audit `auth.totp_enabled`.
**Where**: `apps/api/src/routes/app/auth/totp.ts` (+ `apps/api/src/auth/totp.ts`, `apps/api/src/modules/auth/totp.service.ts`)
**Depends on**: T32
**Reuses**: `encryptSecret` (T24), `markSessionMfaVerified` (T27), `consumeRateLimit` (T30)
**Requirement**: FND-64, FND-65, FND-66, FND-67, FND-68, FND-69, FND-70

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts enroll → 200 `otpauthUri` starting `otpauth://totp/Bravô%20Clinic:` (or the encoded issuer) with `issuer=` param; DB stores ciphertext that is not the base32 secret
- [ ] Test asserts confirm with the current code (computed by `otpauth` from the URI) → 200 with 10 unique recovery codes; `confirmed_at` set; session MFA-verified (`/admin/session` reachable); audit row `auth.totp_enabled`; DB stores 10 hashes, not the codes
- [ ] Test asserts login → `mfaRequired: true`, `/admin/session` → 403 `MFA_REQUIRED`, verify with valid code → 200, then `/admin/session` → 200
- [ ] Tests assert reusing the same code on a new session → 401 `INVALID_CODE`; a recovery code works once and fails the second time; "123 456"-style spacing is accepted
- [ ] Test asserts 5 wrong codes then a valid one → 429
- [ ] Test asserts a tenant calling enroll → 403 `FORBIDDEN`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 9 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add staff totp enrollment and verification`

---

#### T36: Implement admin session and public config endpoints [P]

**What**: `GET /admin/session` → `{ role, sections: adminSectionsFor(role) }`; `GET /public/config` → `{ googleEnabled, whatsappE164 (setting clinic.whatsapp_e164), environment }`.
**Where**: `apps/api/src/routes/admin/session.ts` (+ `apps/api/src/routes/public/config.ts`)
**Depends on**: T28, T11, T23
**Reuses**: `adminSectionsFor` (T11)
**Requirement**: FND-74, FND-76

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert verified admin → sections in the 10-item order; verified reception → `['reservas','clientes']`
- [ ] Tests assert `/public/config` → `googleEnabled: false` without Google env and `true` with both vars; `environment: 'production'` when `NEON_BRANCH=production`, else `'development'`; `whatsappE164` equals the seeded setting value
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add admin session and public config endpoints`

---

#### T37: Implement Google OAuth login gated by env

**What**: `auth/google.ts` (authorization URL with state + PKCE S256, code exchange, ID token verification with `jose` `createRemoteJWKSet`, injectable endpoints/fetch for tests) + `modules/auth/google.service.ts` + routes `GET /public/auth/google/start` and `/callback` (state cookie 10 min, HttpOnly; link by `google_sub` or verified e-mail; create tenant without document; redirects); 404 `FEATURE_DISABLED` when not configured.
**Where**: `apps/api/src/routes/public/auth/google.ts` (+ `apps/api/src/auth/google.ts`, `apps/api/src/modules/auth/google.service.ts`)
**Depends on**: T32
**Reuses**: `issueSession`
**Requirement**: FND-131, FND-132, FND-133, FND-134

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test without Google env asserts `/public/auth/google/start` → 404 `FEATURE_DISABLED`
- [ ] Test with env asserts 302 `Location` on `accounts.google.com` containing `state`, `code_challenge_method=S256`, `scope=openid%20email%20profile`, and a state cookie with `HttpOnly` and `Max-Age=600`
- [ ] Tests with stubbed token endpoint and a locally generated JWKS assert: new Google user → tenant with `email_verified_at`, `google_sub`, no document, redirect `/app/perfil?completar=1`; existing user with same verified e-mail → linked, redirect `/app`
- [ ] Test asserts mismatched state → 400 `INVALID_STATE` and no `Set-Cookie: bravo_session`
- [ ] Gate check passes: `npm run typecheck && npm test -w apps/api`
- [ ] Test count: ≥ 5 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(api): add optional google oauth login with pkce`

---

### Phase 7: Web scaffold and design tokens

#### T38: Scaffold @bravo/web with Vite, React and Tailwind

**What**: `apps/web/package.json` (react 18.3, react-dom, react-router-dom 6.30, @tanstack/react-query 5, react-hook-form, @hookform/resolvers, lucide-react, qrcode, @bravo/core; dev vite 7, @vitejs/plugin-react 5, tailwindcss 3.4, postcss, autoprefixer, vite-plugin-pwa 1, vitest 3.2, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom), `vite.config.ts` (React plugin, `/api` proxy to `http://localhost:8787` stripping `/api`, Vitest jsdom env + setup file), `postcss.config.js`, `index.html` (lang pt-BR, root div), `src/main.tsx`, `src/styles/index.css` (`@tailwind base/components/utilities`), scripts `dev`, `build` (`vite build`), `preview`, `test`, `typecheck`.
**Where**: `apps/web/`
**Depends on**: T4
**Reuses**: `docs/architecture.md` §2, §9
**Requirement**: FND-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm run build -w apps/web` produces `apps/web/dist/index.html`
- [ ] `npm run dev -w apps/web` serves the app on 5173 and `/api/health` reaches the local API (manual check with T17 running)
- [x] Gate check passes: `npm run typecheck && npm run lint && npm test && npm run build -w apps/web`

**Tests**: none
**Gate**: build

**Commit**: `chore(web): scaffold vite react tailwind app`

---

#### T39: Map design tokens into the Tailwind config

**What**: `tailwind.config.ts` with every DESIGN.md color as `rgb(var(--c-<key>) / <alpha-value>)`, typography `fontSize`/`fontFamily` keys, spacing, radius (reference scale + semantic aliases), shadows `glow`/`raised` via CSS vars, `darkMode: ['selector', '[data-theme="night"]']`, content globs; `theme.extend` keeps Tailwind defaults (except `borderRadius`, which copies the reference values).
**Where**: `apps/web/tailwind.config.ts`
**Depends on**: T38
**Reuses**: `docs/design/DESIGN.md`, `docs/design/home-reference.html` config, `docs/architecture.md` §9.3
**Requirement**: FND-81, FND-85

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test parses the YAML front matter of `docs/design/DESIGN.md` (simple line parser, no new dependency) and asserts every color key exists in `theme.extend.colors` with value `rgb(var(--c-<key>) / <alpha-value>)`
- [x] Test asserts each typography token's `[size, { lineHeight, letterSpacing, fontWeight }]` equals DESIGN.md and font families map Josefin Sans / Jost as specified
- [x] Test asserts `borderRadius` DEFAULT `.125rem`, lg `.25rem`, xl `.5rem`, full `.75rem`, `control` 2px, `card` 8px, `feature` 20px, `pill` 9999px
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): map design system tokens into tailwind config`

---

#### T40: Define Day/Night CSS variables

**What**: `src/styles/tokens.css` with `:root, [data-theme="day"]` and `[data-theme="night"]` blocks holding RGB channels for every color token (architecture §9.3), `--shadow-glow`, `--shadow-raised`, `color-scheme`, and base `body` styles (`bg-surface text-on-surface font-body`); imported by `index.css`.
**Where**: `apps/web/src/styles/tokens.css`
**Depends on**: T39
**Reuses**: `docs/architecture.md` §9.3
**Requirement**: FND-82

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Test parses `tokens.css` and asserts, for every key in the §9.3 table, the Day block value and the Night block value (e.g. `--c-surface: 245 238 230` day / `29 20 14` night; `--c-bronze: 122 70 29` / `220 170 130`; `--c-champagne-soft: 239 220 205` / `74 53 38`)
- [x] Test asserts every color key referenced by `tailwind.config.ts` has a variable in both blocks (constants may repeat)
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add day and night css variable themes`

---

#### T41: Implement ThemeProvider, toggle and no-flash script

**What**: `ThemeProvider`/`useTheme` (reads `localStorage['bravo-theme']` safely, falls back to `matchMedia('(prefers-color-scheme: dark)')`, sets `document.documentElement.dataset.theme`), `ThemeToggle` button (aria-label "Alternar tema", icon Sun/Moon), and the inline script in `index.html` that applies the theme before paint.
**Where**: `apps/web/src/theme/ThemeProvider.tsx` (+ `apps/web/src/theme/ThemeToggle.tsx`)
**Depends on**: T40
**Reuses**: none
**Requirement**: FND-83, FND-84

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert clicking the toggle flips `data-theme` day→night→day and writes `localStorage['bravo-theme']`
- [x] Tests assert initial theme `night` when no stored value and `matchMedia` dark matches; `day` when it does not; stored value wins over the media query
- [x] Test with `localStorage.setItem` throwing asserts the toggle still switches without an error
- [x] Test asserts `index.html` contains the inline script reading `bravo-theme` before the module script
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add theme provider with persisted day/night toggle`

---

#### T42: Implement Icon, BrandLockup and EyebrowLockup

**What**: `Icon` (lucide wrapper, strokeWidth 1.5, aria rules), `BrandLockup` (header/footer variants per reference), `EyebrowLockup` (`— SALAS INTELIGENTES —` with hairline rules), `Eyebrow`.
**Where**: `apps/web/src/components/ui/Icon.tsx` (+ `apps/web/src/components/ui/Brand.tsx`)
**Depends on**: T39
**Reuses**: reference header/footer lockup classes
**Requirement**: FND-86

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert `<Icon as={MapPin} />` renders an svg with `stroke-width="1.5"` and `aria-hidden="true"`; with `label="Local"` it has `role="img"` and `aria-label="Local"`
- [x] Tests assert BrandLockup renders "BRAVÔ CLINIC" and "SALAS INTELIGENTES"; EyebrowLockup renders the text between two `hr`/decorative rules with `aria-hidden`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add icon wrapper and brand lockups`

---

### Phase 8: Base UI components

#### T43: Implement Button

**What**: `Button` with variants primary/secondary/ghost/link, sizes md (h-12)/sm (h-10), `loading`, icons, `asChild` (render a router `Link`/`a`), focus ring utility.
**Where**: `apps/web/src/components/ui/Button.tsx`
**Depends on**: T42
**Reuses**: DESIGN.md Buttons; tokens
**Requirement**: FND-87, FND-92

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tests assert primary has classes `bg-bronze`, `text-on-bronze`, `h-12`, `rounded-control`; secondary `bg-surface-raised`, `border`, `border-border`, `text-ink`; ghost `bg-transparent`
- [x] Test asserts `loading` → `disabled` and `aria-busy="true"` and click handler not called
- [x] Test asserts focus-visible classes `focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2`
- [x] Gate check passes: `npm test -w apps/web`
- [x] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add button component`

---

#### T44: Implement form field components [P]

**What**: `Field`, `Label`, `HelpText`, `FieldError`, `Input`, `Select`, `Textarea`, `Checkbox`, `PasswordInput`, `DocumentInput`, `PhoneInput` (DESIGN.md form styles, focus ring, aria wiring).
**Where**: `apps/web/src/components/ui/form/`
**Depends on**: T42
**Reuses**: `formatDocument` (T7) for masking
**Requirement**: FND-88, FND-92

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert `getByLabelText('E-mail')` finds the input (label bound by id); with `error="Obrigatório"` the input has `aria-invalid="true"` and `aria-describedby` equal to the error element id
- [ ] Tests assert DocumentInput typing "52998224725" shows "529.982.247-25" and 14 digits show the CNPJ mask; PhoneInput shows "(47) 99999-0000"
- [ ] Test asserts PasswordInput toggle switches `type` password↔text with an accessible label "Mostrar senha"
- [ ] Test asserts focus-visible ring classes on Input
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add accessible form field components`

---

#### T45: Implement Card and Badge

**What**: `Card` (raised/stone/walnut variants, `media` slot edge-to-edge square top) and `Badge` (champagne / neutral tones).
**Where**: `apps/web/src/components/ui/Card.tsx` (+ `apps/web/src/components/ui/Badge.tsx`)
**Depends on**: T42
**Reuses**: DESIGN.md Cards & badges
**Requirement**: FND-91

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert Card raised classes `bg-surface-raised border border-hairline rounded-card`; walnut `bg-walnut`
- [ ] Test asserts Badge classes `bg-champagne-soft text-on-champagne uppercase text-caption tracking-[0.08em]`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add card and badge components`

---

#### T46: Implement Modal

**What**: `Modal` rendered in a portal with overlay `bg-surface-night/60 backdrop-blur-sm`, panel `bg-surface-raised rounded-card shadow-raised`, title, close button (ghost Button + X icon, label "Fechar"), focus trap, Escape, focus restore, scroll lock.
**Where**: `apps/web/src/components/ui/Modal.tsx`
**Depends on**: T43
**Reuses**: Button (T43)
**Requirement**: FND-89, FND-92

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert open modal has `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → title, and focus is inside it
- [ ] Test asserts Tab from the last focusable element moves focus to the first (and Shift+Tab reverse)
- [ ] Test asserts Escape calls `onClose` and, after close, focus returns to the trigger button
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add accessible modal`

---

#### T47: Implement Tabs [P]

**What**: WAI-ARIA `Tabs` (controlled/uncontrolled, arrows/Home/End, bronze selected underline).
**Where**: `apps/web/src/components/ui/Tabs.tsx`
**Depends on**: T42
**Reuses**: tokens
**Requirement**: FND-90, FND-92

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert roles `tablist`, `tab` (with `aria-selected`, `aria-controls`), `tabpanel` (with `aria-labelledby`)
- [ ] Tests assert ArrowRight selects the next tab and shows its panel, ArrowLeft from the first wraps to the last, Home/End jump
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add keyboard accessible tabs`

---

#### T48: Implement Toast, Alert, Spinner and ComingSoon

**What**: `ToastProvider` + `useToast` (role status, aria-live polite, 6 s auto-dismiss unless it has an action), `Alert` (info/error/success), `Spinner`, `ComingSoon({ title })` (heading + "Em construção").
**Where**: `apps/web/src/components/ui/Toast.tsx` (+ `apps/web/src/components/ui/Feedback.tsx`)
**Depends on**: T43
**Reuses**: Button (T43)
**Requirement**: FND-93, FND-117 (ComingSoon)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (fake timers) assert a toast has `role="status"` and `aria-live="polite"`, disappears after 6000 ms, and a toast with an action stays after 6000 ms and runs the action on click
- [ ] Tests assert Alert error has `role="alert"`; ComingSoon renders its title and "Em construção"
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add toast, alert and placeholder feedback components`

---

#### T49: Implement RoomCard

**What**: `RoomCard` porting the reference room card markup (image h-64 with bronze name chip and feature chip, tags as Badges, heading, description, CircleCheck equipment list, "A partir de" band with `formatBRL` + "/h", "Reservar Sala" button calling `onReserve`), placeholder image `/room-placeholder.webp` when `imageUrl` is absent (add the asset).
**Where**: `apps/web/src/components/ui/RoomCard.tsx`
**Depends on**: T43, T45
**Reuses**: reference `#salas` card markup; `formatBRL` (T5)
**Requirement**: FND-94

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert name heading, chips, tags, description, one list item per equipment entry, text "A partir de" and "R$ 80,00" with "/h" for `fromPriceCents = 8000`
- [ ] Test asserts the img `src` is `/room-placeholder.webp` when `imageUrl` is undefined and alt text is non-empty
- [ ] Test asserts clicking "Reservar Sala" calls `onReserve` once
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add room card component`

---

### Phase 9: Data layer and public layout

#### T50: Implement API client, query client and base hooks

**What**: `lib/api.ts` (`api.*`, `ApiError`, network error `code: 'NETWORK'`, `Idempotency-Key` option), `lib/query-client.ts`, `features/auth/useSession.ts` (`['session']` → `/api/app/me`, 401 → null), `features/config/useClinicConfig.ts` (with fallback), providers wired in `main.tsx`.
**Where**: `apps/web/src/lib/api.ts` (+ `apps/web/src/lib/query-client.ts`, `apps/web/src/features/auth/useSession.ts`, `apps/web/src/features/config/useClinicConfig.ts`)
**Depends on**: T38
**Reuses**: error envelope (architecture §6.2)
**Requirement**: FND-95 (session-aware header), FND-98 (config), FND-106..113 (client used by pages)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (fetch stubbed) assert `api.post('/x', body)` sends JSON with `credentials: 'same-origin'` and `Content-Type: application/json`; a 422 envelope throws `ApiError` with `status 422`, `code 'VALIDATION_FAILED'`, `details`; a rejected fetch throws `code 'NETWORK'`
- [ ] Tests assert `useSession` returns `null` on 401 and the user on 200
- [ ] Test asserts `useClinicConfig` returns the fallback `{ googleEnabled: false, whatsappE164: '' }` while loading and on error
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add api client, query client and session hooks`

---

#### T51: Implement Header

**What**: Reference header port (fixed, h-20, `bg-surface/90 backdrop-blur-xl`, BrandLockup, MapPin location ≥ xl, nav ≥ lg with router links, Login button ↔ "Minha conta" when `useSession` has a user, ThemeToggle), plus mobile menu button (< lg) opening a panel with the same links.
**Where**: `apps/web/src/components/layout/Header.tsx`
**Depends on**: T50
**Reuses**: reference `<header>` markup; Button, Icon, ThemeToggle
**Requirement**: FND-95, FND-96

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert nav links Salas `/salas`, Estrutura `/#estrutura`, Preços & Planos `/precos`, Serviços Extras `/servicos-extras`, Contato `/contato`, and text "Praia Brava - Itajaí"
- [ ] Tests assert "Login" links to `/login` without session and "Minha conta" links to `/app` with a session
- [ ] Test asserts the menu button toggles `aria-expanded` false→true and reveals the links
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add public header with mobile menu`

---

#### T52: Implement Footer [P]

**What**: Reference footer port with corrected address and hours (design.md §Home content corrections), links mapped to routes (`/salas`, `/#estrutura`, `/precos`, `/servicos-extras`, `/politicas`, `/privacidade`, `/termos`, `/login`, `/contato`), e-mail from config when present.
**Where**: `apps/web/src/components/layout/Footer.tsx`
**Depends on**: T42
**Reuses**: reference `<footer>` markup
**Requirement**: FND-97

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert headings Navegação, Diretrizes, Atendimento; text "Praia Brava, Itajaí – SC" and "Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00"; no "São Paulo"/"Jardins"
- [ ] Test asserts the copyright text "© 2026 Bravô Clinic • Salas Inteligentes. Todos os direitos reservados. Saúde • Beleza • Bem-estar."
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add public footer`

---

#### T53: Implement WhatsApp floating button

**What**: `WhatsAppButton` (fixed `bottom-6 right-6 z-50`, bronze pill, MessageCircle icon, label "Concierge WhatsApp" `hidden sm:inline-block`, href from `useClinicConfig().whatsappE164` digits or `https://wa.me/`, `title` "Falar no WhatsApp da Bravô Clinic").
**Where**: `apps/web/src/components/layout/WhatsAppButton.tsx`
**Depends on**: T50
**Reuses**: reference floating button markup
**Requirement**: FND-98

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert href `https://wa.me/5547999990000` for config `+5547999990000` and `https://wa.me/` for `''`; `target="_blank"`, `rel="noopener noreferrer"`
- [ ] Test asserts classes `fixed bottom-6 right-6` and the label element has `hidden sm:inline-block`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add floating whatsapp button`

---

#### T54: Implement PublicLayout and NotFound page

**What**: `PublicLayout` (Header, `<main class="w-full pt-20 bg-surface">` with `<Outlet/>`, Footer, WhatsAppButton, scroll-to-hash on navigation) and `NotFoundPage` ("Página não encontrada" + link to `/`).
**Where**: `apps/web/src/components/layout/PublicLayout.tsx` (+ `apps/web/src/pages/public/NotFoundPage.tsx`)
**Depends on**: T51, T52, T53
**Reuses**: Header, Footer, WhatsAppButton
**Requirement**: FND-98 (every public page), FND-105

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test renders a memory router with the layout and an unknown path and asserts header, footer, WhatsApp link and "Página não encontrada" with a link to `/`
- [ ] Test asserts the WhatsApp link is present on two different child routes
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- [ ] Test count: ≥ 2 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add public layout and not found page`

---

### Phase 10: Home page

#### T55: Port Hero section with quick booking widget [P]

**What**: Reference hero port (gradient, glow, "SALAS INTELIGENTES SOB DEMANDA" pill, h1 "Saúde, beleza e bem-estar em um só lugar.", corrected lead, two CTAs, widget with room select/date/modalidade incl. "Turno Completo (5h)", "Verificar Horários", three info badges) using `display-xl-mobile md:display-xl`; controlled `selectedRoom`, `onCheck` scrolls to `#simulador`.
**Where**: `apps/web/src/pages/public/home/HeroSection.tsx`
**Depends on**: T49
**Reuses**: reference hero markup; Icon mapping §9.4
**Requirement**: FND-99, FND-101, FND-103

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert the h1 text, the lead containing "Praia Brava", the option "Turno Completo (5h)", buttons "Simular e Reservar" (href `#simulador`) and "Conhecer as Salas" (href `#salas`)
- [ ] Test asserts changing the room select calls `onRoomChange('secundaria')` and clicking "Verificar Horários" calls `onCheck`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home hero section with quick booking widget`

---

#### T56: Port Arquitetura section [P]

**What**: Reference "ARQUITETURA HOSPITALAR SENSORIAL" section with `id="estrutura"`, stats (100% RDC Anvisa; "07h-00h" + "Abertos todos os dias, inclusive feriados"), two images (reference URLs replaced by local `/images/recepcao.webp`, `/images/consultorio.webp` placeholders shipped in `public/`), feature cards with Flower2 and Video icons.
**Where**: `apps/web/src/pages/public/home/ArchitectureSection.tsx`
**Depends on**: T42
**Reuses**: reference section markup
**Requirement**: FND-99, FND-101

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert the section `id="estrutura"`, heading "A extensão natural da sua autoridade clínica.", the corrected stat caption, image alts without "Jardins"/"Sao Paulo"
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 2 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home architecture section`

---

#### T57: Port Salas section with static room data [P]

**What**: `RoomsSection` (`id="salas"`, eyebrow "ESPAÇOS SOB DEMANDA", heading, unified-tariff pill, 3 `RoomCard`s from `features/home/rooms.static.ts` with the reference texts, tags and equipment, `fromPriceCents` 8000, local placeholder images) calling `onReserve(slug)`.
**Where**: `apps/web/src/pages/public/home/RoomsSection.tsx` (+ `apps/web/src/features/home/rooms.static.ts`)
**Depends on**: T49
**Reuses**: RoomCard (T49)
**Requirement**: FND-99, FND-103

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert three cards titled Sala Principal, Sala Secundária, Sala Terceira, each with "R$ 80,00" and "Reservar Sala"
- [ ] Test asserts clicking the second card's button calls `onReserve('secundaria')`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 2 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home rooms section`

---

#### T58: Port pricing table and simulator section [P]

**What**: `PricingSimulatorSection` (`id="simulador"`): tariff table with corrected windows (07:00 às 19:00; 09:00 às 19:00; turno 5h), cleanup guarantee card, simulator (period toggle Dia Útil Comercial / Noite / Fim de Semana with `aria-pressed`, range 1–6 step 0.5, formula text, total, sinal 50%, saldo, "+30 min" note, CTA linking to `/reservar`) with logic in `features/home/simulator.ts` (`simulate(period, hours)` → cents + formula) formatted by `formatBRL`.
**Where**: `apps/web/src/pages/public/home/PricingSimulatorSection.tsx` (+ `apps/web/src/features/home/simulator.ts`)
**Depends on**: T43
**Reuses**: reference simulator markup and script logic; `formatBRL`, `percentOfCents`
**Requirement**: FND-99, FND-100

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Unit tests on `simulate`: ('util', 2) → total 16000, sinal 8000, saldo 8000; ('util', 1) → 9700; ('util', 1.5) → 14550 / 7275 / 7275; ('especial', 2) → 19800; ('especial', 1) → 12000
- [ ] Component tests assert default display "R$ 160,00", "R$ 80,00", "R$ 80,00" (whitespace-normalized); after selecting "Noite / Fim de Semana" → "R$ 198,00"; after moving the range to 1 → "R$ 120,00"
- [ ] Test asserts the table header "Dia Útil — Comercial (07:00 às 19:00)" and row "Turno completo comercial (5h)"
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home pricing table and simulator`

---

#### T59: Port Serviços extras section with WhatsApp quote modal [P]

**What**: `ExtrasSection` (3 cards with corrected chip "Disponível em qualquer sala" and marketing copy, Clapperboard/Film/Megaphone icons) and `QuoteModal` (Modal with name, WhatsApp, details fields; submit builds `https://wa.me/<digits>?text=` + `encodeURIComponent("Olá! Quero um orçamento de <serviço>.\nNome: <nome>\nWhatsApp: <tel>\nDetalhes: <detalhes>")`, opens it with `window.open(url, '_blank', 'noopener')`, closes).
**Where**: `apps/web/src/pages/public/home/ExtrasSection.tsx` (+ `apps/web/src/pages/public/home/QuoteModal.tsx`)
**Depends on**: T46, T50
**Reuses**: Modal (T46), form fields (T44), `useClinicConfig` (T50)
**Requirement**: FND-99, FND-101, FND-102

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert three service titles and the chip "Disponível em qualquer sala"; no "Jardins"
- [ ] Test clicks "Solicitar Orçamento" on Videomaker and asserts a dialog titled "Videomaker Dedicado"
- [ ] Test fills name and WhatsApp, submits, and asserts `window.open` called once with a URL starting `https://wa.me/` whose decoded `text` contains "Videomaker Dedicado" and the name, and that the dialog closed
- [ ] Test asserts submit with empty name shows a required error and does not call `window.open`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home extras section with whatsapp quote modal`

---

#### T60: Port Comodidade, Políticas and CTA sections [P]

**What**: `HomeStaticSections` exporting `AmenitiesSection` (4 cards, corrected address card), `PoliciesSection` (bronze left border card; Sinal de 50% with the non-refundable text; Saldo 48h Antes; Reagendamento Cortesia) and `LaunchCtaSection` ("PRÉ-LANÇAMENTO EXCLUSIVO", corrected lead, CTAs to `#simulador` and WhatsApp).
**Where**: `apps/web/src/pages/public/home/HomeStaticSections.tsx`
**Depends on**: T43
**Reuses**: reference markup
**Requirement**: FND-99, FND-101

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert headings "Estrutura completa para você focar no atendimento.", "Políticas de Reserva, Sinal e Cancelamento", "Pronto para elevar o padrão dos seus atendimentos?"
- [ ] Test asserts the policies text contains "não é reembolsável" and does not contain "é reembolsável em casos de desistência"
- [ ] Test asserts the CTA WhatsApp link uses the config number (fallback `https://wa.me/`)
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): port home amenities, policies and launch cta sections`

---

#### T61: Compose HomePage and mount the public routes

**What**: `HomePage` composing the sections in spec order, holding `selectedRoom` state (room card / hero check → set room + smooth scroll to `#simulador`), document title "Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí"; route `/` under PublicLayout in a minimal router (full router lands in T63).
**Where**: `apps/web/src/pages/public/home/HomePage.tsx`
**Depends on**: T55, T56, T57, T58, T59, T60, T54
**Reuses**: PublicLayout (T54)
**Requirement**: FND-99, FND-101, FND-103

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts section order by ids/headings: hero → `#estrutura` → `#salas` → `#simulador` → extras → comodidade → políticas → CTA
- [ ] Test asserts the rendered page text contains no "São Paulo", "Sao Paulo" or "Jardins"
- [ ] Test (scrollIntoView mocked) asserts clicking "Reservar Sala" on Sala Terceira sets the hero select to `terceira` and calls `scrollIntoView({ behavior: 'smooth' })` on `#simulador`
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): compose home page from reference sections`

---

### Phase 11: Routing, guards and auth pages

#### T62: Implement auth mutation hooks

**What**: `useLogin`, `useLogout`, `useSignup`, `useVerifyEmail`, `useResendVerification`, `useRequestPasswordReset`, `useConfirmPasswordReset`, `useTotpEnroll`, `useTotpConfirm`, `useTotpVerify` (update/invalidate `['session']`), and `safeNextPath`.
**Where**: `apps/web/src/features/auth/hooks.ts`
**Depends on**: T50
**Reuses**: `api` (T50)
**Requirement**: FND-106, FND-107, FND-118 (logout)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert `safeNextPath('/app/agenda') === '/app/agenda'` and `null` for `'//evil.com'`, `'https://evil.com'`, `'javascript:alert(1)'`, `'app'`, `null`
- [ ] Tests assert `useLogin` posts to `/api/public/auth/login` and sets `['session']`; `useLogout` posts to `/api/app/auth/logout` and sets `['session']` to null
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add auth mutation hooks and safe redirect helper`

---

#### T63: Implement router map and route guards

**What**: `router.tsx` with every route of `docs/architecture.md` §9.1 (public, `/app/*`, `/admin/*`; later-feature pages as `ComingSoon` placeholders; auth page modules created as stubs here and filled by T64–T68), guards `RequireAuth`, `RequireStaff`, `RequireSection`, `ForbiddenPage` ("Acesso restrito" + link `/app`), `/admin` index redirect to the first allowed section.
**Where**: `apps/web/src/router.tsx` (+ `apps/web/src/features/auth/guards.tsx`)
**Depends on**: T62
**Reuses**: `useSession` (T50), `adminSectionsFor` (T11), `ComingSoon` (T48)
**Requirement**: FND-114, FND-115, FND-116

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests (memory router, mocked session) assert: anonymous `/app/agenda` → location `/login?next=%2Fapp%2Fagenda`; anonymous `/admin/cupons` → `/login?next=%2Fadmin%2Fcupons`
- [ ] Test asserts tenant `/admin/financeiro` renders "Acesso restrito" with a link to `/app`
- [ ] Tests assert staff with `mfa.enrolled && !mfa.verified` → `/login/2fa`; `!mfa.enrolled` → `/login/2fa/configurar`
- [ ] Test asserts reception on `/admin/financeiro` renders "Acesso restrito" and `/admin` redirects reception to `/admin/reservas`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add route map with auth, staff and section guards`

---

#### T64: Implement Login page

**What**: `/login` form (Field + Input e-mail, PasswordInput, submit, links "Esqueci minha senha" and "Criar conta"), Google button only when `googleEnabled`, error mapping, `mfaRequired` → `/login/2fa?next=`, success → safe `next` or role default.
**Where**: `apps/web/src/pages/auth/LoginPage.tsx`
**Depends on**: T62, T63
**Reuses**: form components (T44), `useLogin`, `useClinicConfig`
**Requirement**: FND-106, FND-107, FND-134 (button hidden)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert a 401 response shows "E-mail ou senha incorretos"; a 429 shows "Muitas tentativas. Tente novamente em <n> minutos."
- [ ] Tests assert success navigates to `/app` for tenant, `/admin` for staff, and to `/app/agenda` with `?next=/app/agenda`; with `?next=//evil.com` it navigates to `/app`
- [ ] Test asserts `mfaRequired: true` navigates to `/login/2fa`
- [ ] Tests assert the Google button is absent with `googleEnabled: false` and links to `/api/public/auth/google/start` when true
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add login page`

---

#### T65: Implement Signup page

**What**: `/cadastro` form with name, DocumentInput (CPF ou CNPJ), e-mail, PhoneInput, profession (optional), professional registry (optional), PasswordInput, checkboxes "Li e aceito os Termos de uso" (`/termos`) and "Li e aceito a Política de privacidade" (`/privacidade`); `zodResolver(signupSchema)`; 201 → `/app` with banner; 409 → field error.
**Where**: `apps/web/src/pages/auth/SignupPage.tsx`
**Depends on**: T62, T63
**Reuses**: `signupSchema` (T8), form components (T44)
**Requirement**: FND-108, FND-109

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test types document "529.982.247-24", submits, and asserts "CPF ou CNPJ inválido" under the field and no API call
- [ ] Test asserts submit is disabled until both checkboxes are checked and the two links point to `/termos` and `/privacidade`
- [ ] Test asserts 201 navigates to `/app` and the banner "Enviamos um link de confirmação para o seu e-mail." is shown
- [ ] Tests assert 409 `EMAIL_TAKEN` shows "Este e-mail já está cadastrado." under e-mail and `DOCUMENT_TAKEN` shows "Este CPF/CNPJ já está cadastrado." under document
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add signup page with cpf or cnpj`

---

#### T66: Implement e-mail verification page

**What**: `/verificar-email` reading `token`, calling verify once (guard against StrictMode double effects), success "E-mail confirmado" + link `/app`; 400 → "Link inválido ou expirado" + "Reenviar e-mail" (when logged in) or link to `/login`.
**Where**: `apps/web/src/pages/auth/VerifyEmailPage.tsx`
**Depends on**: T62, T63
**Reuses**: `useVerifyEmail`, `useResendVerification`
**Requirement**: FND-110

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts exactly one verify request with the token and the text "E-mail confirmado"
- [ ] Test asserts a 400 shows "Link inválido ou expirado" and, with a session, a "Reenviar e-mail" button that calls resend
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add email verification page`

---

#### T67: Implement forgot and reset password pages

**What**: `/esqueci-senha` (e-mail form; always shows the neutral message) and `/redefinir-senha` (token from query, new password + confirmation must match, success → link `/login`, 400 → "Link inválido ou expirado").
**Where**: `apps/web/src/pages/auth/password/`
**Depends on**: T62, T63
**Reuses**: `useRequestPasswordReset`, `useConfirmPasswordReset`, `passwordSchema`
**Requirement**: FND-111

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts after submit the text "Se o e-mail estiver cadastrado, você receberá um link em instantes." for both 202 responses
- [ ] Tests assert mismatched confirmation shows "As senhas não conferem" without an API call; valid submit shows "Senha alterada" and a link to `/login`; 400 shows "Link inválido ou expirado"
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add forgot and reset password pages`

---

#### T68: Implement 2FA verify and enrollment pages

**What**: `/login/2fa` (6-digit or recovery code input, 401 → "Código inválido", 429 → wait message, success → safe `next` or `/admin`) and `/login/2fa/configurar` (enroll on mount, QR code from `otpauthUri` via `qrcode` to a data URL with alt "QR code para o aplicativo autenticador", manual secret shown, confirm code, then recovery codes list + "Já guardei os códigos" → `/admin`).
**Where**: `apps/web/src/pages/auth/TwoFactorPages.tsx`
**Depends on**: T64
**Reuses**: `useTotpEnroll`, `useTotpConfirm`, `useTotpVerify`
**Requirement**: FND-112, FND-113

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts a valid code navigates to `/admin`; 401 shows "Código inválido"
- [ ] Test asserts the enrollment page renders an img with the QR alt, then after confirming shows 10 recovery codes and the button "Já guardei os códigos" navigating to `/admin`
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add two-factor verify and enrollment pages`

---

### Phase 12: Shells, PWA and SEO

#### T69: Implement AppShell [P]

**What**: Tenant shell: sidebar (≥ lg) and bottom tab bar (< lg) from `appNav` with lucide icons, header with BrandLockup, user first name, ThemeToggle and "Sair" (logout → `/`), unverified-e-mail banner with resend, `<Outlet/>` rendering placeholders.
**Where**: `apps/web/src/components/layout/AppShell.tsx`
**Depends on**: T63
**Reuses**: `appNav` (T11), `useLogout` (T62)
**Requirement**: FND-118

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tests assert five nav items in order Reservar, Minhas reservas, Agenda, Compras, Perfil with their paths, the bottom bar having class `lg:hidden` and the sidebar `hidden lg:flex`
- [ ] Test asserts "Sair" calls logout and navigates to `/`
- [ ] Test asserts an unverified session shows "Confirme seu e-mail para reservar." with a resend button
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add tenant app shell`

---

#### T70: Implement AdminShell [P]

**What**: Staff shell: sidebar with `adminSectionsFor(role)` items (labels/paths from `adminSectionMeta`), active state, top bar (user name, role label "Administrador geral" / "Recepção", ThemeToggle, Sair), `<Outlet/>` with `ComingSoon` placeholders per section.
**Where**: `apps/web/src/components/layout/AdminShell.tsx`
**Depends on**: T63
**Reuses**: `access.ts` (T11), `ComingSoon` (T48)
**Requirement**: FND-117

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test asserts admin sees the 10 labels in PRD order; reception sees only "Gestão de Reservas" and "Clientes"
- [ ] Test navigates to "Cupons" and asserts heading "Cupons" and text "Em construção"
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add admin shell with role-based navigation`

---

#### T71: Configure PWA manifest, icons and service worker [P]

**What**: `vite-plugin-pwa` config (`registerType: 'prompt'`, manifest of FND-119, Workbox `globPatterns` for built assets, `navigateFallbackDenylist: [/^\/api\//]`, `runtimeCaching` NetworkOnly for `/api/`), icons `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (brand monogram on walnut), and `PwaUpdatePrompt` component using `useRegisterSW` that shows the toast "Nova versão disponível" with "Atualizar".
**Where**: `apps/web/src/pwa/PwaUpdatePrompt.tsx` (+ `apps/web/vite.config.ts` PWA block, `apps/web/public/icons/`)
**Depends on**: T48
**Reuses**: Toast (T48)
**Requirement**: FND-119, FND-120, FND-121

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test imports the exported `pwaOptions` and asserts every manifest field of FND-119 and the three icon entries (sizes, `purpose: 'maskable'` on the third)
- [ ] Test asserts `runtimeCaching` contains a NetworkOnly handler whose `urlPattern` matches `/api/health` and the denylist matches `/api/x`
- [ ] Test with `useRegisterSW` mocked (`needRefresh: true`) asserts the toast text and that "Atualizar" calls `updateServiceWorker(true)`
- [ ] `npm run build -w apps/web` (with `API_PROXY_ORIGIN` set) emits `dist/sw.js` and `dist/manifest.webmanifest`
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 3 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add installable pwa with update prompt`

---

#### T72: Add static SEO, fonts, robots and sitemap [P]

**What**: `index.html` head: title, meta description, Google Fonts preconnect + stylesheet (Josefin Sans and Jost 300–600, `display=swap`), Open Graph tags, JSON-LD `LocalBusiness` with `%VITE_SITE_URL%` substitution (Vite HTML env replacement; default `https://bravo-clinic.netlify.app` set in `vite.config.ts` when unset), theme-color; `public/og-image.jpg` (1200×630), `public/robots.txt`, `public/sitemap.xml` (public routes of §9.1 with the site URL).
**Where**: `apps/web/index.html` (+ `apps/web/public/robots.txt`, `apps/web/public/sitemap.xml`)
**Depends on**: T38
**Reuses**: `docs/architecture.md` §9.1, §9.3 fonts
**Requirement**: FND-104, FND-122, FND-123, FND-124

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Test reads `index.html` and asserts `lang="pt-BR"`, one `application/ld+json` script whose JSON has `@type: 'LocalBusiness'`, the name, `address.addressLocality 'Itajaí'`, `addressRegion 'SC'`, `addressCountry 'BR'`, `streetAddress 'Praia Brava'`, two `openingHoursSpecification` entries (Mo–Fr 07:00–23:59, Sa–Su 09:00–23:59)
- [ ] Test asserts `og:type`, `og:title`, `og:description` = "Saúde · Beleza · Bem-estar em um só lugar", `og:image`, `og:locale` = `pt_BR`
- [ ] Test asserts the fonts link contains `Josefin+Sans` and `Jost` and `display=swap`, and the file contains neither `cdn.tailwindcss.com` nor `Material+Symbols`
- [ ] Tests assert robots disallows `/app` and `/admin` and the sitemap lists `/`, `/salas`, `/precos`, `/servicos-extras`, `/politicas`, `/contato`, `/termos`, `/privacidade`
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add static seo, open graph and local business json-ld`

---

### Phase 13: Delivery configuration

#### T73: Generate Netlify redirects and add netlify.toml

**What**: `scripts/write-redirects.mjs` exporting `buildRedirects(origin)` (validates https, strips trailing `/`, returns the two-rule file) and writing `dist/_redirects` when run; web `build` = `vite build && node scripts/write-redirects.mjs`; root `netlify.toml` (`command = "npm run build -w apps/web"`, `publish = "apps/web/dist"`, `NODE_VERSION = "24"`, headers per `docs/architecture.md` §8).
**Where**: `apps/web/scripts/write-redirects.mjs` (+ `netlify.toml`)
**Depends on**: T38
**Reuses**: `docs/architecture.md` §8, AD-016
**Requirement**: FND-125, FND-126

**Tools**:

- MCP: NONE
- Skill: `netlify-config`

**Done when**:

- [ ] Tests assert `buildRedirects('https://br-x-api.compute.neon.tech/')` returns first line `/api/*  https://br-x-api.compute.neon.tech/:splat  200` and last line `/*  /index.html  200`
- [ ] Tests assert `buildRedirects(undefined)` and `buildRedirects('http://x')` throw "API_PROXY_ORIGIN must be an https URL"
- [ ] `npm run build -w apps/web` without `API_PROXY_ORIGIN` exits non-zero; with it, `dist/_redirects` exists
- [ ] Gate check passes: `npm test -w apps/web`
- [ ] Test count: ≥ 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `build(web): generate netlify api proxy redirects at build time`

---

#### T74: Declare the api function in neon.ts [P]

**What**: Root `neon.ts` per `docs/architecture.md` §8 (`@neon/config/v1`, slug `api`, source `apps/api/src/index.ts`, required env from `process.env`, optional keys spread only when set); root dev dependency `@neon/config`; a test importing the config with stubbed env.
**Where**: `neon.ts`
**Depends on**: T17
**Reuses**: neon-functions `neon.ts` pattern
**Requirement**: FND-127

**Tools**:

- MCP: NONE
- Skill: `neon-functions`

**Done when**:

- [ ] Test (in `apps/api`, importing `../../neon.ts` with `vi.stubEnv`) asserts `functions.api.source === 'apps/api/src/index.ts'`, env has `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_BASE_URL`, `EMAIL_FROM`, and has no `RESEND_API_KEY`/`GOOGLE_CLIENT_ID` keys when those are unset, and has them when set
- [ ] `npx neonctl@latest config plan` (run by the worker, branch `dev`) shows function `api` (no apply)
- [ ] Gate check passes: `npm test -w apps/api`
- [ ] Test count: ≥ 2 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `build(api): declare neon function api in neon.ts`

---

#### T75: Add GitHub Actions CI workflow

**What**: `.github/workflows/ci.yml` on `push` to `main` and `pull_request` to `main`: Node 24 with npm cache, service `postgres:17` (health check `pg_isready`), env `DATABASE_URL_TEST`, steps `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` with `API_PROXY_ORIGIN=https://example.invalid`; concurrency group per ref.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T73
**Reuses**: AD-018
**Requirement**: FND-128

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Workflow YAML validates (`npx --yes @action-validator/cli .github/workflows/ci.yml` or equivalent) and lists the five steps in order
- [ ] Running the same steps locally with a disposable postgres 17 (or `DATABASE_URL_TEST`) passes
- [ ] The workflow runs green on GitHub after the user pushes (the user pushes; agents do not push)
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: none
**Gate**: build

**Commit**: `ci: add typecheck, lint, test and build workflow`

---

### Phase 14: First production deploy (explicit go-ahead required)

#### T76: Apply migrations and seeds to the Neon production branch

**What**: With the user's go-ahead, run `npm run db:migrate -w apps/api` and `npm run db:seed -w apps/api` against `production` using `DATABASE_URL_UNPOOLED="$(npx neonctl@latest connection-string production --project-id "$NEON_PROJECT_ID" --database-name bravo)"` and `ADMIN_BOOTSTRAP_*` provided by the user in their shell (never echoed, never written to files).
**Where**: Neon branch `production` (no repo file)
**Depends on**: T75
**Reuses**: `runMigrations`, `runSeed`
**Requirement**: FND-129

**Tools**:

- MCP: `Neon` (read-only verification: `get_database_tables`, `run_sql` with `select count(*)`)
- Skill: `neon-postgres`

**Done when**:

- [ ] User approved this phase in chat
- [ ] Neon `production` has the 18 base tables, `btree_gist`, 3 rooms, 28 holidays, all settings rows, and exactly one admin
- [ ] No connection string or password appears in terminal output or files
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: none
**Gate**: build

**Commit**: `chore(ops): record production database baseline` (updates `.specs/STATE.md` Handoff only)

---

#### T77: Deploy the api function to production

**What**: With the user's go-ahead, set function secrets in the operator's env file and run `npx neonctl@latest deploy --env <file>` on branch `production` (fallback `npx neonctl@latest functions deploy api --src apps/api/src/index.ts`; if bundling fails, switch `neon.ts` to `bundler: 'none'` with `npm run bundle -w apps/api` output, per design Risks); record the `invocation_url` from `npx neonctl@latest functions get api`.
**Where**: Neon Function `api` on `production` (repo change only if the bundler fallback is needed: `neon.ts`)
**Depends on**: T76, T74
**Reuses**: `neon.ts` (T74), bundle script (T17)
**Requirement**: FND-129

**Tools**:

- MCP: `Neon` (`list_functions`, `get_function`)
- Skill: `neon-functions`

**Done when**:

- [ ] User approved this phase in chat
- [ ] `curl -s <invocation_url>/health` returns `{"status":"ok","db":"ok","branch":"production"}`
- [ ] `npx neonctl@latest logs query --branch production --source function --since 15m` shows the request log line with a requestId and no secrets
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: none
**Gate**: build

**Commit**: `chore(ops): deploy api function to production` (only if `neon.ts` changed; otherwise Handoff update)

---

#### T78: Deploy the site to Netlify production and run the smoke check

**What**: With the user's go-ahead, set Netlify env vars (`API_PROXY_ORIGIN` = production `invocation_url` for context production, dev branch URL for deploy-preview/branch-deploy; `VITE_SITE_URL`), deploy `bravo-clinic` to production (`npx netlify-cli deploy --build --prod` or Git-triggered build), add `scripts/smoke.mjs`, and run it against the site.
**Where**: `scripts/smoke.mjs`
**Depends on**: T77
**Reuses**: `netlify.toml` (T73)
**Requirement**: FND-129

**Tools**:

- MCP: NONE
- Skill: `netlify-deploy`

**Done when**:

- [ ] User approved this phase in chat
- [ ] `node scripts/smoke.mjs https://bravo-clinic.netlify.app` exits 0 (health 200 `branch: production`, `/` 200 with the hero headline, `/api/public/config` 200)
- [ ] Admin logs in on production, enrolls TOTP, reaches `/admin` (manual check by the user)
- [ ] `.specs/STATE.md` Handoff records site URL and function URL (no secrets)
- [ ] Gate check passes: `npm run typecheck && npm run lint && npm test && API_PROXY_ORIGIN=https://example.invalid npm run build`

**Tests**: e2e
**Gate**: build

**Commit**: `chore(ops): add production smoke check and first deploy`

---

## Phase Execution Map

Phases run in sequence; tasks within a phase run in order (Execution Plan above holds the per-task arrows).

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
→ Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13 → Phase 14
```

Batch packing (~7 tasks, whole phases): B1 = P1 (4) · B2 = P2 (7) · B3 = P3 (6) · B4 = P4 (6) · B5 = P5 (7) · B6 = P6 (7) · B7 = P7 (5) · B8 = P8 (7) · B9 = P9 (5) · B10 = P10 (7) · B11 = P11 (7) · B12 = P12 + P13 (7) · B13 = P14 (3, operator-approved). Model tier: B2, B4–B6 high-reasoning (domain/security); B1, B3, B7–B13 implementation tier.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Create root workspace manifest | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T2: Add strict TypeScript base config | 1 file | ✅ Granular |
| T3: Configure ESLint and Prettier | 1 file | ✅ Granular |
| T4: Scaffold @bravo/core with Vitest | 1 folder, one concern | ✅ Granular |
| T5: Implement money helpers | 1 file | ✅ Granular |
| T6: Implement São Paulo time helpers | 1 file | ✅ Granular |
| T7: Implement CPF/CNPJ validation | 1 file | ✅ Granular |
| T8: Implement shared auth schemas | 1 file | ✅ Granular |
| T9: Implement typed settings catalog | 1 file | ✅ Granular |
| T10: Add 2026–2027 holiday seed data | 1 file | ✅ Granular |
| T11: Implement role access and navigation maps | 1 file | ✅ Granular |
| T12: Scaffold @bravo/api with env parsing | 1 file | ✅ Granular |
| T13: Add request context and JSON logger | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T14: Add error model, JSON guard and app factory | 4 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T15: Add database client and transaction helper | 1 file | ✅ Granular |
| T16: Add health route | 1 file | ✅ Granular |
| T17: Add Neon entry, local dev server and bundle check | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T18: Define identity schema | 1 file | ✅ Granular |
| T19: Define rooms and calendar schema | 1 file | ✅ Granular |
| T20: Define platform schema | 1 file | ✅ Granular |
| T21: Generate base migrations | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T22: Add migration runner and integration test harness | 1 file | ✅ Granular |
| T23: Add idempotent seed script with admin bootstrap | 1 file | ✅ Granular |
| T24: Implement crypto library | 1 file | ✅ Granular |
| T25: Implement audit helper | 1 file | ✅ Granular |
| T26: Implement e-mail outbox and auth templates | 1 file | ✅ Granular |
| T27: Implement session service | 1 file | ✅ Granular |
| T28: Implement auth middleware chain | 1 file | ✅ Granular |
| T29: Implement CSRF origin check | 1 file | ✅ Granular |
| T30: Implement database-backed rate limiter | 1 file | ✅ Granular |
| T31: Implement signup endpoint | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T32: Implement login, logout and me endpoints | 3 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T33: Implement e-mail verification endpoints | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T34: Implement password reset endpoints | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T35: Implement staff TOTP endpoints | 3 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T36: Implement admin session and public config endpoints | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T37: Implement Google OAuth login gated by env | 3 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T38: Scaffold @bravo/web with Vite, React and Tailwind | 1 folder, one concern | ✅ Granular |
| T39: Map design tokens into the Tailwind config | 1 file | ✅ Granular |
| T40: Define Day/Night CSS variables | 1 file | ✅ Granular |
| T41: Implement ThemeProvider, toggle and no-flash script | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T42: Implement Icon, BrandLockup and EyebrowLockup | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T43: Implement Button | 1 file | ✅ Granular |
| T44: Implement form field components | 1 folder, one concern | ✅ Granular |
| T45: Implement Card and Badge | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T46: Implement Modal | 1 file | ✅ Granular |
| T47: Implement Tabs | 1 file | ✅ Granular |
| T48: Implement Toast, Alert, Spinner and ComingSoon | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T49: Implement RoomCard | 1 file | ✅ Granular |
| T50: Implement API client, query client and base hooks | 4 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T51: Implement Header | 1 file | ✅ Granular |
| T52: Implement Footer | 1 file | ✅ Granular |
| T53: Implement WhatsApp floating button | 1 file | ✅ Granular |
| T54: Implement PublicLayout and NotFound page | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T55: Port Hero section with quick booking widget | 1 file | ✅ Granular |
| T56: Port Arquitetura section | 1 file | ✅ Granular |
| T57: Port Salas section with static room data | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T58: Port pricing table and simulator section | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T59: Port Serviços extras section with WhatsApp quote modal | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T60: Port Comodidade, Políticas and CTA sections | 1 file | ✅ Granular |
| T61: Compose HomePage and mount the public routes | 1 file | ✅ Granular |
| T62: Implement auth mutation hooks | 1 file | ✅ Granular |
| T63: Implement router map and route guards | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T64: Implement Login page | 1 file | ✅ Granular |
| T65: Implement Signup page | 1 file | ✅ Granular |
| T66: Implement e-mail verification page | 1 file | ✅ Granular |
| T67: Implement forgot and reset password pages | 1 folder, one concern | ✅ Granular |
| T68: Implement 2FA verify and enrollment pages | 1 file | ✅ Granular |
| T69: Implement AppShell | 1 file | ✅ Granular |
| T70: Implement AdminShell | 1 file | ✅ Granular |
| T71: Configure PWA manifest, icons and service worker | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T72: Add static SEO, fonts, robots and sitemap | 3 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T73: Generate Netlify redirects and add netlify.toml | 2 files, one concern (component + its helper / route + its service) | ⚠️ OK (cohesive) |
| T74: Declare the api function in neon.ts | 1 file | ✅ Granular |
| T75: Add GitHub Actions CI workflow | 1 file | ✅ Granular |
| T76: Apply migrations and seeds to the Neon production branch | 1 operational step | ✅ Granular |
| T77: Deploy the api function to production | 1 file | ✅ Granular |
| T78: Deploy the site to Netlify production and run the smoke check | 1 file | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (same-phase arrows) | Status |
| --- | --- | --- | --- |
| T1 | None (same phase) | - | ✅ Match |
| T2 | T1 | T1 | ✅ Match |
| T3 | T2 | T2 | ✅ Match |
| T4 | T3 | T3 | ✅ Match |
| T5 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T6 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T7 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T8 | T7 | T7 | ✅ Match |
| T9 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T10 | T6 | T6 | ✅ Match |
| T11 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T12 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T13 | T12 | T12 | ✅ Match |
| T14 | T13 | T13 | ✅ Match |
| T15 | T12 | T12 | ✅ Match |
| T16 | T14, T15 | T14, T15 | ✅ Match |
| T17 | T16 | T16 | ✅ Match |
| T18 | None (same phase); earlier phase: T15 | - | ✅ Match |
| T19 | None (same phase); earlier phase: T15 | - | ✅ Match |
| T20 | None (same phase); earlier phase: T15 | - | ✅ Match |
| T21 | T18, T19, T20 | T18, T19, T20 | ✅ Match |
| T22 | T21 | T21 | ✅ Match |
| T23 | T22; earlier phase: T9, T10 | T22 | ✅ Match |
| T24 | None (same phase); earlier phase: T12 | - | ✅ Match |
| T25 | None (same phase); earlier phase: T22 | - | ✅ Match |
| T26 | None (same phase); earlier phase: T22 | - | ✅ Match |
| T27 | T24 | T24 | ✅ Match |
| T28 | T27 | T27 | ✅ Match |
| T29 | None (same phase); earlier phase: T14 | - | ✅ Match |
| T30 | None (same phase); earlier phase: T22 | - | ✅ Match |
| T31 | None (same phase); earlier phase: T25, T26, T27, T29, T8 | - | ✅ Match |
| T32 | None (same phase); earlier phase: T28, T30 | - | ✅ Match |
| T33 | None (same phase); earlier phase: T26, T28, T30 | - | ✅ Match |
| T34 | None (same phase); earlier phase: T25, T26, T27 | - | ✅ Match |
| T35 | T32 | T32 | ✅ Match |
| T36 | None (same phase); earlier phase: T28, T11, T23 | - | ✅ Match |
| T37 | T32 | T32 | ✅ Match |
| T38 | None (same phase); earlier phase: T4 | - | ✅ Match |
| T39 | T38 | T38 | ✅ Match |
| T40 | T39 | T39 | ✅ Match |
| T41 | T40 | T40 | ✅ Match |
| T42 | T39 | T39 | ✅ Match |
| T43 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T44 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T45 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T46 | T43 | T43 | ✅ Match |
| T47 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T48 | T43 | T43 | ✅ Match |
| T49 | T43, T45 | T43, T45 | ✅ Match |
| T50 | None (same phase); earlier phase: T38 | - | ✅ Match |
| T51 | T50 | T50 | ✅ Match |
| T52 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T53 | T50 | T50 | ✅ Match |
| T54 | T51, T52, T53 | T51, T52, T53 | ✅ Match |
| T55 | None (same phase); earlier phase: T49 | - | ✅ Match |
| T56 | None (same phase); earlier phase: T42 | - | ✅ Match |
| T57 | None (same phase); earlier phase: T49 | - | ✅ Match |
| T58 | None (same phase); earlier phase: T43 | - | ✅ Match |
| T59 | None (same phase); earlier phase: T46, T50 | - | ✅ Match |
| T60 | None (same phase); earlier phase: T43 | - | ✅ Match |
| T61 | T55, T56, T57, T58, T59, T60; earlier phase: T54 | T55, T56, T57, T58, T59, T60 | ✅ Match |
| T62 | None (same phase); earlier phase: T50 | - | ✅ Match |
| T63 | T62 | T62 | ✅ Match |
| T64 | T62, T63 | T62, T63 | ✅ Match |
| T65 | T62, T63 | T62, T63 | ✅ Match |
| T66 | T62, T63 | T62, T63 | ✅ Match |
| T67 | T62, T63 | T62, T63 | ✅ Match |
| T68 | T64 | T64 | ✅ Match |
| T69 | None (same phase); earlier phase: T63 | - | ✅ Match |
| T70 | None (same phase); earlier phase: T63 | - | ✅ Match |
| T71 | None (same phase); earlier phase: T48 | - | ✅ Match |
| T72 | None (same phase); earlier phase: T38 | - | ✅ Match |
| T73 | None (same phase); earlier phase: T38 | - | ✅ Match |
| T74 | None (same phase); earlier phase: T17 | - | ✅ Match |
| T75 | T73 | T73 | ✅ Match |
| T76 | None (same phase); earlier phase: T75 | - | ✅ Match |
| T77 | T76; earlier phase: T74 | T76 | ✅ Match |
| T78 | T77 | T77 | ✅ Match |

Cross-phase dependencies are not drawn per phase; every one points to an earlier phase.

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Create root workspace manifest | Repo config | none | none | ✅ OK |
| T2: Add strict TypeScript base config | Repo config | none | none | ✅ OK |
| T3: Configure ESLint and Prettier | Repo config | none | none | ✅ OK |
| T4: Scaffold @bravo/core with Vitest | Workspace scaffold config | none | none | ✅ OK |
| T5: Implement money helpers | core domain helper | unit | unit | ✅ OK |
| T6: Implement São Paulo time helpers | core domain helper | unit | unit | ✅ OK |
| T7: Implement CPF/CNPJ validation | core domain helper | unit | unit | ✅ OK |
| T8: Implement shared auth schemas | core domain helper | unit | unit | ✅ OK |
| T9: Implement typed settings catalog | core domain helper | unit | unit | ✅ OK |
| T10: Add 2026–2027 holiday seed data | core domain helper | unit | unit | ✅ OK |
| T11: Implement role access and navigation maps | core domain helper | unit | unit | ✅ OK |
| T12: Scaffold @bravo/api with env parsing | API pure lib | unit | unit | ✅ OK |
| T13: Add request context and JSON logger | API pure lib | unit | unit | ✅ OK |
| T14: Add error model, JSON guard and app factory | API route/middleware/service/DB | integration | integration | ✅ OK |
| T15: Add database client and transaction helper | API route/middleware/service/DB | integration | integration | ✅ OK |
| T16: Add health route | API route/middleware/service/DB | integration | integration | ✅ OK |
| T17: Add Neon entry, local dev server and bundle check | API entry/dev server config | none | none | ✅ OK |
| T18: Define identity schema | Drizzle schema / migration SQL | none | none | ✅ OK |
| T19: Define rooms and calendar schema | Drizzle schema / migration SQL | none | none | ✅ OK |
| T20: Define platform schema | Drizzle schema / migration SQL | none | none | ✅ OK |
| T21: Generate base migrations | Drizzle schema / migration SQL | none | none | ✅ OK |
| T22: Add migration runner and integration test harness | API route/middleware/service/DB | integration | integration | ✅ OK |
| T23: Add idempotent seed script with admin bootstrap | API route/middleware/service/DB | integration | integration | ✅ OK |
| T24: Implement crypto library | API pure lib | unit | unit | ✅ OK |
| T25: Implement audit helper | API route/middleware/service/DB | integration | integration | ✅ OK |
| T26: Implement e-mail outbox and auth templates | API route/middleware/service/DB | integration | integration | ✅ OK |
| T27: Implement session service | API route/middleware/service/DB | integration | integration | ✅ OK |
| T28: Implement auth middleware chain | API route/middleware/service/DB | integration | integration | ✅ OK |
| T29: Implement CSRF origin check | API route/middleware/service/DB | integration | integration | ✅ OK |
| T30: Implement database-backed rate limiter | API route/middleware/service/DB | integration | integration | ✅ OK |
| T31: Implement signup endpoint | API route/middleware/service/DB | integration | integration | ✅ OK |
| T32: Implement login, logout and me endpoints | API route/middleware/service/DB | integration | integration | ✅ OK |
| T33: Implement e-mail verification endpoints | API route/middleware/service/DB | integration | integration | ✅ OK |
| T34: Implement password reset endpoints | API route/middleware/service/DB | integration | integration | ✅ OK |
| T35: Implement staff TOTP endpoints | API route/middleware/service/DB | integration | integration | ✅ OK |
| T36: Implement admin session and public config endpoints | API route/middleware/service/DB | integration | integration | ✅ OK |
| T37: Implement Google OAuth login gated by env | API route/middleware/service/DB | integration | integration | ✅ OK |
| T38: Scaffold @bravo/web with Vite, React and Tailwind | Workspace scaffold config | none | none | ✅ OK |
| T39: Map design tokens into the Tailwind config | Web config | unit | unit | ✅ OK |
| T40: Define Day/Night CSS variables | Web config | unit | unit | ✅ OK |
| T41: Implement ThemeProvider, toggle and no-flash script | Web component/hook/page | unit | unit | ✅ OK |
| T42: Implement Icon, BrandLockup and EyebrowLockup | Web component/hook/page | unit | unit | ✅ OK |
| T43: Implement Button | Web component/hook/page | unit | unit | ✅ OK |
| T44: Implement form field components | Web component/hook/page | unit | unit | ✅ OK |
| T45: Implement Card and Badge | Web component/hook/page | unit | unit | ✅ OK |
| T46: Implement Modal | Web component/hook/page | unit | unit | ✅ OK |
| T47: Implement Tabs | Web component/hook/page | unit | unit | ✅ OK |
| T48: Implement Toast, Alert, Spinner and ComingSoon | Web component/hook/page | unit | unit | ✅ OK |
| T49: Implement RoomCard | Web component/hook/page | unit | unit | ✅ OK |
| T50: Implement API client, query client and base hooks | Web component/hook/page | unit | unit | ✅ OK |
| T51: Implement Header | Web component/hook/page | unit | unit | ✅ OK |
| T52: Implement Footer | Web component/hook/page | unit | unit | ✅ OK |
| T53: Implement WhatsApp floating button | Web component/hook/page | unit | unit | ✅ OK |
| T54: Implement PublicLayout and NotFound page | Web component/hook/page | unit | unit | ✅ OK |
| T55: Port Hero section with quick booking widget | Web component/hook/page | unit | unit | ✅ OK |
| T56: Port Arquitetura section | Web component/hook/page | unit | unit | ✅ OK |
| T57: Port Salas section with static room data | Web component/hook/page | unit | unit | ✅ OK |
| T58: Port pricing table and simulator section | Web component/hook/page | unit | unit | ✅ OK |
| T59: Port Serviços extras section with WhatsApp quote modal | Web component/hook/page | unit | unit | ✅ OK |
| T60: Port Comodidade, Políticas and CTA sections | Web component/hook/page | unit | unit | ✅ OK |
| T61: Compose HomePage and mount the public routes | Web component/hook/page | unit | unit | ✅ OK |
| T62: Implement auth mutation hooks | Web component/hook/page | unit | unit | ✅ OK |
| T63: Implement router map and route guards | Web component/hook/page | unit | unit | ✅ OK |
| T64: Implement Login page | Web component/hook/page | unit | unit | ✅ OK |
| T65: Implement Signup page | Web component/hook/page | unit | unit | ✅ OK |
| T66: Implement e-mail verification page | Web component/hook/page | unit | unit | ✅ OK |
| T67: Implement forgot and reset password pages | Web component/hook/page | unit | unit | ✅ OK |
| T68: Implement 2FA verify and enrollment pages | Web component/hook/page | unit | unit | ✅ OK |
| T69: Implement AppShell | Web component/hook/page | unit | unit | ✅ OK |
| T70: Implement AdminShell | Web component/hook/page | unit | unit | ✅ OK |
| T71: Configure PWA manifest, icons and service worker | Web component/hook/page | unit | unit | ✅ OK |
| T72: Add static SEO, fonts, robots and sitemap | Web config | unit | unit | ✅ OK |
| T73: Generate Netlify redirects and add netlify.toml | Web config | unit | unit | ✅ OK |
| T74: Declare the api function in neon.ts | Deploy config with tested builder | unit | unit | ✅ OK |
| T75: Add GitHub Actions CI workflow | Repo config | none | none | ✅ OK |
| T76: Apply migrations and seeds to the Neon production branch | Operational step | none | none | ✅ OK |
| T77: Deploy the api function to production | Operational step | none | none | ✅ OK |
| T78: Deploy the site to Netlify production and run the smoke check | Production deploy (smoke) | e2e | e2e | ✅ OK |
