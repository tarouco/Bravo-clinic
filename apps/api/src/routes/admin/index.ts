import { Hono } from 'hono';
import { requireRole } from '../../middleware/auth';
import type { AppEnv } from '../../types';
import { adminBlockRoutes } from './blocks';
import { adminBookingCancelRoutes } from './booking-cancel';
import { adminBookingRescheduleRoutes } from './booking-reschedule';
import { adminBookingQueryRoutes } from './booking-queries';
import { adminBookingRoutes } from './bookings';
import { adminCalendarRoutes } from './calendar';
import { adminCalendarExceptionRoutes } from './calendar-exceptions';
import { adminCategoryRoutes } from './categories';
import { adminCouponRoutes } from './coupons';
import { adminCustomerCreditRoutes } from './customer-credits';
import { adminCustomerRoutes } from './customers';
import { adminExtraServiceRoutes } from './extra-services';
import { adminQuoteRequestRoutes } from './quote-requests';
import { adminRoomRoutes } from './rooms';
import { adminFinanceExpenseRoutes } from './finance-expenses';
import { adminFinanceReceiptRoutes } from './finance-receipts';
import { adminFinanceReportRoutes } from './finance-reports';
import { adminIntegrationsCalendarRoutes } from './integrations-calendar';
import { adminIntegrationsGatewayRoutes } from './integrations-gateway';
import { adminIntegrationsMcpRoutes } from './integrations-mcp';
import { adminIntegrationsNotificationRoutes } from './integrations-notifications';
import { adminSessionRoutes } from './session';
import { adminSlotDiscountRoutes } from './slot-discounts';
import { adminSubscriptionRoutes } from './subscriptions';
import { adminSettingsRoutes } from './settings';

/** Everything under `/admin/*`; CSRF, auth and the staff + MFA guard are applied by `createApp`. */
export function adminRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Every Integrações route is admin only, MCP token creation included (GES-120).
  app.use('/integrations', requireRole('admin'));
  app.use('/integrations/*', requireRole('admin'));
  // Financeiro is admin only as well.
  app.use('/finance/*', requireRole('admin'));
  // Serviços extras and the quote funnel are admin only (design §Reception allowlist).
  app.use('/extra-services', requireRole('admin'));
  app.use('/extra-services/*', requireRole('admin'));
  app.use('/quote-requests', requireRole('admin'));
  app.use('/quote-requests/*', requireRole('admin'));
  app.route('/', adminSessionRoutes());
  app.route('/', adminCalendarRoutes());
  app.route('/', adminCalendarExceptionRoutes());
  app.route('/', adminSettingsRoutes());
  app.route('/', adminBlockRoutes());
  app.route('/', adminCategoryRoutes());
  app.route('/', adminBookingRescheduleRoutes());
  app.route('/', adminBookingCancelRoutes());
  app.route('/', adminBookingRoutes());
  app.route('/', adminBookingQueryRoutes());
  app.route('/', adminCustomerRoutes());
  app.route('/', adminCustomerCreditRoutes());
  app.route('/', adminCouponRoutes());
  app.route('/', adminSlotDiscountRoutes());
  app.route('/', adminSubscriptionRoutes());
  app.route('/', adminIntegrationsCalendarRoutes());
  app.route('/', adminIntegrationsGatewayRoutes());
  app.route('/', adminIntegrationsNotificationRoutes());
  app.route('/', adminIntegrationsMcpRoutes());
  app.route('/', adminFinanceExpenseRoutes());
  app.route('/', adminFinanceReceiptRoutes());
  app.route('/', adminFinanceReportRoutes());
  app.route('/', adminExtraServiceRoutes());
  app.route('/', adminQuoteRequestRoutes());
  app.route('/', adminRoomRoutes());
  return app;
}
