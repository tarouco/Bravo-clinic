import type { Tx } from '../../db/client';
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
import { queueEmail, type EmailAttachment } from '../../lib/email';

// The single receita notification helper (AD-025, gestao R7): every receita service queues tenant
// e-mails through it, and gestao rewires it to `emit()`. Each function writes one outbox row in
// the caller's transaction and returns its id. Dedupe keys are chosen by the call site
// (design.md "E-mail templates"), e.g. `subscription.activated:<subId>`.

export interface MailTarget {
  to: string;
  dedupeKey?: string;
  attachments?: EmailAttachment[];
}

function mailer<D>(template: RevenueTemplate, render: (data: D) => Rendered) {
  return (tx: Tx, target: MailTarget, data: D): Promise<string> => {
    const rendered = render(data);
    return queueEmail(tx, {
      to: target.to,
      template,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(target.dedupeKey !== undefined && { dedupeKey: target.dedupeKey }),
      ...(target.attachments !== undefined && { attachments: target.attachments }),
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
