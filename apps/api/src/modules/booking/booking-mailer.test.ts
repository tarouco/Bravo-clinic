import { describe, expect, it } from 'vitest';
import { bookingIcs } from './booking-mailer';

const booking = {
  icsUid: 'uid-1@bravoclinic.test',
  icsSequence: 2,
  code: 'BRV-ABC123',
  startsAt: new Date('2026-10-27T13:00:00.000Z'),
  endsAt: new Date('2026-10-27T15:00:00.000Z'),
};
const ctx = { roomName: 'Sala Bravô', clinicAddress: 'Praia Brava, Itajaí – SC' };

describe('bookingIcs (NUC-136, NUC-137)', () => {
  it('uses the booking times without the cleanup, the stable UID and the current SEQUENCE', () => {
    const lines = bookingIcs(booking, ctx, 'REQUEST').split('\r\n');

    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('UID:uid-1@bravoclinic.test');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines).toContain('DTSTART:20261027T130000Z');
    expect(lines).toContain('DTEND:20261027T150000Z');
  });

  it('summarizes as "Reserva Bravô Clinic — <sala>" at the clinic address', () => {
    const lines = bookingIcs(booking, ctx, 'REQUEST').split('\r\n');

    expect(lines).toContain('SUMMARY:Reserva Bravô Clinic — Sala Bravô');
    expect(lines).toContain('LOCATION:Praia Brava\\, Itajaí – SC');
  });

  it('cancels with METHOD:CANCEL and the same UID', () => {
    const lines = bookingIcs({ ...booking, icsSequence: 3 }, ctx, 'CANCEL').split('\r\n');

    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('UID:uid-1@bravoclinic.test');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('STATUS:CANCELLED');
  });
});
