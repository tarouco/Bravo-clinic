import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { addDays, formatBRL, utcToLocal, type LocalDate } from '@bravo/core';
import { expect, type Locator, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  adminTotp,
  cpf,
  E2E_ADMIN,
  e2eDatabaseUrl,
  latestEmail,
  type E2eProject,
} from '../../api/test/e2e-seed';

// Shared steps of the receita end-to-end flows (T48–T50): sign-up with e-mail verification, admin
// login with TOTP, sandbox approval, the job CLI with an injected clock and the database lookups
// the specs assert on. Same test database as the nucleo harness (`apps/api/test/e2e-seed.ts`).

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const run = promisify(exec);

export const projectOf = (name: string): E2eProject => (name === 'mobile' ? 'mobile' : 'desktop');

/** Short unique tag for e-mails, names and coupon codes of one test run. */
export const runTag = () => randomUUID().slice(0, 8);

/** "27 de outubro", as MonthCalendar names a day. */
export const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** Clicks a day of the month calendar inside `scope`, moving forward a month when needed. */
export async function pickDay(scope: Page | Locator, date: string) {
  const day = scope.getByRole('button', { name: new RegExp(`^${dayName(date)},`) });
  for (let i = 0; i < 4 && !(await day.isVisible()); i++) {
    await scope.getByRole('button', { name: 'Próximo mês' }).click();
  }
  await day.click();
}

/** Weekday (0 = Sunday) of a local date. */
export const weekdayOf = (date: LocalDate) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The first date at least `minDays` after today (São Paulo) that falls on `weekday`. */
export function nextWeekday(weekday: number, minDays: number, now = new Date()): LocalDate {
  let date = addDays(utcToLocal(now).date, minDays);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return date;
}

let lookupPool: Pool | undefined;
function pool(): Pool {
  lookupPool ??= new Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
  return lookupPool;
}

export async function closeReceitaDb(): Promise<void> {
  await lookupPool?.end();
  lookupPool = undefined;
}

async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool().query<T>(sql, params);
  return rows;
}

export interface Tenant {
  name: string;
  email: string;
  password: string;
}

/** Signs a new tenant up through `/cadastro` and confirms the e-mail with the queued token. */
export async function signUpTenant(page: Page, firstName: string): Promise<Tenant> {
  const tag = runTag();
  const tenant: Tenant = {
    name: `${firstName} ${tag}`,
    email: `${firstName.toLowerCase()}-${tag}@bravoclinic.test`,
    password: 'ReceitaE2e2026',
  };
  await page.goto('/cadastro');
  await page.getByLabel('Nome completo').fill(tenant.name);
  await page.getByLabel('CPF ou CNPJ').fill(cpf(60_000 + Math.floor(Math.random() * 30_000)));
  await page.getByLabel('E-mail').fill(tenant.email);
  await page.getByLabel('Telefone').fill('(11) 98765-4321');
  await page.getByLabel('Senha', { exact: true }).fill(tenant.password);
  await page.getByLabel(/Termos de uso/).check();
  await page.getByLabel(/Política de privacidade/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/app/);

  let verifyHtml = '';
  await expect
    .poll(async () => {
      verifyHtml = (await latestEmail(tenant.email, 'auth.verify_email'))?.html ?? '';
      return verifyHtml;
    })
    .toContain('/verificar-email?token=');
  const token = /\/verificar-email\?token=([A-Za-z0-9_-]+)/.exec(verifyHtml)?.[1] ?? '';
  await page.goto(`/verificar-email?token=${token}`);
  await expect(page.getByText('E-mail confirmado')).toBeVisible();
  return tenant;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** The admin's TOTP step already used (a code works once: replays fail, FND-67). */
async function lastAdminStep(): Promise<number | null> {
  const [row] = await query<{ step: string | null }>(
    `select t.last_used_step::text as step from user_totp t join users u on u.id = t.user_id
      where u.email = $1`,
    [E2E_ADMIN.email],
  );
  return row?.step === null || row?.step === undefined ? null : Number(row.step);
}

/** Admin login with password and TOTP, waiting for a fresh 30-s step when the current one was used. */
export async function loginAdmin(page: Page) {
  await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/login\/2fa/);
  const used = await lastAdminStep();
  const step = () => Math.floor(Date.now() / 30_000);
  while (used !== null && step() <= used) {
    await page.waitForTimeout(1_000);
  }
  await page.getByLabel('Código de verificação').fill(adminTotp());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

/**
 * Pays `amountCents` with Pix in the PaymentMethodPanel on screen and approves it on the sandbox
 * hosted page (NUC-120). Fixed-schedule charges write every occurrence on Neon: give them a
 * longer `timeout`.
 */
export async function payPixInSandbox(page: Page, amountCents: number, timeout = 15_000) {
  await page.getByRole('button', { name: `Pagar ${formatBRL(amountCents)}` }).click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).click({ timeout });
  await expect(page.getByRole('heading', { name: 'Pagamento de teste' })).toBeVisible();
  await expect(page.getByText(formatBRL(amountCents)).first()).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar pagamento' }).click();
  await expect(page.getByText('Pagamento aprovado.')).toBeVisible({ timeout });
}

