import { z } from 'zod';

// Response shapes of the tenant's personal calendar feed (gestao design "ICS serializer and
// feeds"): `GET /api/app/calendar-feed` and `POST /api/app/calendar-feed`. The raw token is
// returned once, inside `url`; afterwards only the 6-character prefix is known.

export const calendarFeedStatusSchema = z.object({
  active: z.boolean(),
  /** First characters of the token, to recognize the link; null without an active feed. */
  prefix: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type CalendarFeedStatus = z.infer<typeof calendarFeedStatusSchema>;

export const calendarFeedIssuedSchema = z.object({ url: z.string().min(1) });
export type CalendarFeedIssued = z.infer<typeof calendarFeedIssuedSchema>;
