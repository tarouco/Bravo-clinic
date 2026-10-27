import { NOTIFICATION_EVENTS, notificationCatalog } from '@bravo/core';
import { describe, expect, it } from 'vitest';
import {
  GESTAO_TEMPLATES,
  accountDeletedTemplate,
  cardReregisterTemplate,
  quoteReceivedTemplate,
  renderStaffEmail,
  staffBookingCancelledTemplate,
  staffHolidayReviewTemplate,
  staffInviteTemplate,
  staffNewBookingTemplate,
  staffNewQuoteRequestTemplate,
  staffNewSubscriptionTemplate,
  staffPaymentIssueTemplate,
  staffPaymentReceivedTemplate,
  staffPreReservationExpiredTemplate,
  staffRenewalFailedTemplate,
  systemTestTemplate,
  type StaffTemplate,
} from './gestao';
import type { Rendered } from './layout';

const env = { APP_BASE_URL: 'https://bravo.example' };
// 10:00 in São Paulo (UTC-3) on Tuesday 2026-10-27.
const booking = {
  customerName: 'Ana Souza Lima',
  roomName: 'Sala Principal',
  startsAt: new Date('2026-10-27T13:00:00.000Z'),
  code: 'BRV-ABC123',
};

const rendered: Record<string, Rendered> = {
  'staff.new_booking': staffNewBookingTemplate(booking, env),
  'staff.payment_received': staffPaymentReceivedTemplate(
    { customerName: 'Ana Souza', amountCents: 21_900, description: 'Reserva BRV-ABC123' },
    env,
  ),
  'staff.booking_cancelled': staffBookingCancelledTemplate(booking, env),
  'staff.new_subscription': staffNewSubscriptionTemplate(
    { customerName: 'Ana Souza', categoryName: 'Pacote 20h mensal', startsOn: '2026-11-02' },
    env,
  ),
  'staff.renewal_failed': staffRenewalFailedTemplate(
    { customerName: 'Ana Souza', categoryName: 'Pacote 20h mensal', amountCents: 160_000 },
    env,
  ),
  'staff.pre_reservation_expired': staffPreReservationExpiredTemplate(booking, env),
  'staff.new_quote_request': staffNewQuoteRequestTemplate(
    {
      requesterName: 'Bruno Alves',
      serviceName: 'Videomaker',
      phone: '+5547999990000',
      desiredOn: '2026-11-15',
    },
    env,
  ),
  'staff.payment_issue': staffPaymentIssueTemplate(
    { reason: 'charged_back', reference: 'ch_123' },
    env,
  ),
  'staff.holiday_review': staffHolidayReviewTemplate(
    { holidays: [{ date: '2027-08-15', name: 'Assunção de Nossa Senhora' }] },
    env,
  ),
  'staff.invite': staffInviteTemplate(
    { name: 'Carla Dias', roleLabel: 'Recepção', token: 'tok_abc' },
    env,
  ),
  'quote.received': quoteReceivedTemplate({ name: 'Bruno Alves', serviceName: 'Videomaker' }, env),
  'privacy.account_deleted': accountDeletedTemplate({ name: 'Ana Souza' }, env),
  'subscription.card_reregister': cardReregisterTemplate(
    { name: 'Ana Souza', categoryName: 'Pacote 20h mensal' },
    env,
  ),
  'system.test': systemTestTemplate({}, env),
};

const EMOJI = /\p{Extended_Pictographic}/u;
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
const urlsOf = (text: string) => text.match(/https?:\/\/\S+/g) ?? [];

describe('gestao e-mail templates (GES-73)', () => {
  it('has one template for every gestao-owned catalog event', () => {
    const owned = NOTIFICATION_EVENTS.filter((e) => notificationCatalog[e].owner === 'gestao');
    expect([...GESTAO_TEMPLATES].sort()).toEqual([...owned].sort());
    expect(Object.keys(rendered).sort()).toEqual([...owned].sort());
  });

  it.each([...GESTAO_TEMPLATES])(
    '%s has a non-empty subject, html and text with absolute links on APP_BASE_URL',
    (name) => {
      const mail = rendered[name];
      expect(mail?.subject.trim()).not.toBe('');
      expect(mail?.html).toContain('<!doctype html>');
      expect(mail?.text.trim()).not.toBe('');
      const links = [...hrefsOf(mail?.html ?? ''), ...urlsOf(mail?.text ?? '')];
      expect(links.length).toBeGreaterThan(0);
      for (const href of links) expect(href.startsWith('https://bravo.example/'), href).toBe(true);
    },
  );

  it('contains no emoji in any subject, html or text', () => {
    for (const [name, mail] of Object.entries(rendered)) {
      expect(EMOJI.test(mail.subject + mail.html + mail.text), name).toBe(false);
    }
  });

  it('staff.new_booking names the customer by first name, the room, local date/time and code', () => {
    const mail = rendered['staff.new_booking'];
    for (const value of ['Ana', 'Sala Principal', '27/10/2026', '10:00', 'BRV-ABC123']) {
      expect(mail?.text).toContain(value);
    }
    expect(mail?.text).not.toContain('Souza');
    expect(mail?.subject).toBe('Nova reserva BRV-ABC123: Sala Principal, 27/10/2026 às 10:00');
  });

  it('staff.invite carries the set-password link with the token', () => {
    const mail = rendered['staff.invite'];
    expect(mail?.text).toContain('https://bravo.example/redefinir-senha?token=tok_abc');
    expect(mail?.html).toContain('href="https://bravo.example/redefinir-senha?token=tok_abc"');
  });

  it('escapes user input in the html', () => {
    const mail = staffNewQuoteRequestTemplate(
      { requesterName: '<script>x</script>', serviceName: 'Videomaker', phone: '1' },
      env,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('renderStaffEmail (GES-67)', () => {
  const STAFF = GESTAO_TEMPLATES.filter((t): t is StaffTemplate => t.startsWith('staff.'));

  it('renders every staff template from the loose event data', () => {
    const data = {
      entityId: 'b1',
      ...booking,
      amountCents: 21_900,
      categoryName: 'Pacote 20h mensal',
      serviceName: 'Videomaker',
      requesterName: 'Bruno',
      phone: '+5547999990000',
      reason: 'amount_mismatch',
      name: 'Carla',
      token: 'tok',
    };
    for (const template of STAFF) {
      const mail = renderStaffEmail(template, data, env);
      expect(mail.subject.trim(), template).not.toBe('');
      expect(EMOJI.test(mail.subject + mail.text), template).toBe(false);
    }
    expect(renderStaffEmail('staff.new_booking', data, env).subject).toBe(
      rendered['staff.new_booking']?.subject,
    );
  });

  it('falls back to neutral text when the caller passes only the entity id', () => {
    const mail = renderStaffEmail('staff.payment_issue', { entityId: 'ch_9' }, env);
    expect(mail.text).toContain('ch_9');
    expect(mail.text).toContain('verificação manual');
  });
});
