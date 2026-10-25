import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending drizzle migrations over a dedicated connection; a second run applies nothing. */
export async function runMigrations(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

// CLI: `npm run db:migrate -w apps/api`. The target comes from the shell only (no .env loading), so
// a migration never reaches the production branch by accident.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL_UNPOOLED or DATABASE_URL is required\n');
    process.exit(1);
  }
  await runMigrations(url);
  process.stdout.write('migrations applied\n');
}
