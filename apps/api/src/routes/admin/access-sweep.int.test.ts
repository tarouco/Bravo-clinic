import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, seededRoom } from '../../../test/booking-helpers';
import { APP_ORIGIN, forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { runSeed } from '../../db/seed';

// Reception restrictions end to end (T44, GES-117..GES-120): every mounted `/admin/*` route is
// classified as reception-allowlisted (design §Reception allowlist) or admin-only, and an
// MFA-verified reception session is swept over all of them.

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');

type Route = `${'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} /admin/${string}`;

/** Design §Reception allowlist: the only `/admin/*` routes reception may call. */
const RECEPTION_ALLOWLIST: readonly Route[] = [
  // fundacao
  'GET /admin/session',
  // nucleo
  'GET /admin/calendar/events',
  'GET /admin/rooms/:roomId/availability',
  'GET /admin/calendar/closed-days',
  'GET /admin/bookings',
  'GET /admin/bookings/export.csv',
  'GET /admin/bookings/:id',
  'POST /admin/bookings',
  'POST /admin/bookings/:id/resend-link',
  'POST /admin/bookings/:id/check-in',
  'GET /admin/blocks',
  'POST /admin/blocks',
  'DELETE /admin/blocks/:id',
  'GET /admin/customers/search',
  'POST /admin/customers',
  // receita
  'GET /admin/slot-discounts',
  'GET /admin/subscriptions',
  'GET /admin/subscriptions/:id',
  'GET /admin/subscriptions/:id/ledger',
  'GET /admin/customers/:userId/credits',
  // gestao (GET /admin/customers* and the notes)
  'GET /admin/customers',
  'GET /admin/customers/:id',
  'GET /admin/customers/:id/bookings',
  'PATCH /admin/customers/:id/notes',
];

/** Everything else is admin only: reception gets 403 FORBIDDEN. */
const ADMIN_ONLY: readonly Route[] = [
  // calendar config, holidays and closed days
  'GET /admin/calendar/config',
  'PUT /admin/calendar/business-hours',
  'PUT /admin/calendar/settings',
  'GET /admin/calendar/holidays',
  'POST /admin/calendar/holidays',
  'POST /admin/calendar/holidays/import',
  'PATCH /admin/calendar/holidays/:id',
  'DELETE /admin/calendar/holidays/:id',
  'GET /admin/calendar/closed-days/preview',
  'POST /admin/calendar/closed-days',
  'DELETE /admin/calendar/closed-days/:id',
  // policies
  'GET /admin/settings/policies',
  'PUT /admin/settings/policies',
  // block recurrences
  'GET /admin/block-recurrences',
  'POST /admin/block-recurrences',
  'DELETE /admin/block-recurrences/:id',
  // categories and onboarding
  'GET /admin/categories',
  'POST /admin/categories',
  'POST /admin/categories/reorder',
  'PATCH /admin/categories/:id',
  'POST /admin/categories/:id/reference',
  'POST /admin/onboarding/prices-reviewed',
  // booking changes beyond the counter flow
  'POST /admin/bookings/:id/reschedule',
  'GET /admin/bookings/:id/cancellation-preview',
  'POST /admin/bookings/:id/cancel',
  'POST /admin/bookings/:id/confirm-manual',
  'PATCH /admin/bookings/:id/cleanup',
  // credits and customer profile changes
  'POST /admin/customers/:userId/credits',
  'PATCH /admin/customers/:id',
  'POST /admin/customers/:id/anonymize',
  // coupons and slot discounts
  'GET /admin/coupons',
  'POST /admin/coupons',
  'PUT /admin/coupons/:id',
  'PATCH /admin/coupons/:id/enabled',
  'GET /admin/coupons/:id/uses',
  'POST /admin/slot-discounts',
  'DELETE /admin/slot-discounts/:id',
  // subscription sale and changes
  'POST /admin/subscriptions/quote',
  'POST /admin/subscriptions',
  'POST /admin/subscriptions/:id/cancel',
  'POST /admin/subscriptions/:id/adjust-balance',
  'POST /admin/subscriptions/:id/resend-link',
  // Integrações (GES-120)
  'GET /admin/integrations/calendar',
  'POST /admin/integrations/calendar/feeds',
  'DELETE /admin/integrations/calendar/feeds/:id',
  'GET /admin/integrations/gateway',
  'PUT /admin/integrations/gateway/:provider',
  'POST /admin/integrations/gateway/:provider/test',
  'POST /admin/integrations/gateway/:provider/activate',
  'GET /admin/integrations/notifications',
  'POST /admin/integrations/notifications/recipients',
  'PATCH /admin/integrations/notifications/recipients/:id',
  'DELETE /admin/integrations/notifications/recipients/:id',
  'PUT /admin/integrations/notifications/events',
  'POST /admin/integrations/notifications/test',
  'GET /admin/integrations/outbox',
  'GET /admin/integrations/mcp',
  'PUT /admin/integrations/mcp',
  'POST /admin/integrations/mcp/tokens',
  'DELETE /admin/integrations/mcp/tokens/:id',
  // Financeiro
  'GET /admin/finance/expense-categories',
  'POST /admin/finance/expense-categories',
  'PATCH /admin/finance/expense-categories/:id',
  'GET /admin/finance/expenses',
  'POST /admin/finance/expenses',
  'PATCH /admin/finance/expenses/:id',
  'DELETE /admin/finance/expenses/:id',
  'PUT /admin/finance/expenses/:id/attachment',
  'GET /admin/finance/expenses/:id/attachment',
  'DELETE /admin/finance/expenses/:id/attachment',
  'GET /admin/finance/receipts',
  'POST /admin/finance/receipts',
  'DELETE /admin/finance/receipts/:id',
  'GET /admin/finance/summary',
  'GET /admin/finance/dre.xlsx',
  // extras and quotes
  'GET /admin/extra-services',
  'POST /admin/extra-services',
  'PATCH /admin/extra-services/:id',
  'GET /admin/quote-requests',
  'PATCH /admin/quote-requests/:id',
  // rooms
  'GET /admin/rooms',
  'POST /admin/rooms',
  'PATCH /admin/rooms/:id',
  'PUT /admin/rooms/:id/photo-uploads/:uploadId/:variant',
  'POST /admin/rooms/:id/photos',
  'PUT /admin/rooms/:id/photos/order',
  'PATCH /admin/rooms/:id/photos/:photoId',
  'DELETE /admin/rooms/:id/photos/:photoId',
  // users, audit, usage
  'GET /admin/users',
  'POST /admin/users',
  'PATCH /admin/users/:id',
  'POST /admin/users/:id/totp-reset',
  'GET /admin/audit',
  'GET /admin/usage',
];

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

/** Every mounted `/admin/*` endpoint (`use()` middleware is registered as method `ALL`). */
function mountedAdminRoutes(): string[] {
  const keys = buildApp()
    .routes.filter((r) => r.method !== 'ALL' && r.path.startsWith('/admin/'))
    .map((r) => `${r.method} ${r.path}`);
  return [...new Set(keys)];
}

const SAMPLE_PARAMS: Record<string, string> = { provider: 'sandbox', variant: 'large' };

/** A concrete URL for a route pattern: ids become a fresh UUID. */
function concrete(path: string, roomId: string): string {
  return path.replace(/:(\w+)/g, (_match, name: string) =>
    name === 'roomId' ? roomId : (SAMPLE_PARAMS[name] ?? randomUUID()),
  );
}

/** Calls the route as `cookie` with a JSON body for writes; answers status and error code. */
async function call(app: ReturnType<typeof buildApp>, route: string, cookie: string, url: string) {
  const [method = 'GET'] = route.split(' ');
  const response = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN, Cookie: cookie },
    ...(method !== 'GET' && { body: '{}' }),
  });
  const isJson = response.headers.get('Content-Type')?.includes('application/json') === true;
  const body = isJson ? ((await response.json()) as { error?: { code?: string } } | null) : null;
  return { status: response.status, code: body?.error?.code ?? null };
}

