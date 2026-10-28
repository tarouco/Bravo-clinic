import { formatBRL } from '@bravo/core';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { bookableWeekday, closeE2eDb, E2E_WEB_URL } from '../../api/test/e2e-seed';
import {
  apiFromPage,
  bookingDetails,
  closeReceitaDb,
  couponByCode,
  loginAdmin,
  payPixInSandbox,
  pickDay,
  projectOf,
  runTag,
  signUpTenant,
  userIdOf,
} from './receita-helpers';

// T49 (REC-120, REC-121, REC-122, REC-123, REC-136): the admin creates a R$ 20,00 coupon limited
// to one use and a 10% slot discount on Tue 14:00–16:00 (Sala Secundária and Sala Principal); a
// tenant books Secundária 14:00–16:00 with the coupon → the larger discount wins (coupon 2000 over
// slot 1600) and the deposit is R$ 70,00; a second tenant sees "−10%" on the Principal grid, gets
// "Cupom esgotado" and pays with the slot discount and the credits the admin granted.

test.afterAll(async () => {
  await closeReceitaDb();
  await closeE2eDb();
});

/** A second signed-in actor: same app settings as the project's own context. */
async function newActor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
  });
  return context.newPage();
}

/** Sala → day → 14:00 for 2h on the public booking flow, up to the Resumo. */
async function chooseTuesdayAfternoon(page: Page, room: RegExp, date: string) {
  await page.goto('/reservar');
  await page.getByRole('radio', { name: room }).check();
  await pickDay(page, date);
  await page.getByRole('button', { name: 'Continuar' }).click();
}

