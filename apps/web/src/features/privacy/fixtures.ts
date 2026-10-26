import { parseFixture } from '../../test/fixtures/parse';
import { consentListSchema } from './contracts';

// Privacy fixtures, validated against the response contract (AD-035).

export const consents = parseFixture(
  consentListSchema,
  {
    items: [
      {
        id: 'c3000000-0000-4000-8000-000000000001',
        kind: 'booking_policy',
        version: 2,
        acceptedAt: '2026-10-18T13:30:00.000Z',
      },
      {
        id: 'c3000000-0000-4000-8000-000000000002',
        kind: 'recurring_charge',
        version: 1,
        acceptedAt: '2026-10-20T02:15:00.000Z',
      },
    ],
  },
  'consents',
);
