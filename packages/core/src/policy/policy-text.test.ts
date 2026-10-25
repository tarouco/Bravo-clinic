import { describe, expect, it } from 'vitest';
import { settingDefaults, settingKeys } from '../settings/catalog';
import { policySnapshotSchema } from '../contracts/common';
import { policySnapshot, renderPolicyText } from './policy-text';

const factory = policySnapshot(settingDefaults());
const textOf = (sections: ReturnType<typeof renderPolicyText>) =>
  sections.flatMap((s) => s.paragraphs).join('\n');

describe('policySnapshot (NUC-31)', () => {
  it('has exactly the payment.*, policy.* and credits.validity_days catalog keys', () => {
    const expected = settingKeys.filter(
      (k) => k.startsWith('payment.') || k.startsWith('policy.') || k === 'credits.validity_days',
    );
    expect(Object.keys(factory).sort()).toEqual([...expected].sort());
    expect(Object.keys(factory)).toContain('policy.version');
    expect(Object.keys(factory)).not.toContain('calendar.cleanup_minutes');
  });

  it('copies the current values, including policy.version', () => {
    const values = { ...settingDefaults(), 'policy.version': 3, 'payment.deposit_percent': 30 };
    const snapshot = policySnapshot(values);
    expect(snapshot['policy.version']).toBe(3);
    expect(snapshot['payment.deposit_percent']).toBe(30);
    expect(snapshot['credits.validity_days']).toBe(90);
    expect(snapshot['policy.clinic_cancel_options']).toEqual(['refund', 'minutes', 'credit']);
  });

  it('is the object the policy_snapshot contract accepts', () => {
    expect(policySnapshotSchema.safeParse(factory).success).toBe(true);
  });
});

describe('renderPolicyText (NUC-29, NUC-30)', () => {
  it('renders the four pt-BR sections in order', () => {
    expect(renderPolicyText(factory).map((s) => s.title)).toEqual([
      'Sinal e saldo',
      'Reagendamento',
      'Cancelamento',
      'No-show',
    ]);
  });

  it.each([
    'sinal de 50%',
    'não é reembolsável',
    '48 horas antes',
    '24 horas antes',
    '1 reagendamento cortesia',
  ])('factory text contains "%s"', (phrase) => {
    expect(textOf(renderPolicyText(factory))).toContain(phrase);
  });

  it('states "O sinal é reembolsável" instead of "não é reembolsável" when the deposit is refundable', () => {
    const text = textOf(renderPolicyText({ ...factory, 'payment.deposit_refundable': true }));
    expect(text).toContain('O sinal é reembolsável');
    expect(text).not.toContain('não é reembolsável');
  });

  it('follows the snapshot values', () => {
    const text = textOf(
      renderPolicyText({
        ...factory,
        'payment.deposit_percent': 30,
        'payment.balance_charge_hours_before': 72,
        'policy.reschedule_free_count': 2,
      }),
    );
    expect(text).toContain('sinal de 30%');
    expect(text).toContain('72 horas antes');
    expect(text).toContain('2 reagendamentos cortesia');
  });
});
