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
  policiesPublicSchema,
  policySettingsSchema,
  preReservationPublicSchema,
  quoteSchema,
  renderPolicyText,
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
  type PolicySnapshot,
} from '@bravo/core';
import { parseFixture } from './parse';

// Contract fixtures for the núcleo web tests (AD-035). Every fixture is parsed by its core schema
// when this module loads, so a contract change fails the web tests. Values follow the spec worked
// examples: Sala Principal, factory settings, `now = 2026-10-20T12:00:00Z`, PR-3 on 2026-10-27.

export const ID = {
  principal: '11111111-1111-4111-8111-111111111111',
  secundaria: '11111111-1111-4111-8111-222222222222',
  terceira: '11111111-1111-4111-8111-333333333333',
  booking: '22222222-2222-4222-8222-222222222222',
  bookingOther: '22222222-2222-4222-8222-333333333333',
  catHour: '33333333-3333-4333-8333-111111111111',
  catTwoHours: '33333333-3333-4333-8333-222222222222',
  catHourNight: '33333333-3333-4333-8333-333333333333',
  catTwoHoursNight: '33333333-3333-4333-8333-444444444444',
  catHalfShift: '33333333-3333-4333-8333-555555555555',
  catFullShift: '33333333-3333-4333-8333-666666666666',
  charge: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
  block: '66666666-6666-4666-8666-666666666666',
  holiday: '77777777-7777-4777-8777-777777777777',
  closedDay: '77777777-7777-4777-8777-888888888888',
  recurrence: '77777777-7777-4777-8777-999999999999',
  card: '88888888-8888-4888-8888-888888888888',
  request: '99999999-9999-4999-8999-999999999999',
} as const;

export const NOW_ISO = '2026-10-20T12:00:00.000Z';
export const TOKEN = 'tok-pre-reserva-123';

// ---- Rooms, catalog, clinic, policies ----

const roomBase = {
  description: 'Sala clínica com maca motorizada e foco cirúrgico.',
  idealFor: ['Médico', 'Estética Avançada'],
  equipment: ['Maca motorizada', 'Foco cirúrgico', 'Pia de assepsia'],
  fromPriceCents: 8000,
};

const principal = {
  ...roomBase,
  id: ID.principal,
  slug: 'principal',
  name: 'Sala Principal',
  cover: { url: '/media/principal-large.webp', alt: 'Sala Principal', width: 1600, height: 1000 },
};
const secundaria = {
  ...roomBase,
  id: ID.secundaria,
  slug: 'secundaria',
  name: 'Sala Secundária',
  idealFor: ['Nutrição', 'Telemedicina'],
  cover: null,
};
const terceira = {
  ...roomBase,
  id: ID.terceira,
  slug: 'terceira',
  name: 'Sala Terceira',
  idealFor: ['Massoterapia', 'Fisioterapia'],
  cover: null,
};

export const roomList = parseFixture(
  roomListSchema,
  { items: [principal, secundaria, terceira] },
  'roomList',
);

export const roomDetail = parseFixture(
  roomDetailSchema,
  {
    ...principal,
    photos: [
      principal.cover,
      {
        url: '/media/principal-2.webp',
        alt: 'Bancada da Sala Principal',
        width: 1600,
        height: 1000,
      },
    ],
  },
  'roomDetail',
);

export const roomDetails = {
  principal: roomDetail,
  secundaria: parseFixture(
    roomDetailSchema,
    { ...secundaria, photos: [] },
    'roomDetail.secundaria',
  ),
  terceira: parseFixture(roomDetailSchema, { ...terceira, photos: [] }, 'roomDetail.terceira'),
} as const;

const allDays = [1, 2, 3, 4, 5, 6, 7];

