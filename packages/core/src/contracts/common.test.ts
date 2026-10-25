import { describe } from 'vitest';
import {
  adminCellSchema,
  affectedBookingSchema,
  affectedBookingsDetailsSchema,
  apiErrorSchema,
  bookingDetailSchema,
  bookingSummarySchema,
  businessHoursRowSchema,
  chargeIntentSchema,
  cleanupConflictsDetailsSchema,
  paymentPlanSchema,
  photoSchema,
  policySectionSchema,
  policySnapshotSchema,
  policyValuesSchema,
  publicCellSchema,
  quoteLineSchema,
  quoteSchema,
  quoteSegmentSchema,
  roomSummarySchema,
  windowSchema,
} from './common';
import {
  affectedBooking,
  bookingDetail,
  bookingSummary,
  chargeIntent,
  describeContracts,
  paymentPlan,
  policySnapshot,
  policyValues,
  quote,
  roomSummary,
  segments,
  without,
} from './fixtures.test-support';

const segment = segments[0] as Record<string, unknown>;

describe('common contract shapes (NUC-04)', () => {
  describeContracts([
    [
      'windowSchema',
      windowSchema,
      { openMinute: 420, closeMinute: 1440 },
      { openMinute: 600, closeMinute: 600 },
    ],
    [
      'businessHoursRowSchema',
      businessHoursRowSchema,
      { dayType: 'tue', isClosed: false, openMinute: 420, closeMinute: 1440 },
      { dayType: 'tue', isClosed: false, openMinute: 1200, closeMinute: 600 },
    ],
    [
      'photoSchema',
      photoSchema,
      { url: '/media/a.webp', alt: 'Sala', width: 1600, height: 900 },
      { alt: 'Sala', width: 1600, height: 900 },
    ],
    [
      'roomSummarySchema',
      roomSummarySchema,
      roomSummary,
      { ...roomSummary, slug: 'Sala Principal' },
    ],
    [
      'publicCellSchema',
      publicCellSchema,
      { startMinute: 690, available: true, maxEndMinute: 810 },
      { startMinute: 690, available: true, maxEndMinute: 810, adminState: 'free' },
    ],
    [
      'adminCellSchema',
      adminCellSchema,
      { startMinute: 690, available: false, maxEndMinute: null, adminState: 'leftover' },
      { startMinute: 690, available: false, maxEndMinute: null, adminState: 'busy' },
    ],
    ['quoteSegmentSchema', quoteSegmentSchema, segment, without(segment, 'amountCents')],
    [
      'quoteLineSchema',
      quoteLineSchema,
      { kind: 'deposit', label: 'Sinal (50%)', amountCents: 10950, detail: 'até 20/10' },
      { kind: 'tax', label: 'Imposto', amountCents: 10 },
    ],
    ['paymentPlanSchema', paymentPlanSchema, paymentPlan, { ...paymentPlan, mode: 'installments' }],
    ['quoteSchema', quoteSchema, quote, { ...quote, date: '2026-02-30' }],
    [
      'policySectionSchema',
      policySectionSchema,
      { title: 'No-show', paragraphs: ['Sem reembolso.'] },
      { title: 'No-show', paragraphs: [] },
    ],
    [
      'policySnapshotSchema',
      policySnapshotSchema,
      policySnapshot,
      without(policySnapshot, 'policy.version'),
    ],
    [
      'policyValuesSchema',
      policyValuesSchema,
      policyValues,
      { ...policyValues, 'payment.deposit_percent': 150 },
    ],
    [
      'bookingSummarySchema',
      bookingSummarySchema,
      bookingSummary,
      { ...bookingSummary, status: 'booked' },
    ],
    ['bookingDetailSchema', bookingDetailSchema, bookingDetail, without(bookingDetail, 'actions')],
    ['chargeIntentSchema', chargeIntentSchema, chargeIntent, { ...chargeIntent, amountCents: 0 }],
    [
      'affectedBookingSchema',
      affectedBookingSchema,
      affectedBooking,
      { ...affectedBooking, code: 'XYZ-1' },
    ],
    [
      'apiErrorSchema',
      apiErrorSchema,
      {
        error: {
          code: 'SLOT_TAKEN',
          message: 'Este horário acabou de ser reservado.',
          requestId: '01JABCDEFG',
        },
      },
      { error: { code: 'SLOT_TAKEN', message: 'Este horário acabou de ser reservado.' } },
    ],
    [
      'affectedBookingsDetailsSchema',
      affectedBookingsDetailsSchema,
      { bookings: [affectedBooking] },
      { bookings: [] },
    ],
    [
      'cleanupConflictsDetailsSchema',
      cleanupConflictsDetailsSchema,
      {
        pairs: [{ first: affectedBooking, second: { ...affectedBooking, id: bookingSummary.id } }],
      },
      { pairs: [{ first: affectedBooking }] },
    ],
  ]);
});
