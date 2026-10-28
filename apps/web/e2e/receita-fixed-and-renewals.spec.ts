import { addDays, formatBRL, localToUtc, type LocalDate } from '@bravo/core';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeE2eDb, E2E_WEB_URL, latestEmail } from '../../api/test/e2e-seed';
import {
  apiFromPage,
  closeReceitaDb,
  loginAdmin,
  nextWeekday,
  occupancyOfPeriod,
  occurrenceStatuses,
  payPixInSandbox,
  periodCharge,
  periodsOf,
  pickDay,
  projectOf,
  roomIdOf,
  runJob,
  signUpTenant,
  startDecliningCards,
  subscriptionOf,
} from './receita-helpers';

// T50 (REC-85, REC-88, REC-150, REC-54): a tenant buys "Meio turno mensal" (Mon–Fri 07:00–09:30):
// Sala Principal is blocked on one date → the conflict is listed with suggestions → the suggested
// Sala Secundária gives 22 occurrences × R$ 280,00 = R$ 6.160,00, paid with a saved card. The
// admin sells "Turno mensal" (07:00–12:00) in Sala Terceira with a payment link to another
// customer, who pays it by Pix. `jobs/cli.ts` then runs rollover/renewals/suspensions on the
// renewal charge day (base + 28, "2026-11-30") and on the next base date (base + 30,
// "2026-12-02"): the tenant's card now declines and the customer's Pix stays unpaid, so both
// subscriptions are "Suspensa" and the next period's "Pré-reservada (renovação)" occurrences are
// released from the admin calendar.

test.afterAll(async () => {
  await closeReceitaDb();
  await closeE2eDb();
});

const MEIO_TURNO = 'Meio turno mensal';
const TURNO = 'Turno mensal';
/** Writes of 22+ occurrence bookings take 30–80 s per action on the Neon branch. */
const SLOW = 180_000;

async function newActor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
  });
  return context.newPage();
}

/** "04/11/2026", as the conflict lines print a date. */
const brDate = (date: LocalDate) => date.split('-').reverse().join('/');

/** 03:00 in São Paulo of `date`: the hour the daily triggers fire (`0 6 * * *` UTC). */
const jobClock = (date: LocalDate) => localToUtc(date, 180);

/** Moves the admin week calendar forward until the column of `date` is on screen. */
async function showWeekOf(admin: Page, date: LocalDate) {
  const column = admin.locator(`[data-date="${date}"]`);
  for (let i = 0; i < 20 && !(await column.isVisible()); i++) {
    await admin.getByRole('button', { name: 'Próxima semana' }).click();
  }
  await expect(column).toBeVisible();
  return column;
}

