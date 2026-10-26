import { addDays, utcToLocal } from '@bravo/core';
import { expect, test } from '@playwright/test';
import {
  adminTotp,
  bookingByCode,
  closeE2eDb,
  E2E_ADMIN,
  E2E_CUSTOMERS,
  type E2eProject,
} from '../../api/test/e2e-seed';

// Spec Success Criteria (T49): the admin creates a pre-reservation, confirms it manually and
// checks the customer in (check-in opens 1 h before the start, so the booking starts soon).

test.afterAll(async () => {
  await closeE2eDb();
});

const projectOf = (name: string): E2eProject => (name === 'mobile' ? 'mobile' : 'desktop');
const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** The next 30-min boundary in São Paulo with a full hour before midnight (else 00:00 tomorrow). */
function nextSlot(now = new Date()) {
  const local = utcToLocal(now);
  const start = Math.ceil((local.minuteOfDay + 1) / 30) * 30;
  if (start + 60 > 1440) return { date: addDays(local.date, 1), start: 0 };
  return { date: local.date, start };
}

test('admin creates a pre-reservation, confirms it manually and checks the customer in', async ({
  page,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const customer = E2E_CUSTOMERS[project];
  const room = project === 'desktop' ? 'Sala Secundária' : 'Sala Terceira';
  const slot = nextSlot();

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(E2E_ADMIN.email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/login\/2fa/);
  await page.getByLabel('Código de verificação').fill(adminTotp());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/admin/);

  await page.goto('/admin/reservas');
  await expect(page.getByRole('heading', { name: 'Gestão de Reservas' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar pré-reserva' }).click();
  const drawer = page.getByRole('dialog', { name: 'Criar pré-reserva' });
  await drawer.getByLabel('Buscar cliente').fill(customer.name.split(' ')[0] ?? '');
  await drawer
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: new RegExp(customer.email) })
    .click();
  await drawer.getByLabel('Sala').selectOption({ label: room });
  await drawer.getByLabel('Data').fill(slot.date);
  await drawer.getByLabel('Início').fill(hhmm(slot.start));
  await drawer.getByLabel('Início').press('Enter');
  await drawer.getByLabel('Fim').fill(hhmm(slot.start + 60));
  await drawer.getByLabel('Fim').press('Enter');
  await expect(drawer.getByText(/Total/).first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Criar pré-reserva' }).click();
  await expect(drawer.getByText(/Pré-reserva criada\./)).toBeVisible();
  await expect(drawer.getByLabel('Link de pagamento')).toHaveValue(/\/pre-reserva\//);
  await drawer.getByRole('button', { name: 'Fechar' }).filter({ hasText: 'Fechar' }).click();

  // The booking in the calendar of its room: confirm without payment, then check in.
  await page.getByLabel('Sala', { exact: true }).selectOption({ label: room });
  const title = `${customer.name.split(' ')[0] ?? ''} · ${room}`;
  const event = page.getByRole('button', { name: new RegExp(`^${title}, `) });
  await event.first().click();
  const popup = page.getByRole('dialog', { name: title });
  const code = /BRV-[A-Z2-7]{6}/.exec((await popup.textContent()) ?? '')?.[0] ?? '';
  expect(code).not.toBe('');
  expect((await bookingByCode(code))?.status).toBe('pre_reserved');
  await popup.getByRole('button', { name: 'Confirmar', exact: true }).click();

  const confirm = page.getByRole('dialog', { name: 'Confirmar reserva' });
  await confirm.getByLabel('Justificativa').fill('Pagamento combinado no balcão');
  await confirm.getByRole('button', { name: 'Confirmar sem pagamento' }).click();
  await expect.poll(async () => (await bookingByCode(code))?.status).toBe('confirmed');

  await event.first().click();
  const confirmedPopup = page.getByRole('dialog', { name: title });
  await confirmedPopup.getByRole('button', { name: 'Check-in' }).click();
  await expect.poll(async () => (await bookingByCode(code))?.checked_in_at ?? null).not.toBeNull();
  const stored = await bookingByCode(code);
  expect(stored?.confirmed_manually_by).not.toBeNull();
});
