import {
  idSchema,
  roomInputSchema,
  roomPhotoInputSchema,
  roomPhotoOrderSchema,
  roomPhotoUpdateSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { actorContext } from '../../lib/request-meta';
import { readBinaryBody } from '../../lib/storage';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createRoom,
  deletePhoto,
  listAdminRooms,
  registerPhoto,
  reorderPhotos,
  updatePhoto,
  updateRoom,
  uploadPhotoVariant,
} from '../../modules/rooms/rooms-admin.service';
import type { AppEnv } from '../../types';

const roomParam = z.object({ id: idSchema });
const photoParam = z.object({ id: idSchema, photoId: idSchema });
const uploadParam = z.object({
  id: idSchema,
  uploadId: z.uuid({ error: 'Envio inválido' }),
  variant: z.enum(['large', 'small'], { error: 'Versão inválida' }),
});

/**
 * Salas admin (GES-103..GES-107), admin only. Guarded per route: `/rooms/:roomId/availability`
 * (nucleo) stays open to reception.
 */
export function adminRoomRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole('admin');

  app.get('/rooms', admin, async (c) => c.json(await listAdminRooms(c.var.deps.db)));

  app.post('/rooms', admin, validate('json', roomInputSchema), async (c) => {
    const ctx = actorContext(c);
    const room = await withTransaction(c.var.deps.db, (tx) =>
      createRoom(tx, ctx, c.req.valid('json')),
    );
    return c.json(room, 201);
  });

  app.patch(
    '/rooms/:id',
    admin,
    validate('param', roomParam),
    validate('json', roomInputSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      const room = await withTransaction(db, (tx) =>
        updateRoom(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
      );
      return c.json(room);
    },
  );

  app.put(
    '/rooms/:id/photo-uploads/:uploadId/:variant',
    admin,
    validate('param', uploadParam),
    async (c) => {
      const { id, uploadId, variant } = c.req.valid('param');
      const file = await readBinaryBody(c, { allowed: ['image/webp'] });
      await uploadPhotoVariant(c.var.deps, { roomId: id, uploadId, variant, bytes: file.bytes });
      return c.body(null, 204);
    },
  );

  app.post(
    '/rooms/:id/photos',
    admin,
    validate('param', roomParam),
    validate('json', roomPhotoInputSchema),
    async (c) => {
      const photo = await registerPhoto(
        c.var.deps,
        actorContext(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.json(photo, 201);
    },
  );

  // Registered before `/photos/:photoId` so "order" is never read as a photo id.
  app.put(
    '/rooms/:id/photos/order',
    admin,
    validate('param', roomParam),
    validate('json', roomPhotoOrderSchema),
    async (c) => {
      const ctx = actorContext(c);
      await withTransaction(c.var.deps.db, (tx) =>
        reorderPhotos(tx, ctx, c.req.valid('param').id, c.req.valid('json').ids),
      );
      return c.body(null, 204);
    },
  );

  app.patch(
    '/rooms/:id/photos/:photoId',
    admin,
    validate('param', photoParam),
    validate('json', roomPhotoUpdateSchema),
    async (c) => {
      const { id, photoId } = c.req.valid('param');
      const ctx = actorContext(c);
      const photo = await withTransaction(c.var.deps.db, (tx) =>
        updatePhoto(tx, ctx, id, photoId, c.req.valid('json')),
      );
      return c.json(photo);
    },
  );

  app.delete('/rooms/:id/photos/:photoId', admin, validate('param', photoParam), async (c) => {
    const { id, photoId } = c.req.valid('param');
    await deletePhoto(c.var.deps, actorContext(c), id, photoId);
    return c.body(null, 204);
  });

  return app;
}
