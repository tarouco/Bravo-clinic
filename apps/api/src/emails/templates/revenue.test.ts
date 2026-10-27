import { describe, expect, it } from 'vitest';
import { revenueMailer } from '../../modules/subscriptions/revenue-mailer';
import type { Rendered } from './layout';
import {
  REVENUE_TEMPLATES,
  cancelledTemplate,
  compensationTemplate,
  creditGrantedTemplate,
  endedTemplate,
  extraHoursPurchasedTemplate,
  lateRefundTemplate,
  nextPeriodConflictsTemplate,
  periodEndingTemplate,
  priceChangeTemplate,
  renewalApprovedTemplate,
  renewalChargeTemplate,
  renewalFailedTemplate,
  renewalReminderTemplate,
  saleLinkTemplate,
  subscriptionActivatedTemplate,
  suspendedTemplate,
  switchedTemplate,
} from './revenue';

const LINK = 'http://localhost:5173/app/compras';
const base = { name: 'Ana Souza', categoryName: 'Pacote 20h mensal', link: LINK };
const PIX = '00020126580014BR.GOV.BCB.PIX0136bravo-sandbox-pix5204000053039865802BR';

// Every REC-159 template with the values of the spec examples.
const rendered: Record<string, Rendered> = {
  'subscription.activated': subscriptionActivatedTemplate({
    ...base,
    categoryName: 'Meio turno mensal',
    startsOn: '2026-11-02',
    endsOn: '2026-12-02',
    priceCents: 616_000,
    roomName: 'Sala Principal',
    occurrences: [
      { startsAt: new Date('2026-11-02T10:00:00Z'), endsAt: new Date('2026-11-02T12:30:00Z') },
      { startsAt: new Date('2026-11-03T10:00:00Z'), endsAt: new Date('2026-11-03T12:30:00Z') },
    ],
  }),
  'subscription.renewal_charge': renewalChargeTemplate({
    ...base,
    amountCents: 160_000,
    dueOn: '2026-12-02',
    method: 'pix',
    pixCopyPaste: PIX,
  }),
  'subscription.renewal_reminder': renewalReminderTemplate({
    ...base,
    amountCents: 160_000,
    dueOn: '2026-12-02',
    method: 'pix',
    pixCopyPaste: PIX,
  }),
  'subscription.renewal_approved': renewalApprovedTemplate({
    ...base,
    amountCents: 160_000,
    startsOn: '2026-12-02',
    endsOn: '2027-01-01',
  }),
  'subscription.renewal_failed': renewalFailedTemplate({
    ...base,
    amountCents: 160_000,
    dueOn: '2026-12-02',
  }),
  'subscription.suspended': suspendedTemplate({ ...base, graceEndsOn: '2026-12-09' }),
  'subscription.ended': endedTemplate(base),
  'subscription.cancelled': cancelledTemplate({ ...base, minutesLost: 360 }),
  'subscription.switched': switchedTemplate({
    ...base,
    fromCategoryName: 'Pacote 20h mensal',
    categoryName: 'Pacote 30h mensal',
    startsOn: '2026-11-20',
    convertedMinutes: 384,
  }),
  'subscription.period_ending': periodEndingTemplate({
    ...base,
    endsOn: '2026-12-02',
    daysLeft: 7,
    remainingMinutes: 750,
  }),
  'subscription.price_change': priceChangeTemplate({
    ...base,
    newPriceCents: 175_000,
    firstRenewalOn: '2026-12-02',
  }),
  'subscription.next_period_conflicts': nextPeriodConflictsTemplate({
    ...base,
    categoryName: 'Meio turno mensal',
    conflicts: [{ date: '2026-12-10', label: 'Bloqueado' }],
  }),
  'subscription.sale_link': saleLinkTemplate({
    ...base,
    categoryName: 'Turno mensal',
    amountCents: 1_100_000,
    holdExpiresAt: new Date('2026-11-03T15:00:00Z'),
  }),
  'extra_hours.purchased': extraHoursPurchasedTemplate({
    name: 'Ana Souza',
    link: LINK,
    hours: 5,
    amountCents: 40_000,
    expiresAt: new Date('2027-02-08T15:00:00Z'),
  }),
  'credit.granted': creditGrantedTemplate({
    name: 'Ana Souza',
    link: LINK,
    amountCents: 5000,
    sourceLabel: 'Crédito manual',
    expiresAt: new Date('2027-01-30T15:00:00Z'),
  }),
  'subscription.compensation': compensationTemplate({
    ...base,
    closedOn: '2026-11-20',
    creditCents: 20_533,
  }),
  'payment.late_refund': lateRefundTemplate({
    name: 'Ana Souza',
    link: LINK,
    amountCents: 616_000,
    description: 'Meio turno mensal',
  }),
};

