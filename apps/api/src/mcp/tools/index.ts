import type { ToolDefinition } from '../server';
import { financeTools } from './finance';
import { nucleoTools } from './nucleo';
import { receitaTools } from './receita';

// The MCP tool catalog (gestao design "MCP tool catalog"). Gestao-backed tools are added by the
// tasks that build their services; `tools/list` follows the design table order.

/** Design table order; tools missing from it are listed after these, by name. */
export const CATALOG_ORDER = [
  'agenda_list',
  'availability_get',
  'booking_get',
  'bookings_search',
  'booking_create',
  'pre_reservation_create',
  'booking_confirm_manual',
  'booking_check_in',
  'booking_resend_payment_link',
  'booking_reschedule',
  'booking_cancel',
  'refund_create',
  'block_create',
  'block_remove',
  'slot_discount_apply',
  'slot_discount_remove',
  'subscriptions_list',
  'subscription_sell',
  'subscription_cancel',
  'coupons_list',
  'coupon_create',
  'coupon_set_enabled',
  'credit_grant',
  'customers_search',
  'customer_get',
  'customer_notes_update',
  'finance_summary',
  'finance_dre',
  'expenses_list',
  'expense_create',
  'expense_delete',
  'manual_receipt_create',
  'quotes_list',
  'quote_update_status',
  'rooms_list',
  'categories_list',
  'policies_get',
  'audit_list',
];

const rank = (name: string) => {
  const index = CATALOG_ORDER.indexOf(name);
  return index === -1 ? CATALOG_ORDER.length : index;
};

/** Every tool the MCP server exposes, in catalog order. */
export function mcpToolCatalog(): ToolDefinition[] {
  return [...nucleoTools(), ...receitaTools(), ...financeTools()].sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  );
}
