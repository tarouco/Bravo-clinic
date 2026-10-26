import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ZodType } from 'zod';
import {
  adminAvailabilityDay,
  adminBookingDetail,
  adminBookingList,
  adminCancellationPreview,
  adminCategory,
  adminCategoryList,
  availabilityMonth,
  blockCreated,
  blockList,
  bookingAwaitingPayment,
  bookingCancelled,
  bookingDetail,
  bookingList,
  businessHoursResponse,
  buildAvailabilityDay,
  buildAvailabilityMonth,
  calendarConfig,
  calendarEvents,
  calendarSettingsResult,
  cancellationPreview,
  catalog,
  chargeIntent,
  clinic,
  closedDayCreated,
  closedDayList,
  closedDayPreview,
  customerCreated,
  customerSearch,
  holiday,
  holidayImportResult,
  holidayList,
  me,
  paymentConfig,
  policies,
  policySettings,
  preReservation,
  quote,
  recurrenceCreated,
  recurrenceList,
  rescheduleQuote,
  rescheduleResult,
  resendLinkResult,
  roomDetails,
  roomList,
  sandboxApproved,
  sandboxCharge,
  savedCard,
  savedCardList,
  staffBookingCreated,
  ID,
  TOKEN,
} from '../fixtures/nucleo';
import {
  adminAvailabilityDaySchema,
  adminBookingDetailSchema,
  adminBookingListSchema,
  adminCancellationPreviewSchema,
  adminCategoryListSchema,
  adminCategorySchema,
  availabilityDaySchema,
  availabilityMonthSchema,
  blockCreateResultSchema,
  blockListSchema,
  blockRecurrenceCreateResultSchema,
  blockRecurrenceListSchema,
  bookingDetailSchema,
  bookingListSchema,
  businessHoursResponseSchema,
  calendarConfigSchema,
  calendarEventsSchema,
  calendarSettingsResultSchema,
  cancellationPreviewSchema,
  catalogSchema,
  chargeIntentSchema,
  clinicSchema,
  closedDayCreateResultSchema,
  closedDayListSchema,
  closedDayPreviewSchema,
  customerCreatedSchema,
  customerSearchResultSchema,
  holidayImportResultSchema,
  holidayListSchema,
  holidaySchema,
  meSchema,
  paymentConfigSchema,
  pricesReviewedSchema,
  policiesPublicSchema,
  policySettingsSchema,
  preReservationPublicSchema,
  quoteSchema,
  rescheduleQuoteSchema,
  rescheduleResultSchema,
  resendLinkResultSchema,
  roomDetailSchema,
  roomListSchema,
  sandboxActionSchema,
  sandboxChargeSchema,
  savedCardListSchema,
  savedCardSchema,
  staffBookingCreatedSchema,
} from '@bravo/core';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Ctx {
  url: URL;
  params: Record<string, string | readonly string[] | undefined>;
}

/** One mocked route of design.md section "API Contract". */
export interface RouteSpec {
  method: Method;
  /** MSW path pattern (without the origin). */
  path: string;
  /** A concrete URL that the pattern matches; used by the route-table test. */
  sample: string;
  /** Core schema of the 2xx JSON body; null for empty and non-JSON bodies. */
  schema: ZodType | null;
  status?: number;
  respond: (ctx: Ctx) => unknown;
}

/** Error envelope of docs/architecture.md section 6.2. */
export function apiError(status: number, code: string, message: string): Response {
  return HttpResponse.json({ error: { code, message, requestId: 'req-test-0001' } }, { status });
}

const param = (ctx: Ctx, key: string): string => {
  const value = ctx.params[key];
  const first = (Array.isArray(value) ? value[0] : value) as string | undefined;
  return first ?? '';
};

const CSV =
  '﻿Código;Cliente;E-mail;Sala;Início;Fim;Status;Total (R$);Pago (R$);Saldo (R$);Origem\r\n';
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

const pub = '/api/public';
const app = '/api/app';
const adm = '/api/admin';
const day = '2026-10-27';

