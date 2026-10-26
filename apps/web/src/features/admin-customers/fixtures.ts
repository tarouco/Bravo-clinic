import { parseFixture } from '../../test/fixtures/parse';
import {
  customerBookingsPageSchema,
  customerDetailSchema,
  customerListSchema,
  type CustomerList,
} from './contracts';

// Clientes fixtures for the web tests, validated against the response contracts (AD-035).

export const CUSTOMER_IDS = {
  ana: 'c1000000-0000-4000-8000-000000000001',
  bruno: 'c1000000-0000-4000-8000-000000000002',
} as const;

const ana = {
  id: CUSTOMER_IDS.ana,
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '+5547999990001',
  docMasked: '***.982.247-**',
};
const bruno = {
  id: CUSTOMER_IDS.bruno,
  name: 'Bruno Lima',
  email: 'bruno@example.com',
  phone: null,
  docMasked: null,
};

export function buildCustomerList(
  items: CustomerList['items'] = [ana, bruno],
  nextCursor: string | null = null,
): CustomerList {
  return parseFixture(customerListSchema, { items, nextCursor }, 'customerList');
}

/** 50 customers named "Cliente 01".. for the pagination tests; the page cursor is "page-2". */
export function buildManyCustomers(from: number, count: number, nextCursor: string | null) {
  const items = Array.from({ length: count }, (_, index) => {
    const n = String(from + index).padStart(2, '0');
    return {
      id: `c2000000-0000-4000-8000-0000000000${n}`,
      name: `Cliente ${n}`,
      email: `cliente${n}@example.com`,
      phone: null,
      docMasked: null,
    };
  });
  return buildCustomerList(items, nextCursor);
}

/** Ana with a booking page that continues, one subscription, lots, credit, coupon, consents, quote. */
export const customerDetail = parseFixture(
  customerDetailSchema,
  {
    profile: {
      ...ana,
      docType: 'cpf',
      profession: 'Psicóloga',
      professionalRegistry: 'CRP 12/34567',
      notes: 'Prefere sala silenciosa.',
      createdAt: '2026-03-10T12:00:00.000Z',
    },
    bookings: {
      items: [
        {
          id: 'b1000000-0000-4000-8000-000000000001',
          code: 'BRV-7K2Q9X',
          roomName: 'Sala Aurora',
          startsAt: '2026-11-03T17:00:00.000Z',
          endsAt: '2026-11-03T19:00:00.000Z',
          status: 'confirmed',
          totalCents: 21900,
        },
        {
          id: 'b1000000-0000-4000-8000-000000000002',
          code: 'BRV-3M8T1A',
          roomName: 'Sala Boreal',
          startsAt: '2026-09-10T13:00:00.000Z',
          endsAt: '2026-09-10T14:00:00.000Z',
          status: 'completed',
          totalCents: 9000,
        },
      ],
      nextCursor: 'bookings-2',
    },
    subscriptions: [
      {
        id: 's1000000-0000-4000-8000-000000000001',
        categoryName: 'Assinatura Horário Fixo',
        roomName: 'Sala Aurora',
        status: 'active',
        baseOn: '2026-10-02',
        nextChargeOn: '2026-11-02',
        balanceMinutes: 480,
      },
    ],
    extraLots: [
      {
        id: 'l1000000-0000-4000-8000-000000000001',
        source: 'purchase',
        remainingMinutes: 120,
        expiresOn: '2026-12-31',
      },
    ],
    credits: [
      {
        id: 'k1000000-0000-4000-8000-000000000001',
        source: 'reschedule_difference',
        remainingCents: 4500,
        expiresOn: null,
      },
      {
        id: 'k1000000-0000-4000-8000-000000000002',
        source: 'manual',
        remainingCents: 2000,
        expiresOn: '2027-01-15',
      },
    ],
    couponUses: [
      {
        id: 'p1000000-0000-4000-8000-000000000001',
        code: 'BEMVINDA10',
        status: 'consumed',
        discountCents: 2190,
        usedAt: '2026-10-01T15:00:00.000Z',
      },
    ],
    consents: [
      {
        id: 'o1000000-0000-4000-8000-000000000001',
        kind: 'booking_policy',
        version: '2026-09',
        acceptedAt: '2026-10-01T15:00:00.000Z',
      },
      {
        id: 'o1000000-0000-4000-8000-000000000002',
        kind: 'subscription_terms',
        version: '2026-09',
        acceptedAt: '2026-10-02T12:00:00.000Z',
      },
    ],
    quoteRequests: [
      {
        id: 'q1000000-0000-4000-8000-000000000001',
        serviceName: 'Pacote de filmagem',
        status: 'contacted',
        createdAt: '2026-10-20T13:00:00.000Z',
      },
    ],
  },
  'customerDetail',
);

export const moreBookings = parseFixture(
  customerBookingsPageSchema,
  {
    items: [
      {
        id: 'b1000000-0000-4000-8000-000000000003',
        code: 'BRV-9P4R2C',
        roomName: 'Sala Aurora',
        startsAt: '2026-08-05T13:00:00.000Z',
        endsAt: '2026-08-05T15:00:00.000Z',
        status: 'cancelled_by_tenant',
        totalCents: 15000,
      },
    ],
    nextCursor: null,
  },
  'moreBookings',
);