const hourlyCategories = [
  {
    id: ID.catHour,
    name: '1 hora',
    weekdays: allDays,
    appliesOnHolidays: true,
    startMinute: 0,
    endMinute: 1140,
    weekdayRateCents: 9700,
    weekendRateCents: 12000,
    minDurationMinutes: 60,
    displayOrder: 1,
    isReference: true,
  },
  {
    id: ID.catTwoHours,
    name: '2 horas ou mais',
    weekdays: allDays,
    appliesOnHolidays: true,
    startMinute: 0,
    endMinute: 1140,
    weekdayRateCents: 8000,
    weekendRateCents: 9900,
    minDurationMinutes: 120,
    displayOrder: 2,
    isReference: false,
  },
  {
    id: ID.catHourNight,
    name: '1 hora — noite',
    weekdays: allDays,
    appliesOnHolidays: true,
    startMinute: 1140,
    endMinute: 1440,
    weekdayRateCents: 12000,
    weekendRateCents: 12000,
    minDurationMinutes: 60,
    displayOrder: 3,
    isReference: false,
  },
  {
    id: ID.catTwoHoursNight,
    name: '2 horas ou mais — noite',
    weekdays: allDays,
    appliesOnHolidays: true,
    startMinute: 1140,
    endMinute: 1440,
    weekdayRateCents: 9900,
    weekendRateCents: 9900,
    minDurationMinutes: 120,
    displayOrder: 4,
    isReference: false,
  },
];

export const catalog = parseFixture(
  catalogSchema,
  {
    hourly: hourlyCategories,
    blocks: [
      {
        id: ID.catHalfShift,
        name: 'Meio turno comercial',
        weekdays: [1, 2, 3, 4, 5],
        appliesOnHolidays: false,
        startMinute: 420,
        endMinute: 570,
        fixedPriceCents: 28000,
        averageHourlyCents: 11200,
      },
      {
        id: ID.catFullShift,
        name: 'Turno completo comercial',
        weekdays: [1, 2, 3, 4, 5],
        appliesOnHolidays: false,
        startMinute: 420,
        endMinute: 720,
        fixedPriceCents: 50000,
        averageHourlyCents: 10000,
      },
    ],
    pricesReviewed: true,
  },
  'catalog',
);

export const businessHours = [
  { dayType: 'mon', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'tue', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'wed', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'thu', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'fri', isClosed: false, openMinute: 420, closeMinute: 1440 },
  { dayType: 'sat', isClosed: false, openMinute: 540, closeMinute: 1440 },
  { dayType: 'sun', isClosed: true, openMinute: 540, closeMinute: 1440 },
  { dayType: 'holiday', isClosed: false, openMinute: 540, closeMinute: 1440 },
] as const;

export const clinic = parseFixture(
  clinicSchema,
  {
    addressLine: 'Praia Brava, Itajaí - SC',
    whatsappE164: '+5547999990000',
    contactEmail: 'contato@bravoclinic.com.br',
    businessHours,
  },
  'clinic',
);

const policyValues = {
  'payment.active_gateway': 'sandbox',
  'payment.deposit_percent': 50,
  'payment.deposit_refundable': false,
  'payment.balance_charge_hours_before': 48,
  'payment.balance_deadline_hours_before': 24,
  'payment.balance_reminder_hours_before': [48, 36, 26],
  'payment.full_upfront_threshold_hours': 48,
  'payment.checkout_hold_minutes': 15,
  'payment.pre_reservation_expiry_hours': 24,
  'payment.subscription_renewal_days_before': 2,
  'payment.renewal_grace_days': 7,
  'payment.extra_hours_min': 1,
  'payment.extra_hours_max': 20,
  'payment.extra_hours_validity_days': 90,
  'payment.closed_day_compensation_enabled': true,
  'credits.validity_days': 90,
  'policy.reschedule_free_count': 1,
  'policy.reschedule_min_hours_before': 24,
  'policy.reschedule_window_days': 60,
  'policy.cancel_refund_min_hours_before': 24,
  'policy.package_cancel_return_min_hours_before': 24,
  'policy.no_show_after_minutes': 30,
  'policy.clinic_cancel_options': ['refund', 'minutes', 'credit'],
};

