import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import { runMigrations } from '../../src/migrate.mjs';
import { PostgresUsageRepository } from '../../src/usage-repository.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

test(
  'six concurrent companion reservations commit at most five monthly slots',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured.' },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const userId = `companion-quota-${randomUUID()}`;
    try {
      await runMigrations(pool);
      await pool.query(
        'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
        [userId, `${randomUUID()}@example.test`, 'Companion Quota Test'],
      );
      const repository = new PostgresUsageRepository(pool);
      const reservations = Array.from({ length: 6 }, () => {
        const requestId = randomUUID();
        return repository.reserve({
          authorize: (committed) =>
            committed.monthImageGenerations >= 5
              ? {
                  alwaysEnforce: true,
                  code: 'companion_generation_limit_reached',
                  message: 'Monthly companion quota reached.',
                  status: 429,
                }
              : null,
          catalogVersion: '2026-04-21',
          enforce: false,
          lane: 'image_generation',
          maxProviderCallsPerTurn: 40,
          model: 'gpt-image-2-2026-04-21',
          planId: 'free',
          requestId,
          reservationTtlMs: 60_000,
          reservedMicroUsd: 0,
          taskId: requestId,
          userId,
        });
      });
      const results = await Promise.all(reservations);
      assert.equal(results.filter((result) => result.kind === 'reserved').length, 5);
      assert.equal(results.filter((result) => result.kind === 'denied').length, 1);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  },
);
