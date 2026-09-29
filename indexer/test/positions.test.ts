import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { vaultSharePositions } from '../src/positions.js';

describe('vaultSharePositions', () => {
  const vaults = new Map([
    ['shares-steakhouse', { address: 'vault-steakhouse', state: { sharesIssued: '4000000' } }],
    ['shares-empty', { address: 'vault-empty', state: { sharesIssued: '0' } }],
  ]);

  it("turns a wallet's vault share tokens into its share of each vault", () => {
    const positions = vaultSharePositions(
      [
        { mint: 'shares-steakhouse', amount: '1000000' },
        { mint: 'some-other-token', amount: '5' },
      ],
      vaults,
    );
    assert.deepEqual(positions, [{ protocol: 'kamino-vault', side: 'deposit', vault: 'vault-steakhouse', share: 0.25 }]);
  });

  it('skips empty token accounts and vaults with no shares issued', () => {
    assert.deepEqual(
      vaultSharePositions(
        [
          { mint: 'shares-steakhouse', amount: '0' },
          { mint: 'shares-empty', amount: '10' },
        ],
        vaults,
      ),
      [],
    );
  });
});