export const policyValuesFixture = policyValues;

const policySnapshotValue = { ...policyValues, 'policy.version': 1 };
const policySections = renderPolicyText(policySnapshotValue as unknown as PolicySnapshot);

export const policies = parseFixture(
  policiesPublicSchema,
  { version: 1, values: policySnapshotValue, sections: policySections },
  'policies',
);

export const policySettings = parseFixture(
  policySettingsSchema,
  { version: 1, values: policyValues },
  'policySettings',
);

// ---- Availability (W-CL CL-4 on 2026-10-27) ----

const SLOT = 30;
const MIN_BOOKING = 60;
const CLEANUP = 30;

/** CL-4 occupancy: bookings 09:00-11:00 and 14:00-16:00 (cleanup 30 after each). */
const CL4_OCCUPIED: [start: number, end: number][] = [
  [540, 660],
  [840, 960],
];

/** Public grid cells for a 07:00-24:00 window with the given booked intervals (cleanup applied). */
export function buildCells(
  occupied: [number, number][],
  window: { openMinute: number; closeMinute: number } = { openMinute: 420, closeMinute: 1440 },
) {
  const blocked = occupied.map(([s, e]) => [s, e + CLEANUP] as const);
  const cells: { startMinute: number; available: boolean; maxEndMinute: number | null }[] = [];
  for (let start = window.openMinute; start < window.closeMinute; start += SLOT) {
    const inside = blocked.some(([s, e]) => start >= s && start < e);
    const nextStart = occupied.map(([s]) => s).find((s) => s > start);
    const maxEnd = Math.min(
      window.closeMinute,
      nextStart === undefined ? window.closeMinute : nextStart - CLEANUP,
    );
    const available = !inside && maxEnd - start >= MIN_BOOKING;
    cells.push({ startMinute: start, available, maxEndMinute: available ? maxEnd : null });
  }
  return cells;
}

export function buildAvailabilityDay(date: string, roomSlug = 'principal') {
  const closed = date === '2026-12-25';
  const isHoliday = date === '2026-11-02';
  return {
    date,
    roomSlug,
    isHoliday,
    holidayName: isHoliday ? 'Finados' : null,
    closed,
    outOfRange: false,
    window: closed ? null : { openMinute: 420, closeMinute: 1440 },
    slotMinutes: SLOT,
    minBookingMinutes: MIN_BOOKING,
    cells: closed ? [] : buildCells(date === '2026-10-27' ? CL4_OCCUPIED : []),
    blockOptions: closed
      ? []
      : [
          {
            categoryId: ID.catHalfShift,
            name: 'Meio turno comercial',
            startMinute: 420,
            endMinute: 570,
            priceCents: 28000,
            available: date !== '2026-10-27',
          },
        ],
  };
}

export const availabilityDay = parseFixture(
  availabilityDaySchema,
  buildAvailabilityDay('2026-10-27'),
  'availabilityDay',
);

export const adminAvailabilityDay = parseFixture(
  adminAvailabilityDaySchema,
  {
    ...buildAvailabilityDay('2026-10-27'),
    cells: buildCells(CL4_OCCUPIED).map((cell) => ({
      ...cell,
      adminState: cell.available ? 'free' : 'booking',
    })),
  },
  'adminAvailabilityDay',
);

/** Month grid: Oct/2026 days before the 26th are past; 2026-11-02 is the Finados holiday. */
export function buildAvailabilityMonth(month: string) {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const isHoliday = date === '2026-11-02';
    const status =
      date < '2026-10-26' ? 'past' : date === '2026-12-25' ? 'closed' : ('available' as const);
    return {
      date,
      status,
      isHoliday,
      holidayName: isHoliday ? 'Finados' : null,
      hasDiscount: false,
    };
  });
  return { month, days };
}

export const availabilityMonth = parseFixture(
  availabilityMonthSchema,
  buildAvailabilityMonth('2026-10'),
  'availabilityMonth',
);

// ---- Quote, bookings, charges ----

