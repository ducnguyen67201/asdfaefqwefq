import assert from 'node:assert/strict';
import test from 'node:test';

import pg from 'pg';

import { runMigrations } from '../../src/migrate.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

test(
  'Knowledge Space migrations and lexical search work in PostgreSQL',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured.' },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    try {
      await runMigrations(pool);
      const tables = await pool.query(
        `SELECT to_regclass('public.knowledge_spaces') AS spaces,
                to_regclass('public.knowledge_source_chunks') AS chunks,
                to_regclass('public.knowledge_activity_attempts') AS attempts,
                to_regclass('public.knowledge_space_member_batches') AS member_batches,
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_name='users' AND column_name='classroom_role'
                ) AS has_classroom_role`,
      );
      assert.equal(tables.rows[0].spaces, 'knowledge_spaces');
      assert.equal(tables.rows[0].chunks, 'knowledge_source_chunks');
      assert.equal(tables.rows[0].attempts, 'knowledge_activity_attempts');
      assert.equal(tables.rows[0].member_batches, 'knowledge_space_member_batches');
      assert.equal(tables.rows[0].has_classroom_role, true);

      const search = await pool.query(
        `SELECT websearch_to_tsquery('simple', 'shopping cart loop') @@
                to_tsvector('simple', 'debug the shopping cart loop') AS matches`,
      );
      assert.equal(search.rows[0].matches, true);
    } finally {
      await pool.end();
    }
  },
);
