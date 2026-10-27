import { customerNotesSchema, idSchema, quoteStatusSchema } from '@bravo/core';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import {
  getCustomerDetail,
  saveCustomerNotes,
  searchCustomerProfiles,
} from '../../modules/customers/customers.service';
import { listQuoteRequests, updateQuoteRequest } from '../../modules/extras/quote-requests.service';
import { listAdminRooms } from '../../modules/rooms/rooms-admin.service';
import { defineTool, type ToolDefinition } from '../server';

// gestao admin-operations tools of design "MCP tool catalog" (AD-028): the same services as the
// Admin screens (quotes, rooms, customers, audit).

export function operationsTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'customers_search',
      description:
        'Busca clientes (locatários) por nome, e-mail, dígitos do CPF/CNPJ ou do telefone; 50 por página.',
      scope: 'read',
      input: z.object({
        q: z.string().max(120),
        cursor: z.string().min(1).max(200).optional(),
      }),
      run: (tc, input) => searchCustomerProfiles(tc.deps.db, input),
    }),
    defineTool({
      name: 'customer_get',
      description:
        'Ficha de um cliente: perfil, reservas recentes, assinaturas com saldo, minutos extras, créditos, cupons, consentimentos e pedidos de orçamento.',
      scope: 'read',
      input: z.object({ id: idSchema }),
      run: (tc, { id }) => getCustomerDetail(tc.deps.db, id, tc.now),
    }),
    defineTool({
      name: 'customer_notes_update',
      description:
        'Substitui as anotações internas da equipe sobre um cliente (até 4000 caracteres).',
      scope: 'write',
      input: customerNotesSchema.extend({ id: idSchema }),
      run: (tc, { id, notes }) =>
        withTransaction(tc.deps.db, (tx) => saveCustomerNotes(tx, tc.ctx, id, notes, tc.now)),
    }),
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
    defineTool({
      name: 'rooms_list',
      description:
        'Lista as salas (ativas e inativas) com descrição, itens "ideal para", equipamentos e fotos.',
      scope: 'read',
      input: z.object({}),
      run: (tc) => listAdminRooms(tc.deps.db),
    }),
  ];
}