const pr3Segments = [
  {
    startMinute: 1050,
    endMinute: 1140,
    minutes: 90,
    categoryId: ID.catTwoHours,
    categoryName: '2 horas ou mais',
    dayType: 'weekday',
    rateCentsPerHour: 8000,
    amountCents: 12000,
  },
  {
    startMinute: 1140,
    endMinute: 1200,
    minutes: 60,
    categoryId: ID.catTwoHoursNight,
    categoryName: '2 horas ou mais — noite',
    dayType: 'weekday',
    rateCentsPerHour: 9900,
    amountCents: 9900,
  },
];

export const quote = parseFixture(
  quoteSchema,
  {
    roomId: ID.principal,
    roomSlug: 'principal',
    roomName: 'Sala Principal',
    date: '2026-10-27',
    startMinute: 1050,
    endMinute: 1200,
    durationMinutes: 150,
    blockCategoryId: null,
    segments: pr3Segments,
    grossCents: 21900,
    discount: { source: 'none', cents: 0, label: null },
    extrasCents: 0,
    netCents: 21900,
    creditAvailableCents: 0,
    payment: {
      mode: 'deposit_balance',
      depositCents: 10950,
      balanceCents: 10950,
      payNowCents: 10950,
      creditUsedCents: 0,
      balanceChargeAt: '2026-10-25T20:30:00.000Z',
      balanceDueAt: '2026-10-26T20:30:00.000Z',
    },
    policyVersion: 1,
    holdMinutes: 15,
    lines: [
      { kind: 'segment', label: '17:30–19:00 · 2 horas ou mais', amountCents: 12000 },
      { kind: 'segment', label: '19:00–20:00 · 2 horas ou mais — noite', amountCents: 9900 },
      { kind: 'total', label: 'Total', amountCents: 21900 },
      { kind: 'deposit', label: 'Sinal', amountCents: 10950 },
      { kind: 'balance', label: 'Saldo', amountCents: 10950 },
    ],
    notices: [],
    extensions: {},
  },
  'quote',
);

const summaryBase = {
  id: ID.booking,
  code: 'BRV-7K2Q9X',
  kind: 'single',
  roomId: ID.principal,
  roomSlug: 'principal',
  roomName: 'Sala Principal',
  startsAt: '2026-10-27T20:30:00.000Z',
  endsAt: '2026-10-27T23:00:00.000Z',
  totalCents: 21900,
  balanceDueAt: '2026-10-26T20:30:00.000Z',
  group: null,
};

const detailBase = {
  ...summaryBase,
  segments: pr3Segments,
  grossCents: 21900,
  discountCents: 0,
  discountSource: 'none',
  creditAppliedCents: 0,
  depositCents: 10950,
  paymentMode: 'deposit_balance',
  cleanupMinutes: 30,
  rescheduleCount: 0,
  checkedInAt: null,
  source: 'web',
  refunds: [],
  pendingReschedule: null,
  policy: { version: 1, sections: policySections },
};

const approvedDeposit = {
  id: ID.charge,
  purpose: 'booking_deposit',
  method: 'pix',
  amountCents: 10950,
  status: 'approved',
  createdAt: '2026-10-20T12:01:00.000Z',
  approvedAt: '2026-10-20T12:03:00.000Z',
};

/** Confirmed booking with the deposit paid; the balance is pending. */
export const bookingDetail = parseFixture(
  bookingDetailSchema,
  {
    ...detailBase,
    status: 'confirmed',
    statusLabel: 'Confirmada',
    paymentStatus: { code: 'deposit_paid', label: 'Sinal pago · saldo pendente' },
    paidCents: 10950,
    balanceCents: 10950,
    holdExpiresAt: null,
    charges: [approvedDeposit],
    actions: {
      canPay: false,
      canPayBalance: true,
      canReschedule: true,
      rescheduleBlockedReason: null,
      canCancel: true,
    },
  },
  'bookingDetail',
);

