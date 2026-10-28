import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  auditQuerySchema,
  customerNotesSchema,
  customerProfileSchema,
  deleteWithJustificationSchema,
  deletionConfirmSchema,
  expenseInputSchema,
  extraServiceInputSchema,
  extrasAddonSchema,
  financeQuerySchema,
  manualReceiptInputSchema,
  mcpTokenInputSchema,
  notificationEventsSchema,
  notificationRecipientSchema,
  pushSubscriptionSchema,
  quoteRequestInputSchema,
  quoteStatusUpdateSchema,
  roleChangeSchema,
  roomInputSchema,
  roomPhotoInputSchema,
  roomPhotoOrderSchema,
  roomPhotoUpdateSchema,
  staffUserInputSchema,
} from './gestao-schemas';

const ID = '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

/** Paths (joined) of every issue, `[]` when the input is valid. */
function issuePaths(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

function firstMessage(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('financeQuerySchema (GES-25)', () => {
  it('accepts a 731-day range and defaults to Caixa grouped by month (GES-26)', () => {
    // 2025 and 2026 have 365 days each: 2025-01-01..2027-01-01 is 731 days, both ends included.
    const result = financeQuerySchema.safeParse({ from: '2025-01-01', to: '2027-01-01' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      from: '2025-01-01',
      to: '2027-01-01',
      grouping: 'month',
      regime: 'cash',
    });
  });

  it('rejects a 732-day range on `to`', () => {
    const input = { from: '2025-01-01', to: '2027-01-02', grouping: 'week', regime: 'accrual' };
    expect(issuePaths(financeQuerySchema, input)).toEqual(['to']);
    expect(firstMessage(financeQuerySchema, input)).toBe('O período pode ter no máximo 731 dias');
  });

  it('rejects `to` before `from` and accepts a single day', () => {
    expect(issuePaths(financeQuerySchema, { from: '2026-11-02', to: '2026-11-01' })).toEqual([
      'to',
    ]);
    expect(issuePaths(financeQuerySchema, { from: '2026-11-02', to: '2026-11-02' })).toEqual([]);
  });

  it('rejects unknown regime or grouping and malformed dates without throwing', () => {
    expect(
      issuePaths(financeQuerySchema, { from: '2026-11-01', to: '2026-11-30', regime: 'x' }),
    ).toEqual(['regime']);
    expect(
      issuePaths(financeQuerySchema, { from: '2026-11-01', to: '2026-11-30', grouping: 'year' }),
    ).toEqual(['grouping']);
    expect(issuePaths(financeQuerySchema, { from: 'nov', to: '2026-11-30' })).toEqual(['from']);
  });
});

describe('expense and manual receipt schemas (GES-11, GES-20, GES-21)', () => {
  const expense = {
    date: '2026-11-05',
    categoryId: ID,
    description: 'Conta de energia',
    amountCents: 45_000,
  };

  it('accepts a valid expense with recurrence none by default', () => {
    expect(expenseInputSchema.parse(expense).recurrence).toBe('none');
    expect(expenseInputSchema.parse({ ...expense, recurrence: 'quarterly' }).recurrence).toBe(
      'quarterly',
    );
  });

  it('enforces description 1..200, amount 1..100000000 and the recurrence enum', () => {
    expect(issuePaths(expenseInputSchema, { ...expense, description: '  ' })).toEqual([
      'description',
    ]);
    expect(issuePaths(expenseInputSchema, { ...expense, description: 'x'.repeat(201) })).toEqual([
      'description',
    ]);
    expect(issuePaths(expenseInputSchema, { ...expense, description: 'x'.repeat(200) })).toEqual(
      [],
    );
    expect(issuePaths(expenseInputSchema, { ...expense, amountCents: 0 })).toEqual(['amountCents']);
    expect(issuePaths(expenseInputSchema, { ...expense, amountCents: 100_000_001 })).toEqual([
      'amountCents',
    ]);
    expect(issuePaths(expenseInputSchema, { ...expense, amountCents: 100_000_000 })).toEqual([]);
    expect(issuePaths(expenseInputSchema, { ...expense, recurrence: 'weekly' })).toEqual([
      'recurrence',
    ]);
  });

  it('accepts a manual receipt and rejects an unknown method or category', () => {
    const receipt = {
      date: '2026-11-05',
      revenueCategory: 'other',
      method: 'card_machine',
      amountCents: 12_000,
    };
    expect(issuePaths(manualReceiptInputSchema, receipt)).toEqual([]);
    expect(issuePaths(manualReceiptInputSchema, { ...receipt, method: 'boleto' })).toEqual([
      'method',
    ]);
    expect(issuePaths(manualReceiptInputSchema, { ...receipt, revenueCategory: 'misc' })).toEqual([
      'revenueCategory',
    ]);
    expect(issuePaths(manualReceiptInputSchema, { ...receipt, amountCents: 0 })).toEqual([
      'amountCents',
    ]);
  });

  it('requires a justification of 5..500 characters', () => {
    expect(issuePaths(deleteWithJustificationSchema, {})).toEqual(['justification']);
    expect(issuePaths(deleteWithJustificationSchema, { justification: 'abcd' })).toEqual([
      'justification',
    ]);
    expect(issuePaths(deleteWithJustificationSchema, { justification: 'x'.repeat(501) })).toEqual([
      'justification',
    ]);
    expect(issuePaths(deleteWithJustificationSchema, { justification: 'abcde' })).toEqual([]);
  });
});

describe('extraServiceInputSchema (GES-84, GES-85)', () => {
  const service = { name: 'Videomaker', unit: 'project' };

  it('rejects saleMode online with a null price on referencePriceCents', () => {
    const input = { ...service, saleMode: 'online', referencePriceCents: null };
    expect(issuePaths(extraServiceInputSchema, input)).toEqual(['referencePriceCents']);
    expect(firstMessage(extraServiceInputSchema, input)).toBe('Informe o preço para vender online');
  });

  it('accepts a quote-mode service without price and an online one with price', () => {
    expect(extraServiceInputSchema.parse(service)).toEqual({
      name: 'Videomaker',
      description: '',
      referencePriceCents: null,
      unit: 'project',
      saleMode: 'quote',
      status: 'active',
      displayOrder: 0,
    });
    expect(
      issuePaths(extraServiceInputSchema, {
        ...service,
        unit: 'hour',
        saleMode: 'online',
        referencePriceCents: 8000,
      }),
    ).toEqual([]);
  });

  it('enforces name 2..80, description ≤ 1000 and price 0..10000000', () => {
    expect(issuePaths(extraServiceInputSchema, { ...service, name: 'V' })).toEqual(['name']);
    expect(issuePaths(extraServiceInputSchema, { ...service, name: 'V'.repeat(81) })).toEqual([
      'name',
    ]);
    expect(
      issuePaths(extraServiceInputSchema, { ...service, description: 'd'.repeat(1001) }),
    ).toEqual(['description']);
    expect(
      issuePaths(extraServiceInputSchema, { ...service, referencePriceCents: 10_000_001 }),
    ).toEqual(['referencePriceCents']);
    expect(issuePaths(extraServiceInputSchema, { ...service, referencePriceCents: 0 })).toEqual([]);
  });
});

describe('extrasAddonSchema (GES-88)', () => {
  it('accepts service lines with a positive integer quantity', () => {
    expect(issuePaths(extrasAddonSchema, [{ serviceId: ID, quantity: 2 }])).toEqual([]);
  });

  it('rejects a zero or fractional quantity, a bad id and a repeated service', () => {
    expect(issuePaths(extrasAddonSchema, [{ serviceId: ID, quantity: 0 }])).toEqual(['0.quantity']);
    expect(issuePaths(extrasAddonSchema, [{ serviceId: ID, quantity: 1.5 }])).toEqual([
      '0.quantity',
    ]);
    expect(issuePaths(extrasAddonSchema, [{ serviceId: 'x', quantity: 1 }])).toEqual([
      '0.serviceId',
    ]);
    const repeated = [
      { serviceId: ID, quantity: 1 },
      { serviceId: ID, quantity: 2 },
    ];
    expect(issuePaths(extrasAddonSchema, repeated)).toEqual(['']);
    expect(firstMessage(extrasAddonSchema, repeated)).toBe('Cada serviço só pode aparecer uma vez');
  });
});

describe('quoteRequestInputSchema (GES-90, GES-93)', () => {
  const schema = quoteRequestInputSchema('2026-10-25');
  const quote = {
    serviceId: ID,
    name: 'Ana Souza',
    phone: '(47) 99999-0000',
    description: 'Gravação de 3 vídeos curtos',
  };

  it('accepts a minimal request and normalizes the phone', () => {
    const parsed = schema.parse(quote);
    expect(parsed.phone).toBe('+5547999990000');
    expect(parsed.email).toBeUndefined();
  });

  it('enforces name 2..120 and description 10..2000', () => {
    expect(issuePaths(schema, { ...quote, name: 'A' })).toEqual(['name']);
    expect(issuePaths(schema, { ...quote, name: 'A'.repeat(121) })).toEqual(['name']);
    expect(issuePaths(schema, { ...quote, name: 'A'.repeat(120) })).toEqual([]);
    expect(issuePaths(schema, { ...quote, description: 'curto' })).toEqual(['description']);
    expect(issuePaths(schema, { ...quote, description: 'd'.repeat(10) })).toEqual([]);
    expect(issuePaths(schema, { ...quote, description: 'd'.repeat(2001) })).toEqual([
      'description',
    ]);
  });

  it('keeps desiredOn within today..today + 365 of the injected today', () => {
    expect(issuePaths(schema, { ...quote, desiredOn: '2027-10-25' })).toEqual([]);
    expect(issuePaths(schema, { ...quote, desiredOn: '2027-10-26' })).toEqual(['desiredOn']);
    expect(firstMessage(schema, { ...quote, desiredOn: '2027-10-26' })).toBe(
      'Escolha uma data entre 25/10/2026 e 25/10/2027',
    );
    expect(issuePaths(schema, { ...quote, desiredOn: '2026-10-25' })).toEqual([]);
    expect(issuePaths(schema, { ...quote, desiredOn: '2026-10-24' })).toEqual(['desiredOn']);
  });

  it('accepts website as an optional string and blank optional fields as absent', () => {
    expect(schema.parse({ ...quote, website: 'http://spam.example' }).website).toBe(
      'http://spam.example',
    );
    expect(issuePaths(schema, { ...quote, website: 42 })).toEqual(['website']);
    const blank = schema.parse({ ...quote, email: '', desiredOn: '' });
    expect(blank.email).toBeUndefined();
    expect(blank.desiredOn).toBeUndefined();
    expect(schema.parse({ ...quote, email: ' Ana@Ex.com ' }).email).toBe('ana@ex.com');
    expect(issuePaths(schema, { ...quote, email: 'ana' })).toEqual(['email']);
  });

  it('allows only the funnel statuses and notes up to 2000 chars (GES-95, GES-96)', () => {
    expect(issuePaths(quoteStatusUpdateSchema, { status: 'quote_sent' })).toEqual([]);
    expect(issuePaths(quoteStatusUpdateSchema, { status: 'closed' })).toEqual(['status']);
    expect(issuePaths(quoteStatusUpdateSchema, { staffNotes: 'n'.repeat(2000) })).toEqual([]);
    expect(issuePaths(quoteStatusUpdateSchema, { staffNotes: 'n'.repeat(2001) })).toEqual([
      'staffNotes',
    ]);
    expect(issuePaths(quoteStatusUpdateSchema, {})).toEqual(['']);
  });
});

describe('integration schemas (GES-36, GES-53, GES-65, GES-66, GES-76)', () => {
  it('stores recipient e-mails lower-cased', () => {
    expect(notificationRecipientSchema.parse({ email: ' Recepcao@Bravo.COM ' }).email).toBe(
      'recepcao@bravo.com',
    );
  });

  it('accepts the 7 event toggles and rejects an unknown key', () => {
    const toggles = {
      new_booking: true,
      payment_received: false,
      booking_cancelled: true,
      new_subscription: true,
      renewal_failed: true,
      pre_reservation_expired: false,
      new_quote_request: true,
    };
    expect(notificationEventsSchema.parse(toggles)).toEqual(toggles);
    expect(firstMessage(notificationEventsSchema, { ...toggles, booking_created: true })).toBe(
      'Evento desconhecido',
    );
  });

  it('bounds MCP token name 1..60, scope and expiry 1..365 days', () => {
    const token = { name: 'Claude no notebook', scope: 'read_write' };
    expect(issuePaths(mcpTokenInputSchema, token)).toEqual([]);
    expect(issuePaths(mcpTokenInputSchema, { ...token, name: '' })).toEqual(['name']);
    expect(issuePaths(mcpTokenInputSchema, { ...token, name: 'n'.repeat(61) })).toEqual(['name']);
    expect(issuePaths(mcpTokenInputSchema, { ...token, scope: 'admin' })).toEqual(['scope']);
    expect(issuePaths(mcpTokenInputSchema, { ...token, expiresInDays: 365 })).toEqual([]);
    expect(issuePaths(mcpTokenInputSchema, { ...token, expiresInDays: 0 })).toEqual([
      'expiresInDays',
    ]);
    expect(issuePaths(mcpTokenInputSchema, { ...token, expiresInDays: 366 })).toEqual([
      'expiresInDays',
    ]);
  });

  it('accepts https push endpoints with base64url keys only', () => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u',
        auth: 'tBHI_gPt-Os',
      },
    };
    expect(issuePaths(pushSubscriptionSchema, sub)).toEqual([]);
    expect(
      issuePaths(pushSubscriptionSchema, { ...sub, endpoint: 'http://push.example/x' }),
    ).toEqual(['endpoint']);
    expect(
      issuePaths(pushSubscriptionSchema, {
        ...sub,
        endpoint: `https://push.example/${'a'.repeat(1000)}`,
      }),
    ).toEqual(['endpoint']);
    expect(
      issuePaths(pushSubscriptionSchema, { ...sub, keys: { p256dh: 'abc+/=', auth: 'ok' } }),
    ).toEqual(['keys.p256dh']);
  });
});