test('fixed-schedule purchase with a conflict, admin link sale and renewals until suspension', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(1_800_000);
  const project = projectOf(testInfo.project.name);
  // A Monday base (22 weekdays in 30 days, as for 2026-11-02); the mobile run uses a base 9 weeks
  // later so its periods and held renewals never overlap the desktop run's rooms and dates.
  const base = addDays(nextWeekday(1, 3), project === 'desktop' ? 0 : 63);
  const blocked = addDays(base, 2);
  const renewalDay = addDays(base, 28);
  const nextBase = addDays(base, 30);

  // Admin: Sala Principal blocked on the Wednesday of the first week, 07:00–09:30.
  const admin = await newActor(browser);
  await loginAdmin(admin);
  const block = await apiFromPage<{ items: { id: string }[] }>(admin, 'POST', '/admin/blocks', {
    roomIds: [await roomIdOf('principal')],
    tag: 'Manutenção e2e',
    date: blocked,
    startMinute: 420,
    endMinute: 570,
  });
  expect(block.status).toBe(201);

  // Tenant: a saved card with recurring consent, then Meio turno mensal from /precos.
  const tenant = await signUpTenant(page, 'Fixo');
  await page.goto('/app/perfil/cartoes');
  const addCard = page.getByRole('form', { name: 'Adicionar cartão' });
  await addCard.getByLabel('Número do cartão').fill('4242 4242 4242 4242');
  await addCard.getByLabel('Nome impresso no cartão').fill(tenant.name);
  await addCard.getByLabel('Mês').fill('12');
  await addCard.getByLabel('Ano').fill('2030');
  await addCard.getByLabel('CVV').fill('123');
  await addCard.getByLabel(/Autorizo cobranças automáticas/).check();
  await addCard.getByRole('button', { name: 'Adicionar cartão' }).click();
  await expect(addCard.getByText('Cartão salvo.')).toBeVisible();

  await page.goto('/precos');
  await page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: MEIO_TURNO, exact: true }) })
    .filter({ has: page.getByRole('link', { name: 'Assinar' }) })
    .last()
    .getByRole('link', { name: 'Assinar' })
    .click();
  await expect(page.getByRole('heading', { name: `Assinar ${MEIO_TURNO}` })).toBeVisible();

  // REC-84/REC-85: the blocked date is a conflict; the purchase cannot continue from Principal.
  await page.getByRole('radio', { name: 'Sala Principal' }).check();
  await pickDay(page, base);
  await expect(
    page.getByText('Alguns horários não estão disponíveis nesta sala e data de início:'),
  ).toBeVisible();
  await expect(page.getByText(new RegExp(`${brDate(blocked)}:`))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await expect(page.getByText('Que tal tentar:')).toBeVisible();
  await page.getByRole('button', { name: 'Sala Secundária', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Sala Secundária' })).toBeChecked();
  const priceLine = `22 ocorrências × ${formatBRL(28000)} = ${formatBRL(616000)}`;
  await expect(page.getByText(priceLine)).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Resumo: occurrences × price, consents, then the saved card.
  await expect(page.getByText(priceLine)).toBeVisible();
  await expect(page.getByText(formatBRL(616000)).first()).toBeVisible();
  await page.getByLabel(/Li e aceito os/).check();
  await page.getByLabel(/Autorizo a cobrança recorrente/).check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await page.getByRole('radio', { name: 'Visa final 4242' }).check();
  await page.getByRole('button', { name: `Pagar ${formatBRL(616000)}` }).click();
  await expect(page.getByText('Assinatura ativa')).toBeVisible({ timeout: SLOW });

  const fixed = await subscriptionOf(tenant.email, MEIO_TURNO);
  expect(fixed).toMatchObject({ status: 'active', payment_method: 'saved_card' });
  const fixedId = fixed?.id ?? '';
  // REC-88: every occurrence confirmed and one e-mail with one VEVENT per occurrence.
  expect(await occurrenceStatuses(fixedId)).toEqual([{ seq: 1, status: 'confirmed', count: 22 }]);
  const activated = await latestEmail(tenant.email, 'subscription.activated');
  const ics = (activated?.attachments as { filename: string; contentBase64: string }[]).find((a) =>
    a.filename.endsWith('.ics'),
  );
  const icsText = Buffer.from(ics?.contentBase64 ?? '', 'base64').toString('utf8');
  expect(icsText.match(/BEGIN:VEVENT/g)?.length).toBe(22);

  // REC-150: the admin sells Turno mensal in Sala Terceira to another customer with a link.
  const buyer = await newActor(browser);
  const customer = await signUpTenant(buyer, 'Venda');
  await admin.goto('/admin/reservas');
  await admin.getByRole('button', { name: 'Vender assinatura' }).click();
  const sale = admin.getByRole('dialog', { name: 'Vender assinatura' });
  await sale.getByLabel('Buscar cliente').fill(customer.name.split(' ')[1] ?? '');
  await sale
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: new RegExp(customer.email) })
    .click();
  await sale.getByLabel('Categoria').selectOption({ label: TURNO });
  await sale.getByRole('radio', { name: 'Sala Terceira' }).check();
  await pickDay(sale, base);
  const turnoLine = `22 ocorrências × ${formatBRL(50000)} = ${formatBRL(1100000)}`;
  await expect(sale.getByText(turnoLine).first()).toBeVisible();
  await expect(sale.getByLabel('Forma de pagamento')).toHaveValue('link');
  await expect(sale.getByText(formatBRL(1100000)).last()).toBeVisible();
  await sale.getByRole('button', { name: 'Vender assinatura' }).click();
  await expect(admin.getByText('Assinatura criada. Link enviado ao cliente.')).toBeVisible({
    timeout: SLOW,
  });

  const sold = await subscriptionOf(customer.email, TURNO);
  expect(sold?.status).toBe('awaiting_payment');
  const soldId = sold?.id ?? '';
  expect(await occurrenceStatuses(soldId)).toEqual([{ seq: 1, status: 'pre_reserved', count: 22 }]);
  let linkHtml = '';
  await expect
    .poll(async () => {
      linkHtml = (await latestEmail(customer.email, 'subscription.sale_link'))?.html ?? '';
      return linkHtml;
    })
    .toContain(`/app/compras/assinaturas/${soldId}/pagar`);

  // The customer opens the link signed in and pays by Pix in the sandbox.
  await buyer.goto(`/app/compras/assinaturas/${soldId}/pagar`);
  const pay = buyer.getByRole('dialog', { name: 'Pagar assinatura' });
  await expect(pay.getByText(formatBRL(1100000)).first()).toBeVisible();
  await payPixInSandbox(buyer, 1100000, SLOW);
  await expect
    .poll(async () => (await subscriptionOf(customer.email, TURNO))?.status)
    .toBe('active');
  expect(await occurrenceStatuses(soldId)).toEqual([{ seq: 1, status: 'confirmed', count: 22 }]);

  // The tenant's card starts declining before the renewal charge.
  expect(await startDecliningCards(tenant.email)).toBe(1);

  // Renewal charge day (base + 28): the first periods activate and hold the next ones, the
  // renewals charge the declining card and create the customer's Pix.
  await runJob('period-rollover', jobClock(renewalDay));
  await runJob('renewals', jobClock(renewalDay));
  await runJob('suspensions', jobClock(renewalDay));
  expect((await periodsOf(fixedId)).map((p) => p.status)).toEqual(['active', 'awaiting_payment']);
  expect(await periodCharge(fixedId, 2)).toMatchObject({
    method: 'saved_card',
    status: 'rejected',
  });
  expect(await periodCharge(soldId, 2)).toMatchObject({ method: 'pix', status: 'pending' });
  const held = (await occurrenceStatuses(fixedId)).find((r) => r.seq === 2);
  expect(held?.status).toBe('held_for_renewal');
  expect(held?.count ?? 0).toBeGreaterThan(0);
  expect(await occupancyOfPeriod(fixedId, 2)).toBe(held?.count);
  expect((await subscriptionOf(tenant.email, MEIO_TURNO))?.status).toBe('active');

  // Admin calendar, Sala Secundária: the next base date shows the held renewal occurrence.
  await admin.goto('/admin/reservas');
  await admin.getByLabel('Sala', { exact: true }).selectOption({ label: 'Sala Secundária' });
  const title = `${tenant.name.split(' ')[0] ?? ''} · Sala Secundária`;
  const column = await showWeekOf(admin, nextBase);
  const heldEvent = column.getByRole('button', { name: `${title}, 07:00–09:30` });
  await heldEvent.hover({ timeout: 60_000 });
  await expect(
    admin.getByRole('dialog', { name: title }).getByText('Pré-reservada (renovação)'),
  ).toBeVisible();

  // Next base date (base + 30): still unpaid → suspended, held occurrences released (REC-54).
  await runJob('renewals', jobClock(nextBase));
  await runJob('period-rollover', jobClock(nextBase));
  await runJob('suspensions', jobClock(nextBase));
  expect((await subscriptionOf(tenant.email, MEIO_TURNO))?.status).toBe('suspended');
  expect((await subscriptionOf(customer.email, TURNO))?.status).toBe('suspended');
  expect((await periodsOf(fixedId)).map((p) => p.status)).toEqual(['closed', 'awaiting_payment']);
  expect((await occurrenceStatuses(fixedId)).find((r) => r.seq === 2)?.status).toBe('expired');
  expect(await occupancyOfPeriod(fixedId, 2)).toBe(0);
  expect(await occupancyOfPeriod(soldId, 2)).toBe(0);

  await admin.reload();
  await admin.getByLabel('Sala', { exact: true }).selectOption({ label: 'Sala Secundária' });
  const after = await showWeekOf(admin, nextBase);
  await expect(after.getByRole('button', { name: `${title}, 07:00–09:30` })).toHaveCount(0);

  // Gestão de Reservas → Assinaturas: both subscriptions are "Suspensa".
  await admin.goto('/admin/reservas/assinaturas');
  const list = admin.getByRole('region', { name: 'Assinaturas' });
  for (const [person, category] of [
    [tenant.name, MEIO_TURNO],
    [customer.name, TURNO],
  ] as const) {
    await list.getByLabel('Buscar cliente').fill(person);
    const row = list.getByRole('row').filter({ hasText: person });
    await expect(row.getByText(category)).toBeVisible();
    await expect(row.getByText('Suspensa', { exact: true })).toBeVisible();
  }

  await admin.context().close();
  await buyer.context().close();
});
