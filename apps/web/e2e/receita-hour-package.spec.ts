import { formatBRL } from '@bravo/core';
import { expect, test } from '@playwright/test';
import { bookableWeekday, closeE2eDb } from '../../api/test/e2e-seed';
import {
  bookingDetails,
  closeReceitaDb,
  payPixInSandbox,
  pickDay,
  projectOf,
  signUpTenant,
  subscriptionOf,
} from './receita-helpers';

// T48 (REC-14, REC-16, REC-24, REC-29, REC-41, REC-63, REC-66): a new tenant buys "Pacote 20h
// mensal" on the phone (≤ 4 steps, sandbox Pix), sees 20h in Compras, books Wed 19:00–20:00 with
// the package (78 min: 60 + 18 de excedente), finds the formula in the extrato and buys 5 extra
// hours at V_pac (5 × R$ 80,00 = R$ 400,00).

test.afterAll(async () => {
  await closeReceitaDb();
  await closeE2eDb();
});

const PACKAGE = 'Pacote 20h mensal';

test('tenant buys Pacote 20h, books Wed 19:00–20:00 with it and buys 5 extra hours', async ({
  page,
}, testInfo) => {
  // Eight API round trips per screen on the Neon branch: the whole purchase-to-extras flow is long.
  test.setTimeout(600_000);
  const project = projectOf(testInfo.project.name);
  // The phone of the success criterion; the desktop project runs the same flow full width.
  if (project === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
  // Each project books its own Wednesday (inside the 30-day period that starts today).
  const wednesday = await bookableWeekday([3], 2, project === 'desktop' ? 0 : 1);

  const tenant = await signUpTenant(page, 'Pacotista');

  // /precos → Assinar on the Pacote 20h mensal card.
  await page.goto('/precos');
  await expect(page.getByRole('heading', { name: 'Pacotes e assinaturas' })).toBeVisible();
  const card = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: PACKAGE, exact: true }) })
    .filter({ has: page.getByRole('link', { name: 'Assinar' }) })
    .last();
  await expect(card.getByText(formatBRL(160000))).toBeVisible();
  await expect(card.getByText(`${formatBRL(8000)}/h`)).toBeVisible();
  await card.getByRole('link', { name: 'Assinar' }).click();

  // The purchase: Resumo → (Login, already signed in) → Pagamento; never more than 4 steps.
  await expect(page.getByRole('heading', { name: `Assinar ${PACKAGE}` })).toBeVisible();
  const steps = page
    .getByRole('navigation', { name: 'Etapas da assinatura' })
    .getByRole('listitem');
  expect(await steps.count()).toBeLessThanOrEqual(4);
  await expect(page.getByText(formatBRL(160000)).first()).toBeVisible();
  await page.getByLabel(/Li e aceito os/).check();
  await page.getByLabel(/Autorizo a cobrança recorrente/).check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await expect(
    page.getByRole('heading', { name: `Pagamento de ${formatBRL(160000)}` }),
  ).toBeVisible();

  // REC-14: the purchase creates an awaiting subscription with a Pix charge; REC-16: approval
  // activates it with the 20 h granted (the period starts today).
  await payPixInSandbox(page, 160000);
  await expect
    .poll(async () => (await subscriptionOf(tenant.email, PACKAGE))?.status)
    .toBe('active');

  await page.goto('/app/compras');
  const subscription = page.getByRole('heading', { name: PACKAGE, exact: true });
  await expect(subscription).toBeVisible();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(page.getByText('20h de 20h')).toBeVisible();

  // Book Wed 19:00–20:00 with the package: "vai debitar 78 min" before confirming (REC-24).
  await page.goto('/reservar');
  await page.getByRole('radio', { name: /Sala Secundária/ }).check();
  await pickDay(page, wednesday);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: /^19:00/ })
    .click();
  await page
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '1h', exact: true })
    .click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Esta reserva vai debitar 78 min do seu pacote')).toBeVisible();
  await page.getByRole('radio', { name: 'Pagar com meu pacote' }).check();
  await expect(page.getByRole('radio', { name: 'Pagar com meu pacote' })).toBeChecked();
  await expect(page.getByText('Esta reserva vai debitar 78 min do seu pacote')).toBeVisible();
  await page.getByLabel('Li e aceito a política de reserva').check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByText('Reserva confirmada')).toBeVisible();
  const code = /BRV-[A-Z2-7]{6}/.exec((await page.locator('body').textContent()) ?? '')?.[0] ?? '';
  expect(code).not.toBe('');

  // REC-29: confirmed in the same transaction, nothing charged, 78 package minutes debited.
  expect(await bookingDetails(code)).toMatchObject({
    status: 'confirmed',
    payment_mode: 'package',
    total_cents: 0,
    discount_source: 'none',
    package_minutes_debited: 78,
  });

  // REC-41: the extrato shows the debit with its formula and the new balance.
  await page.goto('/app/compras');
  await expect(page.getByText('18h 42min de 20h')).toBeVisible();
  await page.getByRole('button', { name: 'Extrato' }).click();
  const ledger = page.getByRole('table', { name: 'Extrato de minutos' });
  const debit = ledger.getByRole('row').filter({ hasText: code });
  await expect(debit.getByText('60 min + 18 min de excedente = 78 min')).toBeVisible();
  await expect(debit.getByText('−78 min')).toBeVisible();
  await expect(debit.getByText('1.122 min')).toBeVisible();
  await expect(
    ledger.getByRole('row').filter({ hasText: 'Compra' }).getByText('+1.200 min'),
  ).toBeVisible();

  // REC-63: 5 extra hours at V_pac = R$ 80,00 → R$ 400,00; REC-66: approval creates the 300-min lot.
  await page.getByRole('tab', { name: 'Horas extras' }).click();
  await expect(page).toHaveURL(/\/app\/compras\/horas-extras$/);
  await expect(page.getByRole('heading', { name: 'Comprar horas extras' })).toBeVisible();
  const increase = page.getByRole('button', { name: 'Aumentar uma hora' });
  const quantity = page.getByRole('group', { name: 'Quantidade de horas' }).locator('output');
  while ((await quantity.textContent()) !== '5 horas') await increase.click();
  await expect(page.getByText(`5 × ${formatBRL(8000)} = ${formatBRL(40000)}`)).toBeVisible();
  await payPixInSandbox(page, 40000);

  await page.goto('/app/compras/horas-extras');
  await expect(page.getByText(/^300 min · vence em \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByText('Horas extras compradas', { exact: true })).toBeVisible();
  await page.goto('/app/compras');
  await expect(page.getByText('Horas extras: 5h')).toBeVisible();
});