describe('room schemas (GES-103, GES-105)', () => {
  const room = { name: 'Sala Principal', slug: 'principal' };

  it('enforces name 2..60 and a kebab-case slug of 2..40 chars', () => {
    expect(issuePaths(roomInputSchema, room)).toEqual([]);
    expect(issuePaths(roomInputSchema, { ...room, name: 'S' })).toEqual(['name']);
    expect(issuePaths(roomInputSchema, { ...room, name: 'S'.repeat(61) })).toEqual(['name']);
    expect(issuePaths(roomInputSchema, { ...room, slug: 'sala-2' })).toEqual([]);
    expect(issuePaths(roomInputSchema, { ...room, slug: 'Sala_2' })).toEqual(['slug']);
    expect(issuePaths(roomInputSchema, { ...room, slug: 'sala-' })).toEqual(['slug']);
    expect(issuePaths(roomInputSchema, { ...room, slug: 's' })).toEqual(['slug']);
    expect(issuePaths(roomInputSchema, { ...room, slug: 's'.repeat(41) })).toEqual(['slug']);
  });

  it('caps description, ideal-for tags and equipment', () => {
    expect(issuePaths(roomInputSchema, { ...room, description: 'd'.repeat(2001) })).toEqual([
      'description',
    ]);
    expect(issuePaths(roomInputSchema, { ...room, idealFor: Array(9).fill('Psicologia') })).toEqual(
      ['idealFor'],
    );
    expect(issuePaths(roomInputSchema, { ...room, idealFor: ['t'.repeat(41)] })).toEqual([
      'idealFor.0',
    ]);
    expect(issuePaths(roomInputSchema, { ...room, equipment: Array(31).fill('Maca') })).toEqual([
      'equipment',
    ]);
    expect(issuePaths(roomInputSchema, { ...room, equipment: ['e'.repeat(81)] })).toEqual([
      'equipment.0',
    ]);
    expect(
      issuePaths(roomInputSchema, {
        ...room,
        idealFor: Array(8).fill('t'.repeat(40)),
        equipment: Array(30).fill('e'.repeat(80)),
      }),
    ).toEqual([]);
  });

  it('requires photo alt text of 1..200 chars', () => {
    const photo = { uploadId: ID, alt: 'Sala com maca e luz natural', width: 1600, height: 1067 };
    expect(issuePaths(roomPhotoInputSchema, photo)).toEqual([]);
    expect(issuePaths(roomPhotoInputSchema, { ...photo, alt: ' ' })).toEqual(['alt']);
    expect(issuePaths(roomPhotoInputSchema, { ...photo, alt: 'a'.repeat(201) })).toEqual(['alt']);
  });

  it('photo edits need one field and keep the alt rules; the order lists 1..12 ids', () => {
    expect(issuePaths(roomPhotoUpdateSchema, { isCover: true })).toEqual([]);
    expect(issuePaths(roomPhotoUpdateSchema, {})).toEqual(['']);
    expect(issuePaths(roomPhotoUpdateSchema, { alt: '' })).toEqual(['alt']);
    expect(issuePaths(roomPhotoOrderSchema, { ids: [ID] })).toEqual([]);
    expect(issuePaths(roomPhotoOrderSchema, { ids: [] })).toEqual(['ids']);
    expect(issuePaths(roomPhotoOrderSchema, { ids: Array(13).fill(ID) })).toEqual(['ids']);
  });
});

