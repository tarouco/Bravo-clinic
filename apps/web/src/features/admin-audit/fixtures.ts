import { parseFixture } from '../../test/fixtures/parse';
import { auditPageSchema, type AuditPage } from './contracts';

// Audit fixtures for the web tests, validated against the response contract (AD-035).

/** A web action by an admin, an MCP cancellation with a justification, and a job without a user. */
export function buildAuditPage(nextCursor: string | null = null): AuditPage {
  return parseFixture(
    auditPageSchema,
    {
      items: [
        {
          id: 3,
          at: '2026-10-26T15:00:00.000Z',
          actorUserId: '55555555-5555-4555-8555-555555555555',
          actorName: 'Carla Mendes',
          actorRole: 'admin',
          origin: 'mcp',
          action: 'mcp.booking_cancel',
          entityType: 'booking',
          entityId: 'b1000000-0000-4000-8000-000000000001',
          justification: 'Cliente pediu o cancelamento por telefone',
          before: { status: 'confirmed' },
          after: { status: 'cancelled_by_clinic' },
        },
        {
          id: 2,
          at: '2026-10-26T14:00:00.000Z',
          actorUserId: '55555555-5555-4555-8555-555555555555',
          actorName: 'Carla Mendes',
          actorRole: 'admin',
          origin: 'web',
          action: 'room.update',
          entityType: 'room',
          entityId: 'a1000000-0000-4000-8000-000000000001',
          justification: null,
          before: { name: 'Sala Aurora' },
          after: { name: 'Sala Aurora 2' },
        },
        {
          id: 1,
          at: '2026-10-26T09:00:00.000Z',
          actorUserId: null,
          actorName: null,
          actorRole: null,
          origin: 'job',
          action: 'job.recurring_expenses',
          entityType: 'expense',
          entityId: null,
          justification: null,
          before: null,
          after: null,
        },
      ],
      nextCursor,
    },
    'auditPage',
  );
}
