import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { createQueryClient, SESSION_KEY } from './query-client';

const session = { id: 'u1', role: 'tenant', mfa: { enrolled: true, verified: true } };

/** Runs a mutation that fails with `error` and returns the cached session afterwards. */
async function sessionAfterFailure(error: ApiError): Promise<unknown> {
  const client = createQueryClient();
  client.setQueryData(SESSION_KEY, session);
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(error) })
    .execute(undefined)
    .catch(() => undefined);
  return client.getQueryData(SESSION_KEY);
}

describe('createQueryClient: session reset on 401', () => {
  it('drops the cached session when a request answers 401 UNAUTHENTICATED', async () => {
    const error = new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });

    expect(await sessionAfterFailure(error)).toBeNull();
  });

  it('keeps the session on 401 INVALID_CODE: a wrong two-factor code does not sign out (AD-037)', async () => {
    const error = new ApiError({ status: 401, code: 'INVALID_CODE', message: 'Código inválido' });

    expect(await sessionAfterFailure(error)).toEqual(session);
  });
});