/** Booking just created: holding the slot until `holdExpiresAt`. */
export const bookingAwaitingPayment = parseFixture(
  bookingDetailSchema,
  {
    ...detailBase,
    status: 'awaiting_payment',
    statusLabel: 'Aguardando pgto',
    paymentStatus: { code: 'awaiting', label: 'Aguardando pagamento' },
    paidCents: 0,
    balanceCents: 21900,
    holdExpiresAt: '2026-10-20T12:15:00.000Z',
    charges: [],
    actions: {
      canPay: true,
      canPayBalance: false,
      canReschedule: false,
      rescheduleBlockedReason: 'status',
      canCancel: true,
    },
  },
  'bookingAwaitingPayment',
);

export const bookingCancelled = parseFixture(
  bookingDetailSchema,
  {
    ...detailBase,
    status: 'cancelled_by_tenant',
    statusLabel: 'Cancelada pelo locatário',
    paymentStatus: { code: 'none', label: '—' },
    paidCents: 10950,
    balanceCents: 0,
    holdExpiresAt: null,
    charges: [approvedDeposit],
    actions: {
      canPay: false,
      canPayBalance: false,
      canReschedule: false,
      rescheduleBlockedReason: 'status',
      canCancel: false,
    },
  },
  'bookingCancelled',
);

export const bookingList = parseFixture(
  bookingListSchema,
  {
    items: [
      {
        ...summaryBase,
        status: 'confirmed',
        statusLabel: 'Confirmada',
        paymentStatus: { code: 'deposit_paid', label: 'Sinal pago · saldo pendente' },
        paidCents: 10950,
        balanceCents: 10950,
        holdExpiresAt: null,
      },
    ],
    nextCursor: null,
  },
  'bookingList',
);

export const chargeIntent = parseFixture(
  chargeIntentSchema,
  {
    chargeId: ID.charge,
    method: 'pix',
    status: 'pending',
    amountCents: 10950,
    expiresAt: '2026-10-20T12:15:00.000Z',
    pixQrCodeBase64: 'iVBORw0KGgo=',
    pixCopyPaste: '00020126SANDBOX',
    checkoutUrl: null,
  },
  'chargeIntent',
);

export const rescheduleQuote = parseFixture(
  rescheduleQuoteSchema,
  {
    allowed: true,
    reason: null,
    message: null,
    newQuote: quote,
    settlement: { payNowCents: 0, creditCents: 0, newTotalCents: 21900, newBalanceCents: 10950 },
  },
  'rescheduleQuote',
);

export const rescheduleResult = parseFixture(
  rescheduleResultSchema,
  { ...bookingDetail, rescheduleCount: 1, creditCents: 0 },
  'rescheduleResult',
);

export const cancellationPreview = parseFixture(
  cancellationPreviewSchema,
  { retainedCents: 10950, refundCents: 0, minutesReturned: 0, creditCents: 0 },
  'cancellationPreview',
);

export const preReservation = parseFixture(
  preReservationPublicSchema,
  {
    bookingId: ID.booking,
    code: 'BRV-7K2Q9X',
    roomName: 'Sala Principal',
    startsAt: '2026-10-27T20:30:00.000Z',
    endsAt: '2026-10-27T23:00:00.000Z',
    totalCents: 21900,
    holdExpiresAt: '2026-10-21T12:00:00.000Z',
    customerFirstName: 'Camila',
  },
  'preReservation',
);

export const paymentConfig = parseFixture(
  paymentConfigSchema,
  { provider: 'sandbox', publicKey: null, environment: 'test' },
  'paymentConfig',
);

export const sandboxCharge = parseFixture(
  sandboxChargeSchema,
  {
    id: ID.charge,
    amountCents: 10950,
    method: 'pix',
    status: 'pending',
    purpose: 'booking_deposit',
    bookingCode: 'BRV-7K2Q9X',
    bookingId: ID.booking,
    expiresAt: '2026-10-20T12:15:00.000Z',
    pixCopyPaste: '00020126SANDBOX',
  },
  'sandboxCharge',
);

