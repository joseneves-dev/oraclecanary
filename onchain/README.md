# oracle_guard

An Anchor program that lets other Solana programs refuse to act when a lending reserve's oracle is
unhealthy. OracleCanary signs a small health attestation off-chain. The transaction carries it in an
Ed25519 precompile instruction, and `oracle_guard::assert_oracle_healthy` checks it on-chain.

```
programs/oracle_guard/   the guard (Anchor 0.31.1)
programs/demo_vault/     DEMO ONLY: a mock vault that calls the guard via CPI before recording a deposit
tests-litesvm/           end-to-end tests of both programs on LiteSVM
ts/attestation.ts        builds, signs and wraps attestations for clients and, later, the API
```

Program IDs (the keypairs live in `target/deploy/` and are gitignored):

| Program | ID |
|---|---|
| oracle_guard | `444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT` |
| demo_vault | `HGjvgPmovhBCeXVUrtNkrdQn1LadW6dyKo52A6MnhMi4` |

Nothing is deployed yet, on any cluster.

## Attestation message

54 bytes, little-endian, signed with Ed25519 by the OracleCanary attestation key:

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 8 | domain tag | ASCII `OCANARY1`; the `1` versions the format |
| 8 | 32 | reserve | the reserve (Kamino reserve, marginfi bank, Jupiter Lend vault) the attestation is about |
| 40 | 1 | score | 0–100, as computed by the indexer |
| 41 | 1 | severity | worst open check: 0 ok, 1 info, 2 warning, 3 critical |
| 42 | 4 | price_age_seconds | u32; `0xFFFFFFFF` = unknown |
| 46 | 8 | issued_at | i64, unix seconds |

Test vector (reserve bytes `01..20`, score 85, warning, age 12s, issued at 1790000000):
`4f43414e41525931 0102…1f20 55 02 0c000000 803bb16a00000000`. Both the Rust and TypeScript tests
check it.

## How the check works

A transaction that wants the guard includes, in any order:

1. An Ed25519 precompile instruction over the message (`Ed25519Program.createInstructionWithPublicKey`).
   The runtime verifies every signature in it before any program runs. A bad signature fails the whole
   transaction.
2. `assert_oracle_healthy(reserve, max_severity, max_attestation_age_seconds)`, directly or through CPI
   from the caller's program. Its accounts are the config PDA (`["config"]`) and the Instructions
   sysvar.

`assert_oracle_healthy` scans every instruction through the Instructions sysvar. For each Ed25519
instruction, it only accepts signature entries whose signature, public key and message instruction
indexes are all `0xFFFF` ("this instruction"). It then reads the public key and message at exactly the
offsets the precompile verified. Entries that point into other instructions are ignored. That blocks
the known attack where the verified bytes and the parsed bytes differ.

Among entries signed by the configured authority that parse and name `reserve`, it takes the newest
`issued_at`. It then checks:

- `issued_at` is at most 60 s ahead of the cluster clock (`AttestationFromFuture`)
- `now - issued_at <= max_attestation_age_seconds` (`StaleAttestation`)
- `severity <= max_severity` (`Unhealthy`)

It returns the `Attestation` (Anchor return data), so callers can add their own rules on score or
price age.

Errors (Anchor custom codes):

| Code | Name | When |
|---|---|---|
| 6000 | MissingSignature | no usable Ed25519 signature in the transaction |
| 6001 | WrongSigner | signatures present, none from the configured authority |
| 6002 | InvalidAttestation | the authority signed only messages that are not valid attestations |
| 6003 | ReserveMismatch | the authority signed attestations, none for this reserve |
| 6004 | StaleAttestation | attestation older than `max_attestation_age_seconds` |
| 6005 | AttestationFromFuture | `issued_at` more than 60 s ahead of the cluster clock |
| 6006 | Unhealthy | severity worse than `max_severity` |
| 6007 | NotUpgradeAuthority | `initialize` not signed by the program's upgrade authority |
| 6008 | NotAdmin | `set_authority` not signed by the config admin |

### Authority

The accepted signing key is stored in a config PDA:

- `initialize(authority)` creates the PDA. It must be signed by the program's upgrade authority
  (checked through the ProgramData account), so nobody can front-run the deployer. The signer becomes
  `admin`.
- `set_authority(new_authority)` lets `admin` rotate the signing key without redeploying.

Keep the attestation key out of the admin/upgrade wallet. It will sit on the API server.

