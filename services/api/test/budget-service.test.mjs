import assert from 'node:assert/strict';
import test from 'node:test';

import { BudgetService } from '../src/budget-service.mjs';

class MemoryUsageRepository {
  reservations = new Map();

  committed = {
    dayMicroUsd: 0,
    monthImageGenerations: 0,
    monthMicroUsd: 0,
    taskMicroUsd: 0,
  };

  async reserve(input) {
    const key = `${input.userId}:${input.requestId}`;
    if (this.reservations.has(key)) {
      return { kind: 'duplicate', reservation: this.reservations.get(key) };
    }
    const denial = input.authorize(this.committed);
    if (denial && (input.enforce || denial.alwaysEnforce)) {
      return { denial, kind: 'denied' };
    }
    const reservation = {
      actualMicroUsd: null,
      lane: input.lane,
      requestId: input.requestId,
      reservedMicroUsd: input.reservedMicroUsd,
      status: 'reserved',
    };
    this.reservations.set(key, reservation);
    this.committed = {
      dayMicroUsd: this.committed.dayMicroUsd + input.reservedMicroUsd,
      monthImageGenerations:
        this.committed.monthImageGenerations +
        (input.lane === 'image_generation' ? 1 : 0),
      monthMicroUsd: this.committed.monthMicroUsd + input.reservedMicroUsd,
      taskMicroUsd: this.committed.taskMicroUsd + input.reservedMicroUsd,
    };
    return { denial, kind: 'reserved', reservation };
  }

  async markDispatched() {}
  async settle(input) {
    return { actualMicroUsd: input.actualMicroUsd, status: 'settled' };
  }
  async release(userId, requestId) {
    const reservation = this.reservations.get(`${userId}:${requestId}`);
    if (reservation?.status === 'reserved') {
      reservation.status = 'released';
      if (reservation.lane === 'image_generation') {
        this.committed.monthImageGenerations -= 1;
      }
    }
    return reservation;
  }
  async markUncertain() {}
  async snapshot() {
    return {
      dayEndsAt: '2026-08-18T00:00:00.000Z',
      dayReservedMicroUsd: this.committed.dayMicroUsd,
      daySettledMicroUsd: 0,
      monthEndsAt: '2026-09-01T00:00:00.000Z',
      monthImageGenerations: this.committed.monthImageGenerations,
      monthReservedMicroUsd: this.committed.monthMicroUsd,
      monthSettledMicroUsd: 0,
      taskReservedMicroUsd: this.committed.taskMicroUsd,
      taskSettledMicroUsd: 0,
      weekEndsAt: '2026-08-24T00:00:00.000Z',
      weekMessages: 0,
    };
  }
}

function service(repository, mode = 'enforce') {
  return new BudgetService(repository, {
    dailyMicroUsd: 100,
    enabled: true,
    mode,
    monthlyMicroUsd: 100,
    realtimeCallMicroUsd: 5,
    reservationTtlMs: 60_000,
    speechMicroUsdPerThousandCharacters: 60_000,
    transcriptionMicroUsdPerMinute: 6_000,
    taskMicroUsd: 100,
    warningPercent: 80,
  });
}

