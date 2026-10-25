import { defineConfig } from 'drizzle-kit';

// `generate` reads the schema only; migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
