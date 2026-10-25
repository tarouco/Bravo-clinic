import { describe, expect, it } from 'vitest';
import {
  parseSetting,
  SettingValidationError,
  settingDefaults,
  settingKeys,
  settingsCatalog,
} from './catalog';

// docs/architecture.md section 4 plus gestao design `usage.limits`, written out literally
// (key -> factory default).
const expectedDefaults: Record<string, unknown> = {
  'calendar.slot_minutes': 30,
  'calendar.default_booking_minutes': 60,
  'calendar.cleanup_minutes': 30,
  'calendar.min_advance_minutes': 0,
  'calendar.max_advance_days': 90,
  'calendar.holiday_review_reminder': { month: 10, day: 1 },
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
  'policy.version': 1,
  'clinic.whatsapp_e164': '',
  'clinic.contact_email': '',
  'clinic.address_line': 'Praia Brava, Itajaí – SC',
  'onboarding.prices_reviewed': false,
  'notifications.events': {
    new_booking: true,
    payment_received: true,
    booking_cancelled: true,
    new_subscription: true,
    renewal_failed: true,
    pre_reservation_expired: true,
    new_quote_request: true,
  },
  'mcp.enabled': false,
  'mcp.rate_limit_per_minute': 60,
  'usage.limits': {
    dbBytes: 536870912,
    storageBytes: 1073741824,
    emailsPerMonth: 3000,
    emailsPerDay: 100,
  },
};

describe('settings catalog (FND-18)', () => {
  it('defines exactly the keys of architecture section 4', () => {
    expect([...settingKeys].sort()).toEqual(Object.keys(expectedDefaults).sort());
  });

  it('holds the factory default of section 4 for every key', () => {
    expect(settingDefaults()).toEqual(expectedDefaults);
  });

  it('spot-checks the headline defaults', () => {
    const defaults = settingDefaults();
    expect(defaults['payment.deposit_percent']).toBe(50);
    expect(defaults['payment.balance_reminder_hours_before']).toEqual([48, 36, 26]);
    expect(defaults['calendar.cleanup_minutes']).toBe(30);
    expect(defaults['policy.reschedule_window_days']).toBe(60);
  });

  it('defaults usage.limits to the free-tier figures and rejects a zero limit (GES-137)', () => {
    const limits = settingDefaults()['usage.limits'];
    expect(limits.emailsPerMonth).toBe(3000);
    expect(limits).toEqual({
      dbBytes: 512 * 1024 * 1024,
      storageBytes: 1024 * 1024 * 1024,
      emailsPerMonth: 3000,
      emailsPerDay: 100,
    });
    expect(() => parseSetting('usage.limits', { ...limits, emailsPerDay: 0 })).toThrow(
      SettingValidationError,
    );
  });

  it('every default passes its own schema', () => {
    for (const key of settingKeys) {
      const result = settingsCatalog[key].schema.safeParse(settingsCatalog[key].default);
      expect(result.success, key).toBe(true);
    }
  });

  it('settingDefaults returns copies that callers can mutate safely', () => {
    const first = settingDefaults();
    first['payment.balance_reminder_hours_before'].push(1);
    expect(settingDefaults()['payment.balance_reminder_hours_before']).toEqual([48, 36, 26]);
  });
});

describe('parseSetting (FND-19)', () => {
  it('throws SettingValidationError naming payment.deposit_percent for 150', () => {
    expect(() => parseSetting('payment.deposit_percent', 150)).toThrow(SettingValidationError);
    expect(() => parseSetting('payment.deposit_percent', 150)).toThrow(/payment\.deposit_percent/);
  });

  it('throws for calendar.slot_minutes 25 and names the key', () => {
    expect(() => parseSetting('calendar.slot_minutes', 25)).toThrow(SettingValidationError);
    expect(() => parseSetting('calendar.slot_minutes', 25)).toThrow(/calendar\.slot_minutes/);
  });

  it('returns the parsed value when it is valid', () => {
    expect(parseSetting('calendar.slot_minutes', 15)).toBe(15);
    expect(parseSetting('payment.deposit_percent', 0)).toBe(0);
    expect(parseSetting('payment.deposit_percent', 100)).toBe(100);
  });

  it('enforces the documented bounds and shapes', () => {
    expect(() => parseSetting('calendar.cleanup_minutes', 241)).toThrow(SettingValidationError);
    expect(() => parseSetting('payment.deposit_percent', 49.5)).toThrow(SettingValidationError);
    expect(() => parseSetting('payment.balance_reminder_hours_before', [26, 36])).toThrow(
      SettingValidationError,
    );
    expect(() => parseSetting('policy.clinic_cancel_options', ['refund', 'pix'])).toThrow(
      SettingValidationError,
    );
    expect(() => parseSetting('clinic.whatsapp_e164', '123')).toThrow(SettingValidationError);
    expect(parseSetting('clinic.whatsapp_e164', '+5547999990000')).toBe('+5547999990000');
    expect(parseSetting('clinic.whatsapp_e164', '')).toBe('');
    expect(parseSetting('clinic.contact_email', '')).toBe('');
    expect(() => parseSetting('clinic.contact_email', 'nope')).toThrow(SettingValidationError);
    expect(() => parseSetting('policy.version', 0)).toThrow(SettingValidationError);
  });
});
