import { z } from 'zod';

/**
 * Who may see a setting. `public` values are safe to expose without authentication,
 * `staff` values are managed in the Admin, `system` values are written by the system only.
 */
export type SettingScope = 'public' | 'staff' | 'system';

interface SettingDefinition {
  schema: z.ZodType;
  default: unknown;
  scope: SettingScope;
}

// Typing `defaultValue` as the schema output makes a default that violates its schema a compile error.
function setting<S extends z.ZodType>(schema: S, defaultValue: z.output<S>, scope: SettingScope) {
  return { schema, default: defaultValue, scope };
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const reminderHours = z
  .array(int(1, 720))
  .refine((hours) => hours.every((h, i) => i === 0 || h < (hours[i - 1] ?? 0)), {
    error: 'Reminder hours must be strictly descending',
  });

const clinicCancelOption = z.enum(['refund', 'minutes', 'credit']);

const emailOrEmpty = z
  .string()
  .refine((v) => v === '' || z.email().safeParse(v).success, { error: 'Invalid e-mail' });

// Cross-field rules of docs/architecture.md section 4 (multiple of slot, deadline < charge hours,
// reminders between deadline and charge, extra_hours_min <= extra_hours_max) belong to the Admin
// settings service of the feature that edits them; a per-key schema cannot see the other keys.
export const settingsCatalog = {
  'calendar.slot_minutes': setting(z.literal([5, 10, 15, 20, 30, 60]), 30, 'public'),
  'calendar.default_booking_minutes': setting(int(15, 480), 60, 'public'),
  'calendar.cleanup_minutes': setting(int(0, 240), 30, 'public'),
  'calendar.min_advance_minutes': setting(int(0, 10080), 0, 'public'),
  'calendar.max_advance_days': setting(int(1, 365), 90, 'public'),
  'calendar.holiday_review_reminder': setting(
    z.object({ month: int(1, 12), day: int(1, 31) }),
    { month: 10, day: 1 },
    'staff',
  ),
  'payment.active_gateway': setting(z.enum(['sandbox', 'mercadopago']), 'sandbox', 'staff'),
  'payment.deposit_percent': setting(int(0, 100), 50, 'public'),
  'payment.deposit_refundable': setting(z.boolean(), false, 'public'),
  'payment.balance_charge_hours_before': setting(int(1, 720), 48, 'public'),
  'payment.balance_deadline_hours_before': setting(int(1, 720), 24, 'public'),
  'payment.balance_reminder_hours_before': setting(reminderHours, [48, 36, 26], 'staff'),
  'payment.full_upfront_threshold_hours': setting(int(0, 720), 48, 'public'),
  'payment.checkout_hold_minutes': setting(int(5, 120), 15, 'public'),
  'payment.pre_reservation_expiry_hours': setting(int(1, 720), 24, 'staff'),
  'payment.subscription_renewal_days_before': setting(int(0, 30), 2, 'public'),
  'payment.renewal_grace_days': setting(int(0, 60), 7, 'public'),
  'payment.extra_hours_min': setting(int(1, 100), 1, 'public'),
  'payment.extra_hours_max': setting(int(1, 100), 20, 'public'),
  'payment.extra_hours_validity_days': setting(int(1, 365), 90, 'public'),
  'payment.closed_day_compensation_enabled': setting(z.boolean(), true, 'public'),
  'credits.validity_days': setting(int(1, 730), 90, 'public'),
  'policy.reschedule_free_count': setting(int(0, 10), 1, 'public'),
  'policy.reschedule_min_hours_before': setting(int(0, 720), 24, 'public'),
  'policy.reschedule_window_days': setting(int(1, 365), 60, 'public'),
  'policy.cancel_refund_min_hours_before': setting(int(0, 720), 24, 'public'),
  'policy.package_cancel_return_min_hours_before': setting(int(0, 720), 24, 'public'),
  'policy.no_show_after_minutes': setting(int(5, 240), 30, 'public'),
  'policy.clinic_cancel_options': setting(
    z
      .array(clinicCancelOption)
      .min(1)
      .refine((options) => new Set(options).size === options.length, {
        error: 'Options must be unique',
      }),
    ['refund', 'minutes', 'credit'],
    'public',
  ),
  'policy.version': setting(int(1, Number.MAX_SAFE_INTEGER), 1, 'system'),
  'clinic.whatsapp_e164': setting(z.string().regex(/^(\+?\d{12,13})?$/), '', 'public'),
  'clinic.contact_email': setting(emailOrEmpty, '', 'public'),
  'clinic.address_line': setting(z.string().max(200), 'Praia Brava, Itajaí – SC', 'public'),
  'onboarding.prices_reviewed': setting(z.boolean(), false, 'staff'),
  'notifications.events': setting(
    z.object({
      new_booking: z.boolean(),
      payment_received: z.boolean(),
      booking_cancelled: z.boolean(),
      new_subscription: z.boolean(),
      renewal_failed: z.boolean(),
      pre_reservation_expired: z.boolean(),
      new_quote_request: z.boolean(),
    }),
    {
      new_booking: true,
      payment_received: true,
      booking_cancelled: true,
      new_subscription: true,
      renewal_failed: true,
      pre_reservation_expired: true,
      new_quote_request: true,
    },
    'staff',
  ),
  'mcp.enabled': setting(z.boolean(), false, 'staff'),
  'mcp.rate_limit_per_minute': setting(int(1, 600), 60, 'staff'),
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof settingsCatalog;
export type SettingValue<K extends SettingKey> = z.output<(typeof settingsCatalog)[K]['schema']>;

/** Every catalog key, in catalog order. */
export const settingKeys = Object.keys(settingsCatalog) as SettingKey[];

export class SettingValidationError extends Error {
  readonly key: string;

  constructor(key: string, detail: string) {
    super(`Invalid value for setting ${key}: ${detail}`);
    this.name = 'SettingValidationError';
    this.key = key;
  }
}

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingsCatalog, key);
}

/** Validates `value` against the schema of `key`; throws `SettingValidationError` when it fails. */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  if (!isSettingKey(key)) throw new SettingValidationError(key, 'unknown setting key');
  const result = settingsCatalog[key].schema.safeParse(value);
  if (!result.success) {
    throw new SettingValidationError(key, result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data as SettingValue<K>;
}

/** Factory defaults for every key. Returns fresh copies, so callers may mutate the result. */
export function settingDefaults(): { [K in SettingKey]: SettingValue<K> } {
  const out: Record<string, unknown> = {};
  for (const key of settingKeys) out[key] = structuredClone(settingsCatalog[key].default);
  return out as { [K in SettingKey]: SettingValue<K> };
}
