import { parseTriggerDelivery } from '@neon/functions/triggers';

/** The platform's proof that a request is a Function Trigger delivery. */
export interface TriggerDelivery {
  invocationId: string;
}

/**
 * Authenticates a `/jobs/*` request (AD-007, NUC-195). The Neon Functions proxy drops
 * client-supplied `x-neon-*` headers, so a present `x-neon-trigger-invocation-id` that matches the
 * body's `invocation_id` can only come from a real trigger delivery; `parseTriggerDelivery` checks
 * exactly that. Anything else, a user session included, is refused. Tests replace this through
 * `AppDeps.verifyTrigger`.
 */
export async function verifyTriggerRequest(request: Request): Promise<TriggerDelivery | null> {
  const parsed = await parseTriggerDelivery(request);
  return parsed.ok ? { invocationId: parsed.invocation.invocationId } : null;
}
