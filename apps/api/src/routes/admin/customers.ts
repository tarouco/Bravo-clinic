import { customerCreateSchema, customerSearchQuerySchema } from '@bravo/core';
import { Hono } from 'hono';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import { createCustomer, searchCustomers } from '../../modules/admin/customers.service';
import type { AppEnv } from '../../types';

/** Customers at the counter (NUC-169): search and create; reception may use both. */
export function adminCustomerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/customers/search', validate('query', customerSearchQuerySchema), async (c) =>
    c.json(await searchCustomers(c.var.deps.db, c.req.valid('query').q)),
  );

  app.post('/customers', validate('json', customerCreateSchema), async (c) =>
    c.json(await createCustomer(c.var.deps, actorContext(c), c.req.valid('json')), 201),
  );

  return app;
}
