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
      return status === 200 && json.status === 'ok' && json.db === 'ok' && json.branch === 'production';
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
    'home page',
    async () => {
      const { status, body } = await get('/');
      return status === 200 && body.includes('Bravô Clinic');
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
