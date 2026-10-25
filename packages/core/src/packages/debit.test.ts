import { describe, expect, it } from 'vitest';
import { formatDebitDetail, packageDebitMinutes, vPacCents, type PackageRate } from './debit';

// docs/architecture.md section 7.8 worked examples (REC-22). V_ref = 9700 ("1 hora" weekday).
const pacote20h: PackageRate = { priceCents: 160000, includedMinutes: 1200 }; // V_pac 8000
const V_REF = 9700;

describe('packageDebitMinutes (REC-22)', () => {
  it('Tue 10:00–12:00: V_slot 8000 ≤ V_ref → 120', () => {
    const r = packageDebitMinutes({
      segments: [{ minutes: 120, vSlotCentsPerHour: 8000 }],
      vRefCentsPerHour: V_REF,
      pkg: pacote20h,
    });
    expect(r.minutes).toBe(120);
    expect(r.extraMinutesExact).toEqual({ num: 0n, den: 1n });
  });

  it('Wed 19:00–20:00: 2300 × 60 / 8000 = 17.25 → 78, exact extra 69/4', () => {
    const r = packageDebitMinutes({
      segments: [{ minutes: 60, vSlotCentsPerHour: 12000 }],
      vRefCentsPerHour: V_REF,
      pkg: pacote20h,
    });
    expect(r.minutes).toBe(78);
    expect(r.extraMinutesExact).toEqual({ num: 69n, den: 4n });
    expect(Number(r.extraMinutesExact.num) / Number(r.extraMinutesExact.den)).toBe(17.25);
  });

  it('Sat 10:00–13:00: 200 × 180 / 8000 = 4.5 → 185', () => {
    expect(
      packageDebitMinutes({
        segments: [{ minutes: 180, vSlotCentsPerHour: 9900 }],
        vRefCentsPerHour: V_REF,
        pkg: pacote20h,
      }).minutes,
    ).toBe(185);
  });

  it('Briefing: V_ref 5000, V_pac 5000, V_slot 7000, 60 min → 84', () => {
    const pkg: PackageRate = { priceCents: 100000, includedMinutes: 1200 };
    expect(vPacCents(pkg)).toBe(5000);
    const r = packageDebitMinutes({
      segments: [{ minutes: 60, vSlotCentsPerHour: 7000 }],
      vRefCentsPerHour: 5000,
      pkg,
    });
    expect(r.minutes).toBe(84);
    expect(r.extraMinutesExact).toEqual({ num: 24n, den: 1n });
  });

  it('Tue 17:30–20:00: 90 min at 8000 + 60 min at 9900 → 0 + 1.5 → 152', () => {
    const r = packageDebitMinutes({
      segments: [
        { minutes: 90, vSlotCentsPerHour: 8000 },
        { minutes: 60, vSlotCentsPerHour: 9900 },
      ],
      vRefCentsPerHour: V_REF,
      pkg: pacote20h,
    });
    expect(r.minutes).toBe(152);
    expect(r.extraMinutesExact).toEqual({ num: 3n, den: 2n });
  });

  it('applies one ceiling to the summed extra: 1.5 + 1.5 → +3, not +4', () => {
    expect(
      packageDebitMinutes({
        segments: [
          { minutes: 60, vSlotCentsPerHour: 9900 },
          { minutes: 60, vSlotCentsPerHour: 9900 },
        ],
        vRefCentsPerHour: V_REF,
        pkg: pacote20h,
      }).minutes,
    ).toBe(123);
  });

  it('V_slot equal to V_ref debits exactly the duration', () => {
    expect(
      packageDebitMinutes({
        segments: [{ minutes: 90, vSlotCentsPerHour: V_REF }],
        vRefCentsPerHour: V_REF,
        pkg: pacote20h,
      }).minutes,
    ).toBe(90);
  });
});

describe('vPacCents (REC-33, REC-63)', () => {
  it('Pacote 20h mensal 160000 / 1200 min → 8000', () => {
    expect(vPacCents({ priceCents: 160000, includedMinutes: 1200 })).toBe(8000);
  });

  it('rounds half up: 100000 / 1800 → 3333; 50000 / 1800 → 1667; 1 / 120 → 1', () => {
    expect(vPacCents({ priceCents: 100000, includedMinutes: 1800 })).toBe(3333);
    expect(vPacCents({ priceCents: 50000, includedMinutes: 1800 })).toBe(1667);
    expect(vPacCents({ priceCents: 1, includedMinutes: 120 })).toBe(1);
  });
});

describe('formatDebitDetail (REC-41)', () => {
  it('Wed: "60 min + 18 min de excedente = 78 min"', () => {
    expect(formatDebitDetail({ durationMinutes: 60, debitMinutes: 78 })).toBe(
      '60 min + 18 min de excedente = 78 min',
    );
  });

  it('Tue: "120 min" when there is no extra', () => {
    expect(formatDebitDetail({ durationMinutes: 120, debitMinutes: 120 })).toBe('120 min');
  });
});
