import { afterAll, describe, expect, it } from 'vitest';
import { forbiddenFetch, testEnv } from '../../test/http';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import { integrationSettings } from '../db/schema';
import { getEnv } from '../env';
import { AppError } from '../lib/errors';
import { encryptSecret } from '../lib/crypto';
import { saveSetting } from '../modules/settings/settings.repo';
import {
  activeProvider,
  loadGatewayConfig,
  resolveGateway,
  resolveGatewayForCharge,
} from './resolver';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const deps = () => ({ db, env: testEnv(), fetch: forbiddenFetch });

const setActive = (provider: 'sandbox' | 'mercadopago') =>
  withTransaction(db, (tx) => saveSetting(tx, 'payment.active_gateway', provider, null));

async function expectNotConfigured(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status: 503, code: 'GATEWAY_NOT_CONFIGURED' });
}

describe('resolveGateway (NUC-106, NUC-125)', () => {
  it('uses the sandbox for new charges while payment.active_gateway has its factory default', async () => {
    expect(await activeProvider(db)).toBe('sandbox');

    const gateway = await resolveGatewayForCharge(deps());

    expect(gateway.id).toBe('sandbox');
  });

  it('picks the active gateway for new charges and the stored provider for an old charge', async () => {
    await setActive('mercadopago');

    // The old sandbox charge keeps its gateway after the switch ...
    const old = await resolveGatewayForCharge(deps(), { provider: 'sandbox' });
    expect(old.id).toBe('sandbox');
    // ... while a new charge follows the setting, which has no credentials yet.
    await expectNotConfigured(resolveGatewayForCharge(deps()));
  });

  it('throws GATEWAY_NOT_CONFIGURED for mercadopago without credentials', async () => {
    await expectNotConfigured(resolveGateway('mercadopago', deps()));
  });

  it('throws GATEWAY_NOT_CONFIGURED for mercadopago whose row has no access token', async () => {
    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      enabled: true,
      environment: 'test',
      config: { publicKey: 'APP_USR-public' },
    });

    await expectNotConfigured(resolveGateway('mercadopago', deps()));
  });

  it('throws GATEWAY_NOT_CONFIGURED for a charge whose provider is not a gateway', async () => {
    await expectNotConfigured(resolveGatewayForCharge(deps(), { provider: 'internal' }));
  });
});

describe('loadGatewayConfig (NUC-208)', () => {
  it('merges the plain config with the decrypted secret fields', async () => {
    const key = getEnv().ENCRYPTION_KEY;
    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      enabled: true,
      environment: 'production',
      config: { publicKey: 'APP_USR-public' },
      secretCiphertext: encryptSecret(
        JSON.stringify({ accessToken: 'APP_USR-secret', webhookSecret: 'whsec' }),
        key,
      ),
    });

    expect(await loadGatewayConfig(db, 'mercadopago', { ENCRYPTION_KEY: key })).toEqual({
      enabled: true,
      environment: 'production',
      credentials: {
        publicKey: 'APP_USR-public',
        accessToken: 'APP_USR-secret',
        webhookSecret: 'whsec',
      },
    });
  });

  it('returns null when there is no row, and when the secret cannot be decrypted', async () => {
    const key = getEnv().ENCRYPTION_KEY;
    expect(await loadGatewayConfig(db, 'mercadopago', { ENCRYPTION_KEY: key })).toBeNull();

    await db.insert(integrationSettings).values({
      key: 'gateway.mercadopago',
      secretCiphertext: encryptSecret(
        '{"accessToken":"x"}',
        Buffer.alloc(32, 9).toString('base64'),
      ),
    });
    expect(await loadGatewayConfig(db, 'mercadopago', { ENCRYPTION_KEY: key })).toBeNull();
  });
});