test('coupon vs slot discount in checkout, last coupon use and credits', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const project = projectOf(testInfo.project.name);
  // The nucleo booking flow books 17:30 on these Tuesdays; 14:00–16:00 (+30 min cleanup) is free.
  const tuesday = await bookableWeekday([2], 3, project === 'desktop' ? 0 : 1);
  const code = `E2E20${runTag()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')}`;

  // Admin: coupon R$ 20,00, bookings only, one use in total (REC-123).
  const admin = await newActor(browser);
  await loginAdmin(admin);
  await admin.goto('/admin/cupons');
  await admin.getByRole('button', { name: 'Novo cupom' }).click();
  const form = admin.getByRole('dialog', { name: 'Novo cupom' });
  await form.getByLabel('Código').fill(code);
  await form.getByLabel('Tipo').selectOption('discount');
  await form.getByLabel('Vale para').selectOption('bookings');
  await form.getByLabel('Forma do desconto').selectOption('fixed');
  await form.getByLabel('Valor do desconto').fill('20,00');
  await form.getByLabel('Limitar o total de usos').check();
  await form.getByLabel('Máximo de usos').fill('1');
  await form.getByRole('button', { name: 'Salvar cupom' }).click();
  await expect(form).toBeHidden();
  await expect(admin.getByText(code, { exact: true })).toBeVisible();
  expect(await couponByCode(code)).toEqual({ uses_count: 0, max_uses: 1 });

  // Admin: 10% on Tuesday 14:00–16:00 in Secundária and Principal, from a free slot of the calendar.
  await admin.goto('/admin/reservas');
  await admin.getByLabel('Sala', { exact: true }).selectOption({ label: 'Sala Secundária' });
  const column = admin.locator(`[data-date="${tuesday}"]`);
  for (let i = 0; i < 3 && !(await column.isVisible()); i++) {
    await admin.getByRole('button', { name: 'Próxima semana' }).click();
  }
  await column.getByRole('button', { name: 'Horário livre 14:00–14:30' }).hover();
  await admin.getByRole('menuitem', { name: 'Aplicar desconto (%)' }).click();
  const discount = admin.getByRole('dialog', { name: 'Aplicar desconto (%)' });
  await expect(discount.getByLabel('Sala Secundária')).toBeChecked();
  await discount.getByLabel('Sala Principal').check();
  await expect(discount.getByLabel('Data')).toHaveValue(tuesday);
  await discount.getByLabel('Fim').fill('16:00');
  await discount.getByLabel('Fim').press('Enter');
  await discount.getByLabel('Desconto (%)').fill('10');
  await discount.getByRole('button', { name: 'Aplicar desconto' }).click();
  const applied = admin.getByRole('dialog', { name: 'Desconto aplicado' });
  await expect(applied.getByText('2 faixas de horário com desconto de 10%.')).toBeVisible();
  await applied.getByRole('button', { name: 'Fechar' }).filter({ hasText: 'Fechar' }).click();
  await expect(column.getByText('−10%').first()).toBeVisible();

  // Tenant 1: Secundária 14:00–16:00 (16000) with the coupon → coupon wins (REC-120, REC-121),
  // deposit on the net 14000 (REC-122).
  const first = await signUpTenant(page, 'Cupom');
  await chooseTuesdayAfternoon(page, /Sala Secundária/, tuesday);
  await page
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: /^14:00\s*−10%$/ })
    .click();
  await page
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '2h', exact: true })
    .click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText(formatBRL(16000)).first()).toBeVisible();
  await page.getByLabel('Cupom de desconto').fill(code);
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText(`Cupom ${code} aplicado: − ${formatBRL(2000)}`)).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Cupom' })
      .getByText(
        `Aplicamos o maior desconto: cupom ${formatBRL(2000)} (o desconto do horário era ${formatBRL(1600)}).`,
      ),
  ).toBeVisible();
  await expect(page.getByText(formatBRL(14000)).first()).toBeVisible();
  await expect(page.getByText(formatBRL(7000)).first()).toBeVisible();
  await page.getByLabel('Li e aceito a política de reserva').check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(
    page.getByRole('heading', { name: `Pagamento de ${formatBRL(7000)}` }),
  ).toBeVisible();
  const bookingCode = ((await page.getByText(/^Reserva BRV-/).textContent()) ?? '').replace(
    'Reserva ',
    '',
  );
  // The checkout reserved the only use: the counter is full before the payment.
  expect(await couponByCode(code)).toEqual({ uses_count: 1, max_uses: 1 });
  await payPixInSandbox(page, 7000);
  await page.getByRole('link', { name: 'Voltar para a reserva' }).click();
  await expect(page.getByText('Reserva confirmada')).toBeVisible();
  expect(await bookingDetails(bookingCode)).toMatchObject({
    status: 'confirmed',
    discount_source: 'coupon',
    discount_cents: 2000,
    total_cents: 14000,
    deposit_cents: 7000,
  });

  // Tenant 2 has R$ 30,00 of credit granted by the admin.
  const tenant = await newActor(browser);
  const second = await signUpTenant(tenant, 'Esgotado');
  const granted = await apiFromPage<{ lot: { amountCents: number } }>(
    admin,
    'POST',
    `/admin/customers/${await userIdOf(second.email)}/credits`,
    { amountCents: 3000, justification: 'Cortesia do teste de descontos' },
  );
  expect(granted.status).toBe(201);
  expect(first.email).not.toBe(second.email);

  // The public grid of Principal still marks the discounted slots (REC-136); 16:00 is outside.
  await chooseTuesdayAfternoon(tenant, /Sala Principal/, tuesday);
  const starts = tenant.getByRole('list', { name: 'Horários de início' });
  await expect(starts.getByRole('button', { name: /^14:00\s*−10%$/ })).toBeVisible();
  await expect(starts.getByRole('button', { name: /^15:30\s*−10%$/ })).toBeVisible();
  await expect(starts.getByRole('button', { name: '16:00', exact: true })).toBeVisible();
  await starts.getByRole('button', { name: /^14:00/ }).click();
  await tenant
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '2h', exact: true })
    .click();
  await tenant.getByRole('button', { name: 'Continuar' }).click();

  // The last use is gone (REC-123): the slot discount stays, 16000 − 1600 → deposit 7200.
  await tenant.getByLabel('Cupom de desconto').fill(code);
  await tenant.getByRole('button', { name: 'Aplicar' }).click();
  await expect(tenant.getByText('Cupom esgotado')).toBeVisible();
  await expect(tenant.getByText(formatBRL(14400)).first()).toBeVisible();
  await expect(tenant.getByText(formatBRL(7200)).first()).toBeVisible();
  await tenant.getByLabel(`Usar créditos (${formatBRL(3000)} disponíveis)`).check();
  await expect(tenant.getByText(`Créditos aplicados: − ${formatBRL(3000)}`)).toBeVisible();
  expect(await couponByCode(code)).toEqual({ uses_count: 1, max_uses: 1 });

  await admin.context().close();
  await tenant.context().close();
});
