import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { users } from '../../db/schema';
import type { Rendered } from '../../emails/templates/layout';
import {
  cancelledTemplate,
  compensationTemplate,
  creditGrantedTemplate,
  endedTemplate,
  extraHoursPurchasedTemplate,
  lateRefundTemplate,
  nextPeriodConflictsTemplate,
  periodEndingTemplate,
  priceChangeTemplate,
  renewalApprovedTemplate,
  renewalChargeTemplate,
  renewalFailedTemplate,
  renewalReminderTemplate,
  saleLinkTemplate,
  subscriptionActivatedTemplate,
  suspendedTemplate,
  switchedTemplate,
  type RevenueTemplate,
} from '../../emails/templates/revenue';
import type { EmailAttachment } from '../../lib/email';
import { emitTenantMail } from '../notifications/notifications.service';

// The single receita notification helper (AD-025, gestao R7): every receita service queues tenant
// e-mails through it, routed through gestao's `emit()` (T43), which also pushes the catalog text to
// the addressee's devices once the caller dispatches the outbox id. Each function writes one
// outbox row in the caller's transaction and returns its id. Dedupe keys are chosen by the call
// site (design.md "E-mail templates"), e.g. `subscription.activated:<subId>`.

export interface MailTarget {
  to: string;
  dedupeKey?: string;
  attachments?: EmailAttachment[];
}

function mailer<D>(template: RevenueTemplate, render: (data: D) => Rendered) {
  return async (tx: Tx, target: MailTarget, data: D): Promise<string> => {
    const rendered = render(data);
    // The push goes to the account that owns the address, when there is one.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.email, target.to));
    return emitTenantMail(tx, {
      name: template,
      entityId: target.dedupeKey ?? target.to,
      ...(owner !== undefined && { userId: owner.id }),
      to: target.to,
      data: data as Record<string, unknown>,
      email: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(target.dedupeKey !== undefined && { dedupeKey: target.dedupeKey }),
        ...(target.attachments !== undefined && { attachments: target.attachments }),
      },
    });
  };
}

export const revenueMailer = {
  'subscription.activated': mailer('subscription.activated', subscriptionActivatedTemplate),
  'subscription.renewal_charge': mailer('subscription.renewal_charge', renewalChargeTemplate),
  'subscription.renewal_reminder': mailer('subscription.renewal_reminder', renewalReminderTemplate),
  'subscription.renewal_approved': mailer('subscription.renewal_approved', renewalApprovedTemplate),
  'subscription.renewal_failed': mailer('subscription.renewal_failed', renewalFailedTemplate),
  'subscription.suspended': mailer('subscription.suspended', suspendedTemplate),
  'subscription.ended': mailer('subscription.ended', endedTemplate),
  'subscription.cancelled': mailer('subscription.cancelled', cancelledTemplate),
  'subscription.switched': mailer('subscription.switched', switchedTemplate),
  'subscription.period_ending': mailer('subscription.period_ending', periodEndingTemplate),
  'subscription.price_change': mailer('subscription.price_change', priceChangeTemplate),
  'subscription.next_period_conflicts': mailer(
    'subscription.next_period_conflicts',
    nextPeriodConflictsTemplate,
  ),
  'subscription.sale_link': mailer('subscription.sale_link', saleLinkTemplate),
  'extra_hours.purchased': mailer('extra_hours.purchased', extraHoursPurchasedTemplate),
  'credit.granted': mailer('credit.granted', creditGrantedTemplate),
  'subscription.compensation': mailer('subscription.compensation', compensationTemplate),
  'payment.late_refund': mailer('payment.late_refund', lateRefundTemplate),
} satisfies Record<RevenueTemplate, unknown>;
