import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/operator/db/schema.ts',
  out: './src/operator/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './.neoxten-operator/operator.sqlite' },
});