export const sandboxApproved = parseFixture(
  sandboxActionSchema,
  { status: 'approved' },
  'sandboxApproved',
);

export const savedCard = parseFixture(
  savedCardSchema,
  {
    id: ID.card,
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
    recurringConsentAt: '2026-10-01T12:00:00.000Z',
  },
  'savedCard',
);
export const savedCardList = parseFixture(
  savedCardListSchema,
  { items: [savedCard] },
  'savedCardList',
);

export const me = parseFixture(
  meSchema,
  {
    id: ID.user,
    name: 'Camila Souza',
    email: 'camila@example.com',
    role: 'tenant',
    emailVerified: true,
    docType: 'cpf',
    mfa: { enrolled: false, verified: false },
    phone: '+5547999990001',
    profession: 'Dermatologista',
    professionalRegistry: null,
    document: '52998224725',
  },
  'me',
);

// ---- Admin ----

export const calendarConfig = parseFixture(
  calendarConfigSchema,
  {
    businessHours,
    settings: {
      slotMinutes: 30,
      defaultBookingMinutes: 60,
      cleanupMinutes: 30,
      minAdvanceMinutes: 0,
      maxAdvanceDays: 90,
    },
    warnings: [],
    onboarding: { pricesReviewed: true },
  },
  'calendarConfig',
);

export const businessHoursResponse = parseFixture(
  businessHoursResponseSchema,
  { businessHours },
  'businessHoursResponse',
);

export const calendarSettingsResult = parseFixture(
  calendarSettingsResultSchema,
  { settings: calendarConfig.settings, warnings: [] },
  'calendarSettingsResult',
);

export const holiday = parseFixture(
  holidaySchema,
  {
    id: ID.holiday,
    date: '2026-11-02',
    name: 'Finados',
    scope: 'national',
    source: 'seed',
    isClosed: false,
    needsReview: false,
    alert: true,
  },
  'holiday',
);
export const holidayList = parseFixture(holidayListSchema, { items: [holiday] }, 'holidayList');
export const holidayImportResult = parseFixture(
  holidayImportResultSchema,
  { inserted: 3, updated: 1 },
  'holidayImportResult',
);

const closedDay = {
  id: ID.closedDay,
  date: '2026-12-24',
  roomId: null,
  roomName: null,
  reason: 'Recesso',
};
export const closedDayList = parseFixture(
  closedDayListSchema,
  { items: [closedDay] },
  'closedDayList',
);

const compensation = { subscribers: 0, minutes: 0, creditCents: 0, fixedOccurrencesCancelled: 0 };
export const closedDayPreview = parseFixture(
  closedDayPreviewSchema,
  {
    affectedBookings: [
      {
        id: ID.booking,
        code: 'BRV-7K2Q9X',
        customerName: 'Camila Souza',
        roomName: 'Sala Principal',
        startsAt: '2026-10-27T20:30:00.000Z',
        endsAt: '2026-10-27T23:00:00.000Z',
        status: 'confirmed',
      },
    ],
    compensation,
  },
  'closedDayPreview',
);
export const closedDayCreated = parseFixture(
  closedDayCreateResultSchema,
  { items: [closedDay], compensation },
  'closedDayCreated',
);

const block = {
  id: ID.block,
  roomId: ID.principal,
  tag: 'Limpeza',
  startsAt: '2026-10-27T18:00:00.000Z',
  endsAt: '2026-10-27T19:00:00.000Z',
  recurrenceId: null,
};
export const blockList = parseFixture(blockListSchema, { items: [block] }, 'blockList');
export const blockCreated = parseFixture(
  blockCreateResultSchema,
  { items: [block] },
  'blockCreated',
);

