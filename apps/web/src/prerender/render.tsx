import type { RoomDetail, RoomList } from '@bravo/core';
import { dehydrate, type DehydratedState } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import type { RouteObject } from 'react-router-dom';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from 'react-router-dom/server';
import { AppProviders } from '../AppProviders';
import { registerGestaoSlots } from '../extensions/gestao';
import { registerRevenueSlots } from '../extensions/receita';
import { catalogKeys } from '../features/catalog/api';
import { createQueryClient } from '../lib/query-client';
import { appRoutes } from '../router';

// Build-time prerender entry (GES-143), bundled by scripts/prerender.mjs with `vite build --ssr`.
// It renders a public page with the same providers and routes as src/main.tsx, seeded with the
// catalog data fetched at build time, and returns the markup plus the query state to hydrate.

registerRevenueSlots();
registerGestaoSlots();

export interface PrerenderData {
  rooms?: RoomList;
  room?: RoomDetail;
}

export interface PrerenderResult {
  html: string;
  state: DehydratedState;
}

export async function render(path: string, data: PrerenderData = {}): Promise<PrerenderResult> {
  const client = createQueryClient();
  if (data.rooms) client.setQueryData(catalogKeys.rooms, data.rooms);
  if (data.room) client.setQueryData(catalogKeys.room(data.room.slug), data.room);

  const handler = createStaticHandler(appRoutes);
  const context = await handler.query(new Request(`https://prerender.invalid${path}`));
  if (context instanceof Response) throw new Error(`prerender: ${path} answered a redirect`);
  // dataRoutes are appRoutes with ids; the cast only bridges exactOptionalPropertyTypes.
  const router = createStaticRouter(handler.dataRoutes as RouteObject[], context);

  // `hydrate={false}`: no inline router-state script (the CSP allows only hashed ones); the
  // routes have no loaders, so the browser router starts from the same state anyway.
  const html = renderToString(
    <AppProviders client={client}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </AppProviders>,
  );
  return { html, state: dehydrate(client) };
}
