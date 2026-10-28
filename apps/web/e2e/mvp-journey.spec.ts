import { localToUtc } from '@bravo/core';
import { expect, test } from '@playwright/test';
import { bookableWeekday, closeE2eDb, cpf, latestEmail } from '../../api/test/e2e-seed';
import {
  bookingCalendar,
  closeHelpersDb,
  icsAttachmentOf,
  outboxEmails,
  type OutboxEmail,
} from './helpers/db';
import { icsUtc, parseIcs } from './helpers/ics';
import { closeReceitaDb, pickDay, runTag } from './receita-helpers';

// GES-140 / GES-49 (gestao T45): on a 390×844 phone a visitor opens /salas, opens Sala Terceira,
// picks Friday 16:00–17:00, signs up, accepts the policy and pays the sinal in the sandbox; the
// booking is "Confirmada", the confirmation e-mail carries an .ics whose UID is the booking's
// ics_uid; a reschedule to the next Friday sends a new .ics with the same UID and SEQUENCE + 1,
// and the personal calendar feed shows the new start.

test.afterAll(async () => {
  await closeHelpersDb();
  await closeReceitaDb();
  await closeE2eDb();
});

const START_MINUTE = 16 * 60;
const END_MINUTE = 17 * 60;

/** Waits for the outbox to hold `count` rows of a template and returns them, oldest first. */
async function emailsWhen(to: string, template: string, count: number): Promise<OutboxEmail[]> {
  let rows: OutboxEmail[] = [];
  await expect
    .poll(async () => {
      rows = await outboxEmails(to, template);
      return rows.length;
    })
    .toBe(count);
  return rows;
}

test('visitor books on a phone, pays in the sandbox and keeps one calendar event across a reschedule', async ({
  page,
}) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  // Fridays 15+ days ahead, outside every other spec's dates, so weekday prices apply.
  const firstDate = await bookableWeekday([5], 15, 0);
  const newDate = await bookableWeekday([5], 15, 1);
  const email = `jornada-${runTag()}@bravoclinic.test`;

  // /salas → Sala Terceira.
  await page.goto('/salas');
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Sala Terceira' }) })
    .getByRole('button', { name: 'Reservar Sala' })
    .click();
  await expect(page).toHaveURL(/\/salas\/terceira$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sala Terceira' })).toBeVisible();

  // The slot, picked on the room's availability calendar.
  await pickDay(page, firstDate);
  await page
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: '16:00', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '1h', exact: true })
    .click();
  await page.getByRole('link', { name: 'Reservar este horário' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/reservar\\?sala=terceira&data=${firstDate}&inicio=${String(START_MINUTE)}&fim=${String(END_MINUTE)}`,
    ),
  );
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/etapa=resumo/);
  const resumoUrl = page.url();
  await page.getByLabel('Li e aceito a política de reserva').check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();

  // Anonymous: login → sign-up, back to the Resumo, then the e-mail confirmation.
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastro\?next=/);
  await page.getByLabel('Nome completo').fill(`Jornada ${runTag()}`);
  await page.getByLabel('CPF ou CNPJ').fill(cpf(90_000 + Math.floor(Math.random() * 9_000)));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Telefone').fill('(11) 98765-4321');
  await page.getByLabel('Senha', { exact: true }).fill('JornadaE2e2026');
  await page.getByLabel(/Termos de uso/).check();
  await page.getByLabel(/Política de privacidade/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/etapa=resumo/);
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

  // Accept the policy and create the booking.
  await page.goto(resumoUrl);
  await page.getByLabel('Li e aceito a política de reserva').check();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/);
  const bookingId = page.url().split('/').pop() ?? '';

  // Pay the sinal with Pix and approve it on the sandbox page.
  const heading = page.getByRole('heading', { name: /^Pagamento de / });
  const amount = ((await heading.textContent()) ?? '').replace('Pagamento de ', '').trim();
  await page.getByRole('button', { name: `Pagar ${amount}` }).click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).click();
  await expect(page.getByRole('heading', { name: 'Pagamento de teste' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar pagamento' }).click();
  await expect(page.getByText('Pagamento aprovado.')).toBeVisible();
  await page.getByRole('link', { name: 'Voltar para a reserva' }).click();
  await expect(page.getByText('Reserva confirmada')).toBeVisible();

  await page.goto(`/app/minhas-reservas/${bookingId}`);
  await expect(page.getByText('Confirmada', { exact: true })).toBeVisible();
  const booked = await bookingCalendar(bookingId);
  expect(booked.status).toBe('confirmed');
  expect(booked.ics_sequence).toBe(0);

  // The confirmation e-mail's .ics: UID = ics_uid, SEQUENCE 0, the booked start.
  const [confirmed] = await emailsWhen(email, 'booking.confirmed', 1);
  const confirmedIcs = parseIcs(icsAttachmentOf(confirmed as OutboxEmail));
  expect(confirmedIcs.events).toHaveLength(1);
  expect(confirmedIcs.events[0]).toMatchObject({
    UID: booked.ics_uid,
    SEQUENCE: '0',
    DTSTART: icsUtc(localToUtc(firstDate, START_MINUTE)),
    DTEND: icsUtc(localToUtc(firstDate, END_MINUTE)),
  });

  // Reschedule to the same time the next Friday: same price, nothing to pay.
  await page.getByRole('button', { name: 'Reagendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reagendar reserva' });
  await pickDay(dialog, newDate);
  await dialog
    .getByRole('list', { name: 'Horários de início' })
    .getByRole('button', { name: '16:00', exact: true })
    .click();
  await dialog
    .getByRole('group', { name: 'Duração' })
    .getByRole('button', { name: '1h', exact: true })
    .click();
  await expect(dialog.getByText('O valor da reserva não muda.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar reagendamento' }).click();
  await expect(page.getByText('Reserva reagendada.')).toBeVisible();

  const moved = await bookingCalendar(bookingId);
  const newStart = icsUtc(localToUtc(newDate, START_MINUTE));
  expect(moved.ics_uid).toBe(booked.ics_uid);
  expect(moved.ics_sequence).toBe(1);
  expect(icsUtc(moved.starts_at)).toBe(newStart);

  // The reschedule e-mail's .ics: same UID, SEQUENCE + 1, the new start.
  const [rescheduled] = await emailsWhen(email, 'booking.rescheduled', 1);
  const rescheduledIcs = parseIcs(icsAttachmentOf(rescheduled as OutboxEmail));
  expect(rescheduledIcs.events).toHaveLength(1);
  expect(rescheduledIcs.events[0]).toMatchObject({
    UID: booked.ics_uid,
    SEQUENCE: '1',
    DTSTART: newStart,
    DTEND: icsUtc(localToUtc(newDate, END_MINUTE)),
  });

  // The personal feed (GES-45, GES-49) has the event once, at the new start.
  await page.goto('/app/agenda');
  await page.getByRole('button', { name: 'Gerar link da agenda' }).click();
  const feedUrl = await page.getByLabel('Link da sua agenda').inputValue();
  expect(feedUrl).toMatch(/\/api\/ics\/[A-Za-z0-9_-]+\.ics$/);
  const feed = await page.request.get(new URL(feedUrl).pathname);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  const events = parseIcs(await feed.text()).events.filter((e) => e['UID'] === booked.ics_uid);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    SEQUENCE: '1',
    DTSTART: newStart,
    SUMMARY: 'Bravô Clinic · Sala Terceira',
  });
});
