import { idSchema, quoteStatusSchema } from '@bravo/core';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { listQuoteRequests, updateQuoteRequest } from '../../modules/extras/quote-requests.service';
import { defineTool, type ToolDefinition } from '../server';

// gestao admin-operations tools of design "MCP tool catalog" (AD-028): the same services as the
// Admin screens (quotes, rooms, customers, audit).

export function operationsTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'quotes_list',
      description:
        'Lista os pedidos de orçamento de serviços extras, mais recentes primeiro, opcionalmente de um status (new, contacted, quote_sent, won, lost).',
      scope: 'read',
      input: z.object({
        status: quoteStatusSchema.optional(),
        cursor: z.string().min(1).max(200).optional(),
      }),
      run: (tc, input) => listQuoteRequests(tc.deps.db, input),
    }),
    defineTool({
      name: 'quote_update_status',
      description:
        'Move um pedido de orçamento no funil (new → contacted → quote_sent → won/lost, ou qualquer aberto → lost) e, opcionalmente, grava anotações da equipe.',
      scope: 'write',
      input: z.object({
        id: idSchema,
        status: quoteStatusSchema,
        notes: z.string().max(2000, { error: 'Use no máximo 2000 caracteres' }).optional(),
      }),
      run: (tc, { id, status, notes }) =>
        withTransaction(tc.deps.db, (tx) =>
          updateQuoteRequest(
            tx,
            tc.ctx,
            id,
            { status, ...(notes !== undefined && { staffNotes: notes }) },
            tc.now,
          ),
        ),
    }),
  ];
}
