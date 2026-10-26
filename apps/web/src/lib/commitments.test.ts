import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { commitmentsOf } from './commitments';

const conflict = (code: string, details: unknown) =>
  new ApiError({ status: 409, code, message: 'x', details: details as never });

describe('commitmentsOf (GES-104, GES-125)', () => {
  it('reads the booking codes and subscription ids of a commitments conflict', () => {
    const details = { bookings: [{ code: 'BRV-7K2Q9X' }], subscriptions: [{ id: 'sub-1' }] };

    expect(commitmentsOf(conflict('ROOM_HAS_FUTURE_COMMITMENTS', details))).toEqual(details);
    expect(commitmentsOf(conflict('HAS_ACTIVE_COMMITMENTS', details))).toEqual(details);
  });

  it('treats missing lists as empty and an unreadable body as no commitments', () => {
    expect(
      commitmentsOf(conflict('HAS_ACTIVE_COMMITMENTS', { bookings: [{ code: 'A' }] })),
    ).toEqual({
      bookings: [{ code: 'A' }],
      subscriptions: [],
    });
    expect(commitmentsOf(conflict('HAS_ACTIVE_COMMITMENTS', 'oops'))).toEqual({
      bookings: [],
      subscriptions: [],
    });
  });

  it('returns null for other conflicts, other statuses and non-API errors', () => {
    expect(commitmentsOf(conflict('LAST_ADMIN', {}))).toBeNull();
    expect(
      commitmentsOf(new ApiError({ status: 422, code: 'HAS_ACTIVE_COMMITMENTS', message: 'x' })),
    ).toBeNull();
    expect(commitmentsOf(new Error('boom'))).toBeNull();
  });
});
