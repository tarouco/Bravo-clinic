import { randomUUID } from 'node:crypto';
import { formatBRL } from '@bravo/core';
import { expect, test, type Page } from '@playwright/test';
import {
  bookingByCode,
  closeE2eDb,
  cpf,
  E2E_API_PORT,
  E2E_TENANT_PASSWORD,
  E2E_TENANTS,
  latestEmail,
  LOAD_BOOKINGS,
  loadMonth,
  bookableWeekday,
  tenantBookingDate,
  type E2eProject,
} from '../../api/test/e2e-seed';

// Spec Success Criteria (T49): visitor signup → verify → book Tue 17:30–20:00 → sandbox approve
// → "Reserva confirmada" + booking.confirmed with .ics; tenant cheaper reschedule and cancel with
// the preview values; availability p95 with the 500 seeded bookings.

test.afterAll(async () => {
  await closeE2eDb();
});

const projectOf = (name: string): E2eProject => (name === 'mobile' ? 'mobile' : 'desktop');

/** "27 de outubro", as MonthCalendar names a day. */
const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** Clicks a day of the (only) month calendar on screen, moving forward a month when needed. */
async function pickDay(page: Page, date: string) {
  const day = page.getByRole('button', { name: new RegExp(`^${dayName(date)},`) });
  for (let i = 0; i < 3 && !(await day.isVisible()); i++) {
    await page.getByRole('button', { name: 'Próximo mês' }).click();
  }
  await day.click();
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('visitor signs up, verifies, books Tue 17:30–20:00 and pays the sinal in the sandbox', async ({
  page,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  // Desktop books the first Tuesday at least 3 days ahead (deposit mode), mobile the next one.
  const tuesday = await bookableWeekday([2], 3, project === 'desktop' ? 0 : 1);
  const email = `visitante-${randomUUID().slice(0, 8)}@bravoclinic.test`;

  // Step 1: Sala e data.
  await page.goto('/reservar');
  for (const label of ['Sala e data', 'Horário', 'Resumo', 'Pagamento']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole('radio', { name: /Sala Principal/ }).check();
  await pickDay(page, tuesday);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Step 2: Horário, 17:30 for 2h30.
  await page
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: '17:30', exact: true })
    .click();
  await page.getByRole('group', { name: 'Duração' }).getByRole('button', { name: '2h30' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Step 3: Resumo with PR-3 / SP-1 values.
  await expect(
    page.getByText(
      `17:30–19:00 · 2 horas ou mais · 1h30 × ${formatBRL(8000)} = ${formatBRL(12000)}`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `19:00–20:00 · 2 horas ou mais — noite · 1h × ${formatBRL(9900)} = ${formatBRL(9900)}`,
    ),
  ).toBeVisible();
  await expect(page.getByText(formatBRL(21900)).first()).toBeVisible();
  await expect(page.getByText(formatBRL(10950)).first()).toBeVisible();
  const resumoUrl = page.url();
  const accept = page.getByLabel('Li e aceito a política de reserva');
  await accept.check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();

  // Anonymous: login → signup with `next` back to the Resumo.
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastro\?next=/);
  await page.getByLabel('Nome completo').fill('Visitante E2E');
  await page.getByLabel('CPF ou CNPJ').fill(cpf(1000 + Math.floor(Math.random() * 50_000)));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Telefone').fill('(11) 98765-4321');
  await page.getByLabel('Senha', { exact: true }).fill('VisitanteE2e2026');
  await page.getByLabel(/Termos de uso/).check();
  await page.getByLabel(/Política de privacidade/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/etapa=resumo/);

  // Verify through the token the API queued in the outbox.
  let verifyHtml = '';
  await expect
    .poll(async () => {
      verifyHtml = (await latestEmail(email, 'auth.verify_email'))?.html ?? '';
      return verifyHtml;
    })
    .toContain('/verificar-email?token=');
  const token = /\/verificar-email\?token=([A-Za-z0-9_-]+)/.exec(verifyHtml)?.[1] ?? '';
  await page.goto(`/verificar-email?token=${token}`);
  await expect(page.getByText('E-mail confirmado')).toBeVisible();

  // Back to the same Resumo: the selection is intact; accept and create the booking.
  await page.goto(resumoUrl);
  await expect(page.getByText(formatBRL(21900)).first()).toBeVisible();
  await page.getByLabel('Li e aceito a política de reserva').check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByText(/Tempo para pagar/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: `Pagamento de ${formatBRL(10950)}` }),
  ).toBeVisible();
  const code = ((await page.getByText(/^Reserva BRV-/).textContent()) ?? '').replace(
    'Reserva ',
    '',
  );

  // Pay the sinal with Pix in the sandbox and approve it on the hosted test page.
  await page.getByRole('button', { name: `Pagar ${formatBRL(10950)}` }).click();
  await expect(page.getByText('Aguardando o pagamento…')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).click();
  await expect(page.getByRole('heading', { name: 'Pagamento de teste' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar pagamento' }).click();
  await expect(page.getByText('Pagamento aprovado.')).toBeVisible();
  await page.getByRole('link', { name: 'Voltar para a reserva' }).click();

  await expect(page.getByText('Reserva confirmada')).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver minhas reservas' })).toBeVisible();
  expect((await bookingByCode(code))?.status).toBe('confirmed');

  const confirmed = await latestEmail(email, 'booking.confirmed');
  expect(confirmed).not.toBeNull();
  const attachments = confirmed?.attachments as { filename: string; contentBase64: string }[];
  const ics = attachments.find((a) => a.filename.endsWith('.ics'));
  expect(ics).toBeDefined();
  const icsText = Buffer.from(ics?.contentBase64 ?? '', 'base64').toString('utf8');
  expect(icsText).toContain('BEGIN:VCALENDAR');
  expect(icsText).toContain('BEGIN:VEVENT');
});

test('tenant reschedules to a cheaper slot inside the current one and cancels with the preview values', async ({
  page,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const tenant = E2E_TENANTS[project];
  const date = await tenantBookingDate(project);

  await page.goto('/login');
  await login(page, tenant.email, E2E_TENANT_PASSWORD);
  await expect(page).toHaveURL(/\/app/);
  await page.goto('/app/minhas-reservas');
  await page
    .getByRole('link', { name: /Sala Terceira/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/minhas-reservas\/[0-9a-f-]+$/);
  const bookingId = page.url().split('/').pop() ?? '';

  // 14:00–16:00 (16000, all paid) → 14:00–15:00 the same day (9700): credit 6300 (W-ST shape).
  await page.getByRole('button', { name: 'Reagendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reagendar reserva' });
  await pickDay(page, date);
  await dialog
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: '14:00', exact: true })
    .click();
  await dialog
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '1h', exact: true })
    .click();
  await expect(dialog.getByText(`Novo valor da reserva: ${formatBRL(9700)}`)).toBeVisible();
  await expect(dialog.getByText(`Você recebe ${formatBRL(6300)} em créditos`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar reagendamento' }).click();
  await expect(
    page.getByText(`Reserva reagendada. Crédito de ${formatBRL(6300)} registrado.`),
  ).toBeVisible();

  // The cancellation preview the API computes is what the dialog shows (CA-1 after the move).
  const preview = await page.request.get(`/api/app/bookings/${bookingId}/cancellation-preview`);
  expect(preview.ok()).toBe(true);
  expect(await preview.json()).toEqual({
    retainedCents: 8000,
    refundCents: 1700,
    minutesReturned: 0,
    creditCents: 0,
  });
  await page.getByRole('button', { name: 'Cancelar reserva' }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar reserva' });
  await expect(cancel.getByText(`Fica retido: ${formatBRL(8000)} (sinal)`)).toBeVisible();
  await expect(cancel.getByText(`Será devolvido: ${formatBRL(1700)}`)).toBeVisible();
  await cancel.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Cancelada pelo locatário').first()).toBeVisible();
});

test(`availability p95 ≤ 300 ms over 50 calls with ${String(LOAD_BOOKINGS)} bookings in the month`, async ({
  request,
}, testInfo) => {
  const month = loadMonth();
  const api = `http://localhost:${String(E2E_API_PORT)}`;
  const dayUrl = (day: number) =>
    `${api}/public/rooms/principal/availability?date=${month}-${String(day).padStart(2, '0')}`;
  // Warm database: the month view reads every booking of the month once (cold pages on the Neon
  // branch otherwise land in the sample), then a few days open the connection pool.
  expect(
    (await request.get(`${api}/public/rooms/principal/availability/month?month=${month}`)).ok(),
  ).toBe(true);
  for (let day = 1; day <= 3; day++) expect((await request.get(dayUrl(day))).ok()).toBe(true);

  const durations: number[] = [];
  for (let i = 0; i < 50; i++) {
    const started = performance.now();
    const res = await request.get(dayUrl((i % 28) + 1));
    durations.push(performance.now() - started);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { cells: { available: boolean }[] };
    expect(body.cells.length).toBeGreaterThan(0);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(0.95 * durations.length) - 1] ?? Infinity;
  const summary = `availability p95 ${p95.toFixed(0)} ms (median ${(durations[24] ?? 0).toFixed(0)} ms, ${testInfo.project.name})`;
  console.log(summary);
  testInfo.annotations.push({ type: 'availability-p95', description: summary });
  expect(p95).toBeLessThanOrEqual(300);
});