### Calling it from another program

`programs/demo_vault` shows the pattern: add `oracle_guard = { path = "...", features = ["cpi"] }`,
pass the config PDA, the Instructions sysvar and the oracle_guard program, then:

```rust
let attestation = oracle_guard::cpi::assert_oracle_healthy(
    CpiContext::new(guard_program, AssertOracleHealthy { config, instructions }),
    reserve_key, oracle_guard::SEVERITY_WARNING, 120,
)?.get();
```

## TypeScript helper

`ts/attestation.ts` provides `encodeAttestation`, `decodeAttestation`, `attestationFromHealth` (maps the
indexer's `HealthResult`, with severity = worst check), `signAttestation` (tweetnacl, 64-byte secret
key), `ed25519Instruction` and `assertOracleHealthyInstruction`. It is not wired into the indexer or the
API yet.

```ts
const signed = signAttestation(attestationFromHealth(reserve, health, Math.floor(Date.now() / 1000)), key.secretKey);
tx.add(ed25519Instruction(signed), assertOracleHealthyInstruction({ reserve, maxSeverity: 'warning', maxAttestationAgeSeconds: 120 }));
```

## Build and test

Anchor on native Windows is unreliable, so everything runs in Docker. From the repository root
(Git Bash; `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the paths):

```bash
# Build both programs and IDLs (Anchor 0.31.1, Solana 2.1.0 image)
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/onchain:/work" -v oc-cargo-registry:/root/.cargo/registry \
  -w /work solanafoundation/anchor:v0.31.1 anchor build

# Unit tests of the parsing and policy code
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/onchain:/work" -v oc-cargo-registry:/root/.cargo/registry \
  -w /work solanafoundation/anchor:v0.31.1 cargo test -p oracle_guard

# End-to-end tests on LiteSVM (needs Rust >= 1.89, hence a separate image; uses target/deploy/*.so)
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/onchain:/work" -v oc-cargo-registry-189:/usr/local/cargo/registry \
  -w /work/tests-litesvm rust:1.89-bookworm cargo test

# TypeScript helper (native Node works)
cd onchain && npm install && npm test
```

On a fresh clone, `anchor build` creates new program keypairs in `target/deploy/`. Run
`anchor keys sync` (same image) to update `declare_id!`, `Anchor.toml`, `ORACLE_GUARD_PROGRAM_ID` in
`ts/attestation.ts` and the IDs at the top of `tests-litesvm/tests/guard.rs`. To keep the IDs above
instead, restore the original keypair files.

`Cargo.lock` pins crates that still build with the image's SBF toolchain (Rust 1.79): `blake3` is held at
1.8.2 because newer versions pull a crate that needs edition 2024. After `cargo update`, reapply:
`cargo update -p blake3 --precise 1.8.2`.

## Deploy (not done yet)

Devnet first, with a funded wallet mounted into the container:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -it -v "$PWD/onchain:/work" -v oc-cargo-registry:/root/.cargo/registry \
  -v "$HOME/.config/solana:/root/.config/solana" -w /work solanafoundation/anchor:v0.31.1 \
  anchor deploy --provider.cluster devnet --program-name oracle_guard
```

Then, from the upgrade-authority wallet, call `initialize(<attestation public key>)` with accounts
`config = PDA(["config"])`, `admin = wallet`, `program = oracle_guard ID`,
`program_data = PDA([program ID], BPFLoaderUpgradab1e11111111111111111111111)`, `system_program`. Use
`target/idl/oracle_guard.json` with `@coral-xyz/anchor`. Do the same on mainnet only after a review.
`demo_vault` is a demo and should not go to mainnet.

## Limitations

- An attestation is a snapshot. Within `max_attestation_age_seconds`, a caller can pick any
  attestation OracleCanary signed for that reserve, including a healthy one issued just before the
  oracle broke. Short max ages limit this. It does not replace the lending protocol's own
  staleness checks.
- The guard trusts one off-chain signer. A compromised attestation key can mark any reserve healthy
  until the admin rotates it.
- The domain tag does not name the cluster. Reserve addresses differ between clusters, and the key
  should too.
- The admin cannot be changed, and `initialize` depends on the program staying upgradeable until it
  has run.
- The build shows one deprecation warning (`AccountInfo::realloc`) from Anchor 0.31.1's generated code
  with solana-program 2.3. It is harmless.