const recurrence = {
  id: ID.recurrence,
  roomId: ID.principal,
  tag: 'Limpeza profunda',
  weekdays: [1],
  startMinute: 420,
  endMinute: 480,
  validFrom: '2026-10-26',
  validUntil: null,
  active: true,
};
export const recurrenceList = parseFixture(
  blockRecurrenceListSchema,
  { items: [recurrence] },
  'recurrenceList',
);
export const recurrenceCreated = parseFixture(
  blockRecurrenceCreateResultSchema,
  { items: [recurrence], created: 12, skipped: [] },
  'recurrenceCreated',
);

export const adminCategory = parseFixture(
  adminCategorySchema,
  {
    id: ID.catHour,
    name: '1 hora',
    type: 'hourly',
    weekdays: allDays,
    appliesOnHolidays: true,
    startMinute: 0,
    endMinute: 1140,
    weekdayRateCents: 9700,
    weekendRateCents: 12000,
    minDurationMinutes: 60,
    fixedPriceCents: null,
    pricePerOccurrenceCents: null,
    includedMinutes: null,
    period: 'single',
    isReference: true,
    status: 'active',
    visibility: 'public',
    roomId: null,
    displayOrder: 1,
    version: 1,
    averageHourlyCents: 9700,
    editable: true,
  },
  'adminCategory',
);
export const adminCategoryList = parseFixture(
  adminCategoryListSchema,
  { items: [adminCategory] },
  'adminCategoryList',
);

export const calendarEvents = parseFixture(
  calendarEventsSchema,
  {
    bookings: [
      {
        id: ID.booking,
        code: 'BRV-7K2Q9X',
        firstName: 'Camila',
        fullName: 'Camila Souza',
        roomId: ID.principal,
        roomName: 'Sala Principal',
        status: 'confirmed',
        statusLabel: 'Confirmada',
        paidCents: 10950,
        totalCents: 21900,
        packageMinutes: 0,
        startsAt: '2026-10-27T20:30:00.000Z',
        endsAt: '2026-10-27T23:00:00.000Z',
        cleanupUntil: '2026-10-27T23:30:00.000Z',
        categoryNames: ['2 horas ou mais', '2 horas ou mais — noite'],
        checkedInAt: null,
        holdExpiresAt: null,
      },
    ],
    blocks: [block],
    closedDays: [closedDay],
    holidays: [holiday],
  },
  'calendarEvents',
);

const customer = { name: 'Camila Souza', email: 'camila@example.com' };

export const adminBookingList = parseFixture(
  adminBookingListSchema,
  {
    items: [
      {
        ...bookingList.items[0],
        customerName: customer.name,
        customerEmail: customer.email,
        source: 'web',
      },
    ],
    nextCursor: null,
  },
  'adminBookingList',
);

export const adminBookingDetail = parseFixture(
  adminBookingDetailSchema,
  {
    ...bookingDetail,
    customer: { id: ID.user, ...customer, phone: '+5547999990001' },
  },
  'adminBookingDetail',
);

export const staffBookingCreated = parseFixture(
  staffBookingCreatedSchema,
  {
    ...bookingAwaitingPayment,
    paymentLink: `https://bravo-clinic.netlify.app/pre-reserva/${TOKEN}`,
  },
  'staffBookingCreated',
);

export const resendLinkResult = parseFixture(
  resendLinkResultSchema,
  { paymentLink: `https://bravo-clinic.netlify.app/pre-reserva/${TOKEN}` },
  'resendLinkResult',
);

export const adminCancellationPreview = parseFixture(
  adminCancellationPreviewSchema,
  {
    retainedCents: 0,
    refundCents: 10950,
    minutesReturned: 0,
    creditCents: 0,
    clinicOptions: ['refund', 'credit'],
  },
  'adminCancellationPreview',
);

export const customerSearch = parseFixture(
  customerSearchResultSchema,
  {
    items: [{ id: ID.user, ...customer, docMasked: '***.982.247-**', phone: '+5547999990001' }],
  },
  'customerSearch',
);

export const customerCreated = parseFixture(
  customerCreatedSchema,
  { id: ID.user, ...customer },
  'customerCreated',
);