/** Every núcleo route with its contract-validated default response. */
export const routes: RouteSpec[] = [
  // ---- public ----
  {
    method: 'get',
    path: `${pub}/rooms`,
    sample: `${pub}/rooms`,
    schema: roomListSchema,
    respond: () => roomList,
  },
  {
    method: 'get',
    path: `${pub}/rooms/:slug`,
    sample: `${pub}/rooms/principal`,
    schema: roomDetailSchema,
    respond: (c) => roomDetails[param(c, 'slug') as keyof typeof roomDetails],
  },
  {
    method: 'get',
    path: `${pub}/catalog`,
    sample: `${pub}/catalog`,
    schema: catalogSchema,
    respond: () => catalog,
  },
  {
    method: 'get',
    path: `${pub}/clinic`,
    sample: `${pub}/clinic`,
    schema: clinicSchema,
    respond: () => clinic,
  },
  {
    method: 'get',
    path: `${pub}/policies`,
    sample: `${pub}/policies`,
    schema: policiesPublicSchema,
    respond: () => policies,
  },
  {
    method: 'get',
    path: `${pub}/rooms/:slug/availability`,
    sample: `${pub}/rooms/principal/availability?date=${day}`,
    schema: availabilityDaySchema,
    respond: (c) => buildAvailabilityDay(c.url.searchParams.get('date') ?? day, param(c, 'slug')),
  },
  {
    method: 'get',
    path: `${pub}/rooms/:slug/availability/month`,
    sample: `${pub}/rooms/principal/availability/month?month=2026-10`,
    schema: availabilityMonthSchema,
    respond: (c) =>
      buildAvailabilityMonth(c.url.searchParams.get('month') ?? availabilityMonth.month),
  },
  {
    method: 'post',
    path: `${pub}/bookings/quote`,
    sample: `${pub}/bookings/quote`,
    schema: quoteSchema,
    respond: () => quote,
  },
  {
    method: 'get',
    path: `${pub}/pre-reservations/:token`,
    sample: `${pub}/pre-reservations/${TOKEN}`,
    schema: preReservationPublicSchema,
    respond: (c) => (param(c, 'token') === TOKEN ? preReservation : null),
  },
  {
    method: 'get',
    path: `${pub}/payment-config`,
    sample: `${pub}/payment-config`,
    schema: paymentConfigSchema,
    respond: () => paymentConfig,
  },
  {
    method: 'get',
    path: `${pub}/sandbox/charges/:chargeId`,
    sample: `${pub}/sandbox/charges/${ID.charge}`,
    schema: sandboxChargeSchema,
    respond: () => sandboxCharge,
  },
  {
    method: 'post',
    path: `${pub}/sandbox/charges/:chargeId/approve`,
    sample: `${pub}/sandbox/charges/${ID.charge}/approve`,
    schema: sandboxActionSchema,
    respond: () => sandboxApproved,
  },
  {
    method: 'post',
    path: `${pub}/sandbox/charges/:chargeId/reject`,
    sample: `${pub}/sandbox/charges/${ID.charge}/reject`,
    schema: sandboxActionSchema,
    respond: () => ({ status: 'rejected' }),
  },

  // ---- tenant app ----
  {
    method: 'post',
    path: `${app}/bookings`,
    sample: `${app}/bookings`,
    schema: bookingDetailSchema,
    status: 201,
    respond: () => bookingAwaitingPayment,
  },
  {
    method: 'get',
    path: `${app}/bookings`,
    sample: `${app}/bookings?tab=upcoming`,
    schema: bookingListSchema,
    respond: (c) =>
      c.url.searchParams.get('tab') === 'upcoming' ? bookingList : { items: [], nextCursor: null },
  },
  {
    method: 'get',
    path: `${app}/bookings/:id`,
    sample: `${app}/bookings/${ID.booking}`,
    schema: bookingDetailSchema,
    respond: (c) => ({ ...bookingDetail, id: param(c, 'id') }),
  },
  {
    method: 'get',
    path: `${app}/bookings/:id/ics`,
    sample: `${app}/bookings/${ID.booking}/ics`,
    schema: null,
    respond: () => ICS,
  },
  {
    method: 'post',
    path: `${app}/bookings/:id/pay`,
    sample: `${app}/bookings/${ID.booking}/pay`,
    schema: chargeIntentSchema,
    respond: () => chargeIntent,
  },
  {
    method: 'post',
    path: `${app}/bookings/:id/pay-balance`,
    sample: `${app}/bookings/${ID.booking}/pay-balance`,
    schema: chargeIntentSchema,
    respond: () => chargeIntent,
  },
  {
    method: 'get',
    path: `${app}/bookings/:id/reschedule/availability`,
    sample: `${app}/bookings/${ID.booking}/reschedule/availability?date=${day}`,
    schema: availabilityDaySchema,
    respond: (c) => buildAvailabilityDay(c.url.searchParams.get('date') ?? day, 'principal'),
  },
  {
    method: 'post',
    path: `${app}/bookings/:id/reschedule/quote`,
    sample: `${app}/bookings/${ID.booking}/reschedule/quote`,
    schema: rescheduleQuoteSchema,
    respond: () => rescheduleQuote,
  },
  {
    method: 'post',
    path: `${app}/bookings/:id/reschedule`,
    sample: `${app}/bookings/${ID.booking}/reschedule`,
    schema: rescheduleResultSchema,
    respond: () => rescheduleResult,
  },
  {
    method: 'get',
    path: `${app}/bookings/:id/cancellation-preview`,
    sample: `${app}/bookings/${ID.booking}/cancellation-preview`,
    schema: cancellationPreviewSchema,
    respond: () => cancellationPreview,
  },
  {
    method: 'post',
    path: `${app}/bookings/:id/cancel`,
    sample: `${app}/bookings/${ID.booking}/cancel`,
    schema: bookingDetailSchema,
    respond: () => bookingCancelled,
  },
  {
    method: 'get',
    path: `${app}/cards`,
    sample: `${app}/cards`,
    schema: savedCardListSchema,
    respond: () => savedCardList,
  },
  {
    method: 'post',
    path: `${app}/cards`,
    sample: `${app}/cards`,
    schema: savedCardSchema,
    status: 201,
    respond: () => savedCard,
  },
  {
    method: 'delete',
    path: `${app}/cards/:id`,
    sample: `${app}/cards/${ID.card}`,
    schema: null,
    status: 204,
    respond: () => null,
  },
  { method: 'patch', path: `${app}/me`, sample: `${app}/me`, schema: meSchema, respond: () => me },

  // ---- admin: calendar configuration ----
  {
    method: 'get',
    path: `${adm}/calendar/config`,
    sample: `${adm}/calendar/config`,
    schema: calendarConfigSchema,
    respond: () => calendarConfig,
  },
  {
    method: 'put',
    path: `${adm}/calendar/business-hours`,
    sample: `${adm}/calendar/business-hours`,
    schema: businessHoursResponseSchema,
    respond: () => businessHoursResponse,
  },
  {
    method: 'put',
    path: `${adm}/calendar/settings`,
    sample: `${adm}/calendar/settings`,
    schema: calendarSettingsResultSchema,
    respond: () => calendarSettingsResult,
  },
  {
    method: 'get',
    path: `${adm}/calendar/holidays`,
    sample: `${adm}/calendar/holidays?year=2026`,
    schema: holidayListSchema,
    respond: () => holidayList,
  },
  {
    method: 'post',
    path: `${adm}/calendar/holidays/import`,
    sample: `${adm}/calendar/holidays/import`,
    schema: holidayImportResultSchema,
    respond: () => holidayImportResult,
  },
  {
    method: 'post',
    path: `${adm}/calendar/holidays`,
    sample: `${adm}/calendar/holidays`,
    schema: holidaySchema,
    status: 201,
    respond: () => holiday,
  },
  {
    method: 'patch',
    path: `${adm}/calendar/holidays/:id`,
    sample: `${adm}/calendar/holidays/${ID.holiday}`,
    schema: holidaySchema,
    respond: () => holiday,
  },
  {
    method: 'delete',
    path: `${adm}/calendar/holidays/:id`,
    sample: `${adm}/calendar/holidays/${ID.holiday}`,
    schema: null,
    status: 204,
    respond: () => null,
  },
  {
    method: 'get',
    path: `${adm}/calendar/closed-days`,
    sample: `${adm}/calendar/closed-days?from=2026-12-01&to=2026-12-31`,
    schema: closedDayListSchema,
    respond: () => closedDayList,
  },
  {
    method: 'get',
    path: `${adm}/calendar/closed-days/preview`,
    sample: `${adm}/calendar/closed-days/preview?date=2026-12-24`,
    schema: closedDayPreviewSchema,
    respond: () => closedDayPreview,
  },
  {
    method: 'post',
    path: `${adm}/calendar/closed-days`,
    sample: `${adm}/calendar/closed-days`,
    schema: closedDayCreateResultSchema,
    status: 201,
    respond: () => closedDayCreated,
  },
  {
    method: 'delete',
    path: `${adm}/calendar/closed-days/:id`,
    sample: `${adm}/calendar/closed-days/${ID.closedDay}`,
    schema: null,
    status: 204,
    respond: () => null,
  },

  // ---- admin: blocks, categories, policies ----
  {
    method: 'get',
    path: `${adm}/blocks`,
    sample: `${adm}/blocks?from=2026-10-26&to=2026-11-01`,
    schema: blockListSchema,
    respond: () => blockList,
  },
  {
    method: 'post',
    path: `${adm}/blocks`,
    sample: `${adm}/blocks`,
    schema: blockCreateResultSchema,
    status: 201,
    respond: () => blockCreated,
  },
  {
    method: 'delete',
    path: `${adm}/blocks/:id`,
    sample: `${adm}/blocks/${ID.block}`,
    schema: null,
    status: 204,
    respond: () => null,
  },
  {
    method: 'get',
    path: `${adm}/block-recurrences`,
    sample: `${adm}/block-recurrences`,
    schema: blockRecurrenceListSchema,
    respond: () => recurrenceList,
  },
  {
    method: 'post',
    path: `${adm}/block-recurrences`,
    sample: `${adm}/block-recurrences`,
    schema: blockRecurrenceCreateResultSchema,
    status: 201,
    respond: () => recurrenceCreated,
  },
  {
    method: 'delete',
    path: `${adm}/block-recurrences/:id`,
    sample: `${adm}/block-recurrences/${ID.recurrence}`,
    schema: null,
    status: 204,
    respond: () => null,
  },
  {
    method: 'get',
    path: `${adm}/categories`,
    sample: `${adm}/categories`,
    schema: adminCategoryListSchema,
    respond: () => adminCategoryList,
  },
  {
    method: 'post',
    path: `${adm}/categories/reorder`,
    sample: `${adm}/categories/reorder`,
    schema: adminCategoryListSchema,
    respond: () => adminCategoryList,
  },
  {
    method: 'post',
    path: `${adm}/categories`,
    sample: `${adm}/categories`,
    schema: adminCategorySchema,
    status: 201,
    respond: () => adminCategory,
  },
  {
    method: 'patch',
    path: `${adm}/categories/:id`,
    sample: `${adm}/categories/${ID.catHour}`,
    schema: adminCategorySchema,
    respond: () => adminCategory,
  },
  {
    method: 'post',
    path: `${adm}/categories/:id/reference`,
    sample: `${adm}/categories/${ID.catHour}/reference`,
    schema: adminCategorySchema,
    respond: () => adminCategory,
  },
  {
    method: 'post',
    path: `${adm}/onboarding/prices-reviewed`,
    sample: `${adm}/onboarding/prices-reviewed`,
    schema: pricesReviewedSchema,
    respond: () => ({ pricesReviewed: true }),
  },
  {
    method: 'get',
    path: `${adm}/settings/policies`,
    sample: `${adm}/settings/policies`,
    schema: policySettingsSchema,
    respond: () => policySettings,
  },
  {
    method: 'put',
    path: `${adm}/settings/policies`,
    sample: `${adm}/settings/policies`,
    schema: policySettingsSchema,
    respond: () => policySettings,
  },

  // ---- admin: Gestão de Reservas ----
  {
    method: 'get',
    path: `${adm}/calendar/events`,
    sample: `${adm}/calendar/events?from=2026-10-26&to=2026-11-01`,
    schema: calendarEventsSchema,
    respond: () => calendarEvents,
  },
  {
    method: 'get',
    path: `${adm}/rooms/:roomId/availability`,
    sample: `${adm}/rooms/${ID.principal}/availability?date=${day}`,
    schema: adminAvailabilityDaySchema,
    respond: () => adminAvailabilityDay,
  },
  {
    method: 'get',
    path: `${adm}/bookings`,
    sample: `${adm}/bookings`,
    schema: adminBookingListSchema,
    respond: () => adminBookingList,
  },
  {
    method: 'get',
    path: `${adm}/bookings/export.csv`,
    sample: `${adm}/bookings/export.csv`,
    schema: null,
    respond: () => CSV,
  },
  {
    method: 'get',
    path: `${adm}/bookings/:id`,
    sample: `${adm}/bookings/${ID.booking}`,
    schema: adminBookingDetailSchema,
    respond: () => adminBookingDetail,
  },
  {
    method: 'post',
    path: `${adm}/bookings`,
    sample: `${adm}/bookings`,
    schema: staffBookingCreatedSchema,
    status: 201,
    respond: () => staffBookingCreated,
  },
  {
    method: 'post',
    path: `${adm}/bookings/:id/confirm-manual`,
    sample: `${adm}/bookings/${ID.booking}/confirm-manual`,
    schema: bookingDetailSchema,
    respond: () => bookingDetail,
  },
  {
    method: 'post',
    path: `${adm}/bookings/:id/resend-link`,
    sample: `${adm}/bookings/${ID.booking}/resend-link`,
    schema: resendLinkResultSchema,
    respond: () => resendLinkResult,
  },
  {
    method: 'post',
    path: `${adm}/bookings/:id/check-in`,
    sample: `${adm}/bookings/${ID.booking}/check-in`,
    schema: bookingDetailSchema,
    respond: () => bookingDetail,
  },
  {
    method: 'patch',
    path: `${adm}/bookings/:id/cleanup`,
    sample: `${adm}/bookings/${ID.booking}/cleanup`,
    schema: bookingDetailSchema,
    respond: () => bookingDetail,
  },
  {
    method: 'post',
    path: `${adm}/bookings/:id/reschedule`,
    sample: `${adm}/bookings/${ID.booking}/reschedule`,
    schema: rescheduleResultSchema,
    respond: () => rescheduleResult,
  },
  {
    method: 'get',
    path: `${adm}/bookings/:id/cancellation-preview`,
    sample: `${adm}/bookings/${ID.booking}/cancellation-preview`,
    schema: adminCancellationPreviewSchema,
    respond: () => adminCancellationPreview,
  },
  {
    method: 'post',
    path: `${adm}/bookings/:id/cancel`,
    sample: `${adm}/bookings/${ID.booking}/cancel`,
    schema: bookingDetailSchema,
    respond: () => bookingCancelled,
  },
  {
    method: 'get',
    path: `${adm}/customers/search`,
    sample: `${adm}/customers/search?q=camila`,
    schema: customerSearchResultSchema,
    respond: () => customerSearch,
  },
  {
    method: 'post',
    path: `${adm}/customers`,
    sample: `${adm}/customers`,
    schema: customerCreatedSchema,
    status: 201,
    respond: () => customerCreated,
  },
];

function toHandler(route: RouteSpec): HttpHandler {
  return http[route.method](`*${route.path}`, ({ request, params }) => {
    const body = route.respond({ url: new URL(request.url), params });
    if ((body === null || body === undefined) && route.status !== 204) {
      return apiError(404, 'NOT_FOUND', 'Recurso não encontrado.');
    }
    if (route.status === 204) return new HttpResponse(null, { status: 204 });
    if (typeof body === 'string') {
      const type = route.path.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/calendar';
      return new HttpResponse(body, {
        status: route.status ?? 200,
        headers: { 'Content-Type': type },
      });
    }
    return HttpResponse.json(body as Parameters<typeof HttpResponse.json>[0], {
      status: route.status ?? 200,
    });
  });
}

/** Default handlers for all núcleo routes; tests override single routes with `server.use`. */
export const handlers: HttpHandler[] = routes.map(toHandler);