let roomId = '';
let reception = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  roomId = (await seededRoom(db)).id;
  reception = (await createStaff(db, 'reception', NOW)).cookie;
});

describe('admin route classification (GES-118)', () => {
  it('classifies every mounted /admin/* route exactly once, and lists no unmounted route', () => {
    const mounted = mountedAdminRoutes();
    const classified: string[] = [...RECEPTION_ALLOWLIST, ...ADMIN_ONLY];

    const unclassified = mounted.filter((route) => !classified.includes(route));
    const twice = classified.filter((route, i) => classified.indexOf(route) !== i);
    const unmounted = classified.filter((route) => !mounted.includes(route));

    expect({ unclassified, twice, unmounted }).toEqual({
      unclassified: [],
      twice: [],
      unmounted: [],
    });
    expect(mounted).toHaveLength(classified.length);
  });
});

describe('reception sweep over every /admin/* route (GES-117, GES-120)', () => {
  it('lets reception through every allowlisted route (never 403)', async () => {
    const app = buildApp();
    const answers: string[] = [];
    for (const route of RECEPTION_ALLOWLIST) {
      const { status, code } = await call(
        app,
        route,
        reception,
        concrete(route.split(' ')[1] ?? '', roomId),
      );
      // 401 would mean the reception session itself was refused, not the route.
      const refused = status === 401 || status === 403;
      answers.push(`${route} -> ${refused ? `${String(status)} ${String(code)}` : 'allowed'}`);
    }

    expect(answers).toEqual(RECEPTION_ALLOWLIST.map((route) => `${route} -> allowed`));
  });

  it('answers 403 FORBIDDEN to reception on every admin-only route, Integrações included', async () => {
    const app = buildApp();
    const answers: string[] = [];
    for (const route of ADMIN_ONLY) {
      const { status, code } = await call(
        app,
        route,
        reception,
        concrete(route.split(' ')[1] ?? '', roomId),
      );
      answers.push(`${route} -> ${String(status)} ${String(code)}`);
    }

    expect(answers).toEqual(ADMIN_ONLY.map((route) => `${route} -> 403 FORBIDDEN`));
  });

  it('refuses a reception booking created with confirmManually (403 FORBIDDEN)', async () => {
    const res = await send(buildApp(), 'POST', '/admin/bookings', {
      cookie: reception,
      body: {
        kind: 'booking',
        userId: randomUUID(),
        roomId,
        date: '2026-10-27',
        startMinute: 600,
        endMinute: 720,
        confirmManually: true,
        justification: 'Pagamento recebido no balcão',
      },
    });

    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
  });
});