// Text each template must carry (REC-159, REC-161 and the spec examples).
const expected: Record<string, string[]> = {
  'subscription.activated': [
    'Meio turno mensal',
    '02/11/2026',
    'R$ 6.160,00',
    '2 ocorrências',
    '02/11/2026 das 07:00 às 09:30',
    '.ics',
  ],
  'subscription.renewal_charge': ['R$ 1.600,00', '02/12/2026', 'Pix', PIX],
  'subscription.renewal_reminder': ['R$ 1.600,00', '02/12/2026', 'Pix', PIX],
  'subscription.renewal_approved': ['R$ 1.600,00', '02/12/2026', '01/01/2027'],
  'subscription.renewal_failed': ['R$ 1.600,00', '02/12/2026'],
  'subscription.suspended': ['suspensa', '09/12/2026'],
  'subscription.ended': ['encerrada'],
  'subscription.cancelled': ['cancelada', '6h', 'sem reembolso'],
  'subscription.switched': ['Pacote 30h mensal', '20/11/2026', '6h 24min'],
  'subscription.period_ending': ['em 7 dias', '02/12/2026', '12h 30min'],
  'subscription.price_change': ['R$ 1.750,00', '02/12/2026'],
  'subscription.next_period_conflicts': ['10/12/2026: Bloqueado'],
  'subscription.sale_link': ['Turno mensal', 'R$ 11.000,00', '03/11/2026 às 12:00'],
  'extra_hours.purchased': ['R$ 400,00', '5 horas extras', '08/02/2027'],
  'credit.granted': ['R$ 50,00', 'Crédito manual', '30/01/2027'],
  'subscription.compensation': ['20/11/2026', 'R$ 205,33'],
  'payment.late_refund': ['R$ 6.160,00', 'estornado'],
};

const EMOJI = /\p{Extended_Pictographic}/u;

describe('receita e-mail templates (REC-159, REC-161)', () => {
  it('renders all 17 templates', () => {
    expect(Object.keys(rendered).sort()).toEqual([...REVENUE_TEMPLATES].sort());
  });

  it.each(Object.keys(expected))('%s has a subject, html and text with its key values', (name) => {
    const mail = rendered[name];
    expect(mail?.subject.length).toBeGreaterThan(0);
    expect(mail?.html).toContain('<!doctype html>');
    // Intl formats "R$ 1.600,00" with a no-break space.
    const text = (mail?.text ?? '').replaceAll(' ', ' ');
    for (const value of expected[name] ?? []) expect(text).toContain(value);
  });

  it('renewal charge with a saved card names the card and a missing card asks for a new one (REC-52)', () => {
    const card = renewalChargeTemplate({
      ...base,
      amountCents: 160_000,
      dueOn: '2026-12-02',
      method: 'saved_card',
      cardLast4: '4242',
    });
    const fallback = renewalChargeTemplate({
      ...base,
      amountCents: 160_000,
      dueOn: '2026-12-02',
      method: 'pix',
      pixCopyPaste: PIX,
      askCardUpdate: true,
    });
    expect(card.text).toContain('cartão final 4242');
    expect(fallback.text).toContain('Cadastre um cartão');
  });

  it('contains no emoji in any subject, html or text', () => {
    for (const mail of Object.values(rendered)) {
      expect(EMOJI.test(mail.subject + mail.html + mail.text)).toBe(false);
    }
  });

  it('escapes user input in the html', () => {
    const mail = endedTemplate({ ...base, name: '<script>alert(1)</script>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('revenueMailer', () => {
  it('exposes exactly the 17 REC-159 templates', () => {
    expect(Object.keys(revenueMailer).sort()).toEqual(
      [
        'subscription.activated',
        'subscription.renewal_charge',
        'subscription.renewal_reminder',
        'subscription.renewal_approved',
        'subscription.renewal_failed',
        'subscription.suspended',
        'subscription.ended',
        'subscription.cancelled',
        'subscription.switched',
        'subscription.period_ending',
        'subscription.price_change',
        'subscription.next_period_conflicts',
        'subscription.sale_link',
        'extra_hours.purchased',
        'credit.granted',
        'subscription.compensation',
        'payment.late_refund',
      ].sort(),
    );
  });
});
