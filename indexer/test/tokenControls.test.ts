import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PublicKey } from '@solana/web3.js';

import { decodeFrozen, decodeTokenControls } from '../src/tokenControls.js';

const AUTHORITY = new PublicKey('Q6XprfkF8RQQKoQVG33xT88H7wi8Uk1B1CC7YAs69Gi');
const DELEGATE = new PublicKey('BjUwr4kXyTUeohs3aT1xXRYshG3fF8axBF1PjAsoU1Fm');

/** An SPL Token mint, optionally with a freeze authority. */
function mint(freezeAuthority: PublicKey | null): Buffer {
  const data = Buffer.alloc(82);
  data.writeUInt8(6, 44); // decimals
  data.writeUInt8(1, 45); // initialized
  if (freezeAuthority) {
    data.writeUInt32LE(1, 46);
    freezeAuthority.toBuffer().copy(data, 50);
  }
  return data;
}

/** A Token-2022 mint: the base mint padded to 165 bytes, the mint account type, then extensions. */
function mint2022(freezeAuthority: PublicKey | null, extensions: { type: number; data: Buffer }[]): Buffer {
  const base = Buffer.alloc(166);
  mint(freezeAuthority).copy(base);
  base.writeUInt8(1, 165);
  const tlv = extensions.map(({ type, data }) => {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(data.length, 2);
    return Buffer.concat([header, data]);
  });
  return Buffer.concat([base, ...tlv]);
}

function tokenAccount(state: number): Buffer {
  const data = Buffer.alloc(165);
  data.writeUInt8(state, 108);
  return data;
}

describe('decodeTokenControls', () => {
  it('reads the freeze authority of an SPL Token mint', () => {
    assert.deepEqual(decodeTokenControls(mint(AUTHORITY)), { freezeAuthority: AUTHORITY.toBase58(), permanentDelegate: null });
  });

  it('reports no controls for a mint without a freeze authority', () => {
    assert.deepEqual(decodeTokenControls(mint(null)), { freezeAuthority: null, permanentDelegate: null });
  });

  it("reads a Token-2022 mint's permanent delegate after other extensions", () => {
    const data = mint2022(null, [
      { type: 3, data: Buffer.alloc(32) }, // mint close authority
      { type: 12, data: DELEGATE.toBuffer() },
    ]);
    assert.deepEqual(decodeTokenControls(data), { freezeAuthority: null, permanentDelegate: DELEGATE.toBase58() });
  });

  it('treats an all-zero permanent delegate as unset', () => {
    assert.equal(decodeTokenControls(mint2022(AUTHORITY, [{ type: 12, data: Buffer.alloc(32) }]))?.permanentDelegate, null);
  });

  it('rejects data too short to be a mint', () => {
    assert.equal(decodeTokenControls(Buffer.alloc(40)), null);
  });
});

describe('decodeFrozen', () => {
  it('reads the account state', () => {
    assert.equal(decodeFrozen(tokenAccount(2)), true);
    assert.equal(decodeFrozen(tokenAccount(1)), false);
  });

  it('rejects data too short to be a token account', () => {
    assert.equal(decodeFrozen(Buffer.alloc(82)), null);
  });
});
