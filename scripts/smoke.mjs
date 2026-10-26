#!/usr/bin/env node
// Production smoke check: `node scripts/smoke.mjs https://bravo-clinic.netlify.app`
// Exits 0 only when the API health (through the Netlify proxy), the public config and the Home all answer.

const base = (process.argv[2] ?? 'https://bravo-clinic.netlify.app').replace(/\/+$/, '');
const TIMEOUT_MS = 60_000; // first request after scale-to-zero pays the Neon cold start

async function get(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.text() };
}

const checks = [
  [
    'api health via proxy',
    async () => {
      const { status, body } = await get('/api/health');
      const json = JSON.parse(body);
      return (
        status === 200 && json.status === 'ok' && json.db === 'ok' && json.branch === 'production'
      );
    },
  ],
  [
    'public config',
    async () => {
      const { status, body } = await get('/api/public/config');
      return status === 200 && JSON.parse(body).environment === 'production';
    },
  ],
  [
    'public rooms',
    async () => {
      const { status, body } = await get('/api/public/rooms');
      return status === 200 && JSON.parse(body).items.some((room) => room.slug === 'principal');
    },
  ],
  [
    'principal availability',
    async () => {
      // Tomorrow on the clinic's calendar (America/Sao_Paulo), so the day is never in the past.
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      );
      const { status, body } = await get(`/api/public/rooms/principal/availability?date=${date}`);
      const json = JSON.parse(body);
      return status === 200 && json.date === date && Array.isArray(json.cells);
    },
  ],
  [
    'home page',
    async () => {
      // SPEC_DEVIATION: FND-129 asks for the Home to carry "the hero headline", but the hero renders
      // client-side (React SPA), so it is absent from the served HTML and cannot be asserted here.
      // The static, server-delivered proof of the Home is its <title> and the LocalBusiness JSON-LD.
      const { status, body } = await get('/');
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1] ?? '';
      const jsonLd = [
        ...body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
      ]
        .map((m) => {
          try {
            return JSON.parse(m[1]);
          } catch {
            return null;
          }
        })
        .some((data) => data?.['@type'] === 'LocalBusiness');
      return status === 200 && title.includes('Bravô Clinic – Salas Inteligentes') && jsonLd;
    },
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  let ok = false;
  try {
    ok = await run();
  } catch {
    ok = false;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}
process.exit(failed === 0 ? 0 : 1);
