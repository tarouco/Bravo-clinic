import {
  POLICY_SNAPSHOT_KEYS,
  type PolicySettings,
  type PolicyValues,
  type SettingsValues,
} from '@bravo/core';
import { isDeepStrictEqual } from 'node:util';
import type { Db, Tx } from '../../db/client';
import { audit, type RequestContext } from '../../lib/audit';
import { loadSettings, saveSetting } from './settings.repo';

const EDITABLE_KEYS = POLICY_SNAPSHOT_KEYS.filter(
  (key) => key !== 'policy.version',
) as (keyof PolicyValues)[];

function policiesOf(values: SettingsValues): PolicySettings {
  const policy: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) policy[key] = values[key];
  return { version: values['policy.version'], values: policy as PolicyValues };
}

/** Every editable `payment.*`, `policy.*` and `credits.validity_days` value plus the read-only version (NUC-172). */
export async function getPolicySettings(db: Db | Tx): Promise<PolicySettings> {
  return policiesOf(await loadSettings(db));
}

/**
 * Saves the policy values (NUC-173 is validated by the request schema). A change increments
 * `policy.version` and is audited; an identical PUT leaves the version alone (NUC-174).
 */
export async function updatePolicies(
  tx: Tx,
  input: PolicyValues,
  ctx: RequestContext,
): Promise<PolicySettings> {
  const current = policiesOf(await loadSettings(tx));
  const changed = EDITABLE_KEYS.some((key) => !isDeepStrictEqual(current.values[key], input[key]));
  if (!changed) return current;

  for (const key of EDITABLE_KEYS) await saveSetting(tx, key, input[key], ctx.actorUserId);
  const version = current.version + 1;
  await saveSetting(tx, 'policy.version', version, ctx.actorUserId);
  await audit(tx, ctx, {
    action: 'settings.policy_update',
    entityType: 'settings',
    entityId: 'policy',
    before: current,
    after: { version, values: input },
  });
  return { version, values: input };
}
