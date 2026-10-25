import { availabilityDaySchema, quoteSchema } from '@bravo/core';
import { describe, expect, it } from 'vitest';
import { availabilityDay, quote } from './nucleo';
import { parseFixture } from './parse';

describe('contract fixtures (AD-035)', () => {
  it('exposes fixtures already parsed by their core schema', () => {
    expect(availabilityDaySchema.safeParse(availabilityDay).success).toBe(true);
    expect(quoteSchema.safeParse(quote).success).toBe(true);
  });

  it('throws when a fixture is missing a required key of its schema', () => {
    const broken = { ...availabilityDay, cells: undefined };

    expect(() => parseFixture(availabilityDaySchema, broken, 'availabilityDay')).toThrow(
      /Fixture "availabilityDay" violates its contract schema/,
    );
  });

  it('throws when a public availability fixture carries an admin-only field (NUC-77)', () => {
    const withAdminField = {
      ...availabilityDay,
      cells: availabilityDay.cells.map((cell) => ({ ...cell, adminState: 'free' })),
    };

    expect(() => parseFixture(availabilityDaySchema, withAdminField, 'availabilityDay')).toThrow(
      /violates its contract schema/,
    );
  });
});