describe('staff, customer, audit and privacy schemas', () => {
  it('invites staff only as admin or reception (GES-111)', () => {
    const staff = { name: 'Carla Lima', email: 'Carla@Bravo.com', role: 'reception' };
    expect(staffUserInputSchema.parse(staff).email).toBe('carla@bravo.com');
    expect(issuePaths(staffUserInputSchema, { ...staff, role: 'tenant' })).toEqual(['role']);
    expect(issuePaths(roleChangeSchema, { status: 'disabled' })).toEqual([]);
    expect(issuePaths(roleChangeSchema, { status: 'deleted' })).toEqual(['status']);
  });

  it('caps customer notes at 4000 chars and edits only profile fields (GES-101, GES-102)', () => {
    expect(issuePaths(customerNotesSchema, { notes: 'n'.repeat(4000) })).toEqual([]);
    expect(issuePaths(customerNotesSchema, { notes: 'n'.repeat(4001) })).toEqual(['notes']);
    expect(
      issuePaths(customerProfileSchema, {
        name: 'Ana Souza',
        phone: '47999990000',
        profession: 'Psicóloga',
        professionalRegistry: 'CRP 12/3456',
      }),
    ).toEqual([]);
    expect(issuePaths(customerProfileSchema, { document: '52998224725' })).toEqual(['']);
  });

  it('limits audit pages to 100 rows and filters by origin (GES-115)', () => {
    expect(auditQuerySchema.parse({}).limit).toBe(50);
    expect(auditQuerySchema.parse({ limit: '100', origin: 'mcp' })).toEqual({
      limit: 100,
      origin: 'mcp',
    });
    expect(issuePaths(auditQuerySchema, { limit: '101' })).toEqual(['limit']);
    expect(issuePaths(auditQuerySchema, { origin: 'cli' })).toEqual(['origin']);
  });

  it('requires the password or the confirmation text to delete the account (GES-124)', () => {
    expect(issuePaths(deletionConfirmSchema, { password: 'segredo123' })).toEqual([]);
    expect(issuePaths(deletionConfirmSchema, { confirmText: 'EXCLUIR' })).toEqual([]);
    expect(issuePaths(deletionConfirmSchema, {})).toEqual(['password']);
  });
});