/** Calls an API route from the page (session cookie, same origin for the CSRF check). */
export async function apiFromPage<T>(
  page: Page,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ method: m, path: p, body: b, key }) => {
      const response = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(b === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(m === 'POST' ? { 'Idempotency-Key': key } : {}),
        },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      const text = await response.text();
      return { status: response.status, json: (text === '' ? null : JSON.parse(text)) as T };
    },
    { method, path, body, key: randomUUID() },
  );
}

/** Runs a scheduled job through `jobs/cli.ts` with the clock at `now` (design.md "Jobs"). */
export async function runJob(name: string, now: Date): Promise<Record<string, number>> {
  const { stdout } = await run(`npm run job -w apps/api -- ${name} --now=${now.toISOString()}`, {
    cwd: repoRoot,
    env: process.env,
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (line === undefined) throw new Error(`job ${name} printed no stats`);
  return JSON.parse(line) as Record<string, number>;
}

export async function roomIdOf(slug: string): Promise<string> {
  const [row] = await query<{ id: string }>(`select id from rooms where slug = $1`, [slug]);
  if (row === undefined) throw new Error(`room ${slug} missing`);
  return row.id;
}

export async function userIdOf(email: string): Promise<string> {
  const [row] = await query<{ id: string }>(`select id from users where email = $1`, [email]);
  if (row === undefined) throw new Error(`user ${email} missing`);
  return row.id;
}

export interface SubscriptionRow {
  id: string;
  status: string;
  type: string;
  payment_method: string;
}

/** The newest subscription of a user to a category (by name). */
export async function subscriptionOf(
  email: string,
  categoryName: string,
): Promise<SubscriptionRow | null> {
  const [row] = await query<SubscriptionRow>(
    `select s.id, s.status, s.type, s.payment_method from subscriptions s
       join users u on u.id = s.user_id
       join booking_categories c on c.id = s.category_id
      where u.email = $1 and c.name = $2
      order by s.created_at desc limit 1`,
    [email, categoryName],
  );
  return row ?? null;
}

/** Periods of a subscription in seq order. */
export async function periodsOf(subscriptionId: string) {
  return query<{ seq: number; status: string; starts_on: string; occurrence_count: number | null }>(
    `select seq, status, starts_on::text as starts_on, occurrence_count from subscription_periods
      where subscription_id = $1 order by seq`,
    [subscriptionId],
  );
}

/** Occurrence bookings of a subscription grouped by period seq and status. */
export async function occurrenceStatuses(subscriptionId: string) {
  const rows = await query<{ seq: number; status: string; count: string }>(
    `select p.seq, b.status, count(*)::text as count from bookings b
       join subscription_periods p on p.id = b.subscription_period_id
      where b.subscription_id = $1 group by p.seq, b.status order by p.seq, b.status`,
    [subscriptionId],
  );
  return rows.map((r) => ({ seq: r.seq, status: r.status, count: Number(r.count) }));
}

/** Active occupancy rows still held by the occurrences of one period of a subscription. */
export async function occupancyOfPeriod(subscriptionId: string, seq: number): Promise<number> {
  const [row] = await query<{ count: string }>(
    `select count(*)::text as count from room_occupancy o
       join bookings b on b.id = o.ref_id
       join subscription_periods p on p.id = b.subscription_period_id
      where b.subscription_id = $1 and p.seq = $2 and o.active and o.kind = 'booking'`,
    [subscriptionId, seq],
  );
  return Number(row?.count ?? 0);
}

export async function bookingDetails(code: string) {
  const [row] = await query<{
    status: string;
    payment_mode: string;
    total_cents: number;
    deposit_cents: number;
    discount_cents: number;
    discount_source: string;
    package_minutes_debited: number;
  }>(
    `select status, payment_mode, total_cents, deposit_cents, discount_cents, discount_source,
            package_minutes_debited
       from bookings where code = $1`,
    [code],
  );
  return row ?? null;
}

/** Coupon counters by code. */
export async function couponByCode(code: string) {
  const [row] = await query<{ uses_count: number; max_uses: number | null }>(
    `select uses_count, max_uses from coupons where code = $1`,
    [code],
  );
  return row ?? null;
}

/**
 * The issuer starts declining the user's saved cards: the sandbox gateway rejects every card whose
 * id carries last4 0002 (`SANDBOX_DECLINED_LAST4`), so the card's gateway id is switched to one.
 */
export async function startDecliningCards(email: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update saved_cards set external_card_id = 'sbx_card_0002_' || gen_random_uuid()::text
      where user_id = (select id from users where email = $1) and deleted_at is null
      returning id`,
    [email],
  );
  return rows.length;
}

/** Newest charge of a subscription's period `seq`. */
export async function periodCharge(subscriptionId: string, seq: number) {
  const [row] = await query<{ status: string; method: string; amount_cents: number }>(
    `select c.status, c.method, c.amount_cents from charges c
       join subscription_periods p on p.id = c.subscription_period_id
      where p.subscription_id = $1 and p.seq = $2 and c.method <> 'credit'
      order by c.created_at desc limit 1`,
    [subscriptionId, seq],
  );
  return row ?? null;
}
