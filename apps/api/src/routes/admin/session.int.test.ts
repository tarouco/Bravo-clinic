import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const app = () => createApp({ db, env: testEnv(), fetch: forbiddenFetch });

describe('GET /admin/session (FND-74)', () => {
  it('lists the ten sections of an MFA-verified admin in sidebar order', async () => {
    const admin = await createUser(db, { role: 'admin', totp: true });

    const result = await send(app(), 'GET', '/admin/session', {
      cookie: await loginAs(db, admin, { mfaVerified: true }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      role: 'admin',
      sections: [
        'calendario',
        'reservas',
        'financeiro',
        'integracoes',
        'cupons',
        'servicos-extras',
        'clientes',
        'salas',
        'usuarios',
        'auditoria',
      ],
    });
  });

  it('lists only reservas and clientes for an MFA-verified reception user', async () => {
    const reception = await createUser(db, { role: 'reception', totp: true });

    const result = await send(app(), 'GET', '/admin/session', {
      cookie: await loginAs(db, reception, { mfaVerified: true }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ role: 'reception', sections: ['reservas', 'clientes'] });
  });
});
