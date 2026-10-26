import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@bravo/core';
import { routes } from './handlers';

const ORIGIN = 'http://localhost:3000';

describe('MSW default handlers', () => {
  it.each(routes.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route] as const))(
    '%s answers with a body that its core schema accepts',
    async (_name, route) => {
      const response = await fetch(`${ORIGIN}${route.sample}`, {
        method: route.method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
        ...(route.method === 'get' || route.method === 'delete' ? {} : { body: '{}' }),
      });

      expect(response.status).toBe(route.status ?? 200);
      if (route.schema) {
        const result = route.schema.safeParse(await response.json());
        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
      }
    },
  );

  it('answers an unknown room slug with the 404 error envelope', async () => {
    const response = await fetch(`${ORIGIN}/api/public/rooms/inexistente`);

    expect(response.status).toBe(404);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('answers an unknown pre-reservation token with 404', async () => {
    const response = await fetch(`${ORIGIN}/api/public/pre-reservations/outro-token`);

    expect(response.status).toBe(404);
  });
});