test('concurrent reservations cannot cross an enforced cap', async () => {
  const budget = service(new MemoryUsageRepository());
  const request = (requestId) =>
    budget.reserve({
      catalogVersion: 'v1',
      agentTurnId: '22222222-2222-4222-8222-222222222222',
      lane: 'responses',
      model: 'test',
      requestId,
      reservedMicroUsd: 60,
      taskId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      planId: 'basic',
    });
  const results = await Promise.allSettled([
    request('11111111-1111-4111-8111-111111111112'),
    request('11111111-1111-4111-8111-111111111113'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ['fulfilled', 'rejected'],
  );
});

test('observe mode records would-deny reservations and snapshots remain sanitized', async () => {
  const budget = service(new MemoryUsageRepository(), 'observe');
  await budget.reserve({
    catalogVersion: 'v1',
    agentTurnId: '22222222-2222-4222-8222-222222222222',
    lane: 'responses',
    model: 'test',
    requestId: '11111111-1111-4111-8111-111111111112',
    reservedMicroUsd: 120,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    planId: 'basic',
  });
  const snapshot = await budget.snapshot('user-1', null, 'basic');
  assert.equal(snapshot.enforcementMode, 'observe');
  assert.equal(snapshot.monthly.remainingMicroUsd, 0);
  assert.deepEqual(snapshot.messages, {
    limit: 300,
    periodEndsAt: '2026-08-24T00:00:00.000Z',
    periodStartsAt: '2026-08-17T00:00:00.000Z',
    remaining: 300,
    used: 0,
  });
  assert.equal(snapshot.plan, 'basic');
  assert.deepEqual(snapshot.pricing, { currency: 'usd', monthlyCents: 2_000 });
  assert.equal('prompt' in snapshot, false);
  assert.equal(budget.speechEstimateMicroUsd(240), 14_400);
});

test('multiple provider calls do not increment the user-turn message count', async () => {
  const repository = new MemoryUsageRepository();
  const budget = service(repository);
  const request = (requestId) =>
    budget.reserve({
      catalogVersion: 'v1',
      agentTurnId: '22222222-2222-4222-8222-222222222222',
      lane: 'responses',
      model: 'test',
      planId: 'basic',
      requestId,
      reservedMicroUsd: 0,
      taskId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
    });

  await request('11111111-1111-4111-8111-111111111112');
  await request('11111111-1111-4111-8111-111111111113');
  assert.equal((await budget.snapshot('user-1')).messages.used, 0);
});

test('Free snapshots expose the account plan and zero-dollar price', async () => {
  const budget = service(new MemoryUsageRepository());
  const snapshot = await budget.snapshot('user-1', null, 'free');

  assert.equal(snapshot.plan, 'free');
  assert.deepEqual(snapshot.pricing, { currency: 'usd', monthlyCents: 0 });
  assert.deepEqual(snapshot.messages, {
    limit: 25,
    periodEndsAt: '2026-08-24T00:00:00.000Z',
    periodStartsAt: '2026-08-17T00:00:00.000Z',
    remaining: 25,
    used: 0,
  });
});

test('voice usage shares the cost cap without consuming an agent message', async () => {
  const repository = new MemoryUsageRepository();
  const budget = service(repository);
  await budget.reserve({
    catalogVersion: 'v1',
    lane: 'speech',
    model: 'test-voice',
    planId: 'basic',
    requestId: '11111111-1111-4111-8111-111111111112',
    reservedMicroUsd: 1,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });

  assert.equal(repository.committed.monthMicroUsd, 1);
  assert.equal((await budget.snapshot('user-1')).messages.used, 0);
});

test('transcription pricing uses integer micro-USD ceiling math', () => {
  const budget = service(new MemoryUsageRepository());
  assert.equal(budget.transcriptionEstimateMicroUsd(300), 30);
  assert.equal(budget.transcriptionEstimateMicroUsd(12_000), 1_200);
  assert.equal(budget.transcriptionEstimateMicroUsd(15_000), 1_500);
  assert.equal(budget.transcriptionActualMicroUsd(0.301), 31);
  assert.equal(budget.transcriptionActualMicroUsd(12), 1_200);
  assert.throws(() => budget.transcriptionEstimateMicroUsd(15_001), /limit/u);
  assert.throws(() => budget.transcriptionActualMicroUsd(Number.NaN), /bounded/u);
});

test('companion generation quota accepts five, rejects six, and releases known failures', async () => {
  const repository = new MemoryUsageRepository();
  const budget = service(repository);
  const request = (index) =>
    budget.reserve({
      catalogVersion: '2026-04-21',
      lane: 'image_generation',
      model: 'gpt-image-2-2026-04-21',
      planId: 'free',
      requestId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      reservedMicroUsd: 0,
      taskId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      userId: 'student-1',
    });

  for (let index = 1; index <= 5; index += 1) await request(index);
  await assert.rejects(request(6), {
    code: 'companion_generation_limit_reached',
    status: 429,
  });
  assert.deepEqual(
    await budget.companionGenerationSnapshot('student-1', 'free'),
    {
      limit: 5,
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      remaining: 0,
      used: 5,
    },
  );

  await budget.release(
    'student-1',
    '11111111-1111-4111-8111-000000000005',
    'rejected_before_inference',
  );
  await request(6);
});

test('companion entitlement remains enforced while money guard observes', async () => {
  const repository = new MemoryUsageRepository();
  repository.committed.monthImageGenerations = 5;
  const budget = service(repository, 'observe');
  await assert.rejects(
    budget.reserve({
      catalogVersion: '2026-04-21',
      lane: 'image_generation',
      model: 'gpt-image-2-2026-04-21',
      planId: 'basic',
      requestId: '11111111-1111-4111-8111-000000000006',
      reservedMicroUsd: 0,
      taskId: '11111111-1111-4111-8111-000000000006',
      userId: 'student-1',
    }),
    { code: 'companion_generation_limit_reached', status: 429 },
  );
});
