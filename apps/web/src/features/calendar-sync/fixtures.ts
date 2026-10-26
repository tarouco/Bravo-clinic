import { parseFixture } from '../../test/fixtures/parse';
import {
  calendarFeedIssuedSchema,
  calendarFeedStatusSchema,
  type CalendarFeedStatus,
} from './contracts';

// Personal calendar feed fixtures, validated against the response contracts (AD-035).

export const feedNone: CalendarFeedStatus = parseFixture(
  calendarFeedStatusSchema,
  { active: false, prefix: null, createdAt: null },
  'feedNone',
);

export const feedActive: CalendarFeedStatus = parseFixture(
  calendarFeedStatusSchema,
  { active: true, prefix: 'k3Fa9x', createdAt: '2026-10-20T12:00:00.000Z' },
  'feedActive',
);

export const FEED_URL =
  'https://bravo-clinic.netlify.app/api/ics/k3Fa9xQ7mZpL2vN8wT5yB1cD4eR6hJ0s.ics';
export const NEW_FEED_URL =
  'https://bravo-clinic.netlify.app/api/ics/Zr8Lq2Vn5Tg7Wm1Xc4Hb9Yd3Ke6Js0Pa.ics';

export const feedIssued = parseFixture(calendarFeedIssuedSchema, { url: FEED_URL }, 'feedIssued');
export const feedReissued = parseFixture(
  calendarFeedIssuedSchema,
  { url: NEW_FEED_URL },
  'feedReissued',
);
