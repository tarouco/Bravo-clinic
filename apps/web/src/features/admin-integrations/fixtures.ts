import { parseFixture } from '../../test/fixtures/parse';
import {
  calendarOverviewSchema,
  gatewayOverviewSchema,
  notificationsOverviewSchema,
  outboxPageSchema,
  type CalendarOverview,
  type GatewayOverview,
  type NotificationsOverview,
} from './contracts';

// Integrações fixtures for the web tests, validated against the response contracts (AD-035).

export interface GatewayFixtureOptions {
  /** Provider marked active; the sandbox by default. */
  activeProvider?: string;
  productionWarning?: boolean;
  /** Mercado Pago already configured and enabled (production), with a stored secret. */
  mercadoPagoConfigured?: boolean;
}

/** Sandbox (no fields, always usable) and Mercado Pago (two secrets and a public key). */
export function buildGateway(options: GatewayFixtureOptions = {}): GatewayOverview {
  const configured = options.mercadoPagoConfigured ?? true;
  return parseFixture(
    gatewayOverviewSchema,
    {
      activeProvider: options.activeProvider ?? 'sandbox',
      productionWarning: options.productionWarning ?? false,
      adapters: [
        {
          provider: 'sandbox',
          label: 'Sandbox (simulado)',
          fields: [],
          configured: true,
          enabled: true,
          environment: 'test',
          secretHint: null,
          config: {},
          webhookUrl: 'https://bravoclinic.example/api/webhooks/pagamentos/sandbox',
        },
        {
          provider: 'mercadopago',
          label: 'Mercado Pago',
          fields: [
            { key: 'accessToken', label: 'Access token', secret: true },
            { key: 'webhookSecret', label: 'Assinatura secreta do webhook', secret: true },
            { key: 'publicKey', label: 'Public key', secret: false },
          ],
          configured,
          enabled: configured,
          environment: configured ? 'production' : null,
          secretHint: configured ? '••••a1b2' : null,
          config: configured ? { publicKey: 'APP_USR-public-key' } : {},
          webhookUrl: 'https://bravoclinic.example/api/webhooks/pagamentos/mercadopago',
        },
      ],
    },
    'gatewayOverview',
  );
}

// ---- Calendário ----

export const ROOM_IDS = {
  aurora: '10000000-0000-4000-8000-000000000001',
  boreal: '10000000-0000-4000-8000-000000000002',
} as const;

export interface CalendarFixtureOptions {
  /** Clinic feed already issued; false leaves the clinic without a link. */
  clinicFeed?: boolean;
}

/** Two rooms; the clinic feed (optional) and the Aurora feed are active, Boreal has none. */
export function buildCalendar(options: CalendarFixtureOptions = {}): CalendarOverview {
  return parseFixture(
    calendarOverviewSchema,
    {
      feeds: [
        ...(options.clinicFeed === false
          ? []
          : [
              {
                id: 'fd000000-0000-4000-8000-000000000001',
                scope: 'clinic',
                roomId: null,
                roomName: null,
                prefix: 'k3Hx9Q',
                createdAt: '2026-10-20T13:00:00.000Z',
              },
            ]),
        {
          id: 'fd000000-0000-4000-8000-000000000002',
          scope: 'room',
          roomId: ROOM_IDS.aurora,
          roomName: 'Sala Aurora',
          prefix: 'Zp41aB',
          createdAt: '2026-10-21T13:00:00.000Z',
        },
      ],
      rooms: [
        { id: ROOM_IDS.aurora, name: 'Sala Aurora' },
        { id: ROOM_IDS.boreal, name: 'Sala Boreal' },
      ],
    },
    'calendarOverview',
  );
}

export const ISSUED_FEED_URL = 'https://bravoclinic.example/api/ics/tok_9aXk2LmQpR7vWz.ics';

// ---- E-mails ----

export interface NotificationsFixtureOptions {
  providerConfigured?: boolean;
}

export const RECIPIENT_IDS = {
  carla: 'a0000000-0000-4000-8000-000000000001',
  rui: 'a0000000-0000-4000-8000-000000000002',
} as const;

/** Two recipients (one paused); the cancelled and expired notices are off. */
export function buildNotifications(
  options: NotificationsFixtureOptions = {},
): NotificationsOverview {
  return parseFixture(
    notificationsOverviewSchema,
    {
      providerConfigured: options.providerConfigured ?? true,
      recipients: [
        { id: RECIPIENT_IDS.carla, email: 'carla@bravo.example', active: true },
        { id: RECIPIENT_IDS.rui, email: 'rui@bravo.example', active: false },
      ],
      events: {
        new_booking: true,
        payment_received: true,
        booking_cancelled: false,
        new_subscription: true,
        renewal_failed: true,
        pre_reservation_expired: false,
        new_quote_request: true,
      },
    },
    'notificationsOverview',
  );
}

export const outboxPage = parseFixture(
  outboxPageSchema,
  {
    items: [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        to: 'carla@bravo.example',
        template: 'staff.new_booking',
        subject: 'Nova reserva BRV-7K2Q9X',
        status: 'sent',
        attempts: 1,
        lastError: null,
        createdAt: '2026-10-25T15:30:00.000Z',
        sentAt: '2026-10-25T15:30:02.000Z',
      },
      {
        id: 'b0000000-0000-4000-8000-000000000002',
        to: 'ana@example.com',
        template: 'booking.confirmed',
        subject: 'Reserva confirmada',
        status: 'failed',
        attempts: 3,
        lastError: 'Resend: domínio não verificado',
        createdAt: '2026-10-24T12:00:00.000Z',
        sentAt: null,
      },
    ],
    nextCursor: null,
  },
  'outboxPage',
);
