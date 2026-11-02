import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertCron } from '../src/lib/auth';

test('cron admission requires a configured matching credential', () => {
  const previous = process.env.CRON_SECRET;
  try {
    for (const configured of [undefined, '', '   ']) {
      if (configured === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = configured;
      assert.equal(assertCron(new NextRequest('https://example.test/api/cron/tick'))?.status, 401);
    }
    process.env.CRON_SECRET = 'test-cron-credential';
    for (const headers of [new Headers(), new Headers({ authorization: 'Bearer wrong' })]) {
      assert.equal(assertCron(new NextRequest('https://example.test/api/cron/tick', { headers }))?.status, 401);
    }
    assert.equal(assertCron(new NextRequest('https://example.test/api/cron/tick', {
      headers: { authorization: 'Bearer test-cron-credential' },
    })), null);
    // Preserve the existing query-token caller contract.
    assert.equal(assertCron(new NextRequest('https://example.test/api/cron/tick?secret=test-cron-credential')), null);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
