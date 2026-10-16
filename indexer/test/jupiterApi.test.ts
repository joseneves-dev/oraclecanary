import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { fetchTokens, resetKnownTokens } from '../src/adapters/jupiterLend.js';
import { jupiterFetch } from '../src/jupiterApi.js';

/** A fetch recording what it was asked, answering with `answer` for each call in turn. */
function fakeFetch(...answers: (unknown | number)[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return typeof answer === 'number' ? new Response('{"error":"Too many requests"}', { status: answer }) : Response.json(answer);
  }) as typeof fetch;
  return { impl, calls };
}

describe('jupiterFetch', () => {
  it('calls the keyless lite API when no key is set', async () => {
    const { impl, calls } = fakeFetch({});
    await jupiterFetch('/price/v3?ids=a', 1000, impl, '');
    assert.equal(calls[0].url, 'https://lite-api.jup.ag/price/v3?ids=a');
    assert.equal(calls[0].headers['x-api-key'], undefined);
  });

  it('calls api.jup.ag with the key once one is set', async () => {
    const { impl, calls } = fakeFetch({});
    await jupiterFetch('/price/v3?ids=a', 1000, impl, 'secret');
    assert.equal(calls[0].url, 'https://api.jup.ag/price/v3?ids=a');
    assert.equal(calls[0].headers['x-api-key'], 'secret');
  });
});

describe('Jupiter Lend tokens', () => {
  beforeEach(() => resetKnownTokens());
  const sol = { id: 'sol', symbol: 'SOL', decimals: 9, usdPrice: 150 };

  it('keeps the last answer when Jupiter rate-limits the server (16 Oct 2026)', async () => {
    const { impl } = fakeFetch([sol], 429);
    await fetchTokens(['sol'], impl);
    assert.deepEqual(await fetchTokens(['sol'], impl), new Map([['sol', { symbol: 'SOL', decimals: 9, usdPrice: 150 }]]));
  });

  it('leaves out tokens Jupiter never described, without throwing', async () => {
    const { impl } = fakeFetch(429);
    assert.deepEqual(await fetchTokens(['sol'], impl), new Map());
  });

  it('returns only the mints asked for', async () => {
    const { impl } = fakeFetch([sol, { id: 'usdc', symbol: 'USDC', decimals: 6 }]);
    await fetchTokens(['sol', 'usdc'], impl);
    assert.deepEqual([...(await fetchTokens(['usdc'], fakeFetch(429).impl)).keys()], ['usdc']);
  });
});
