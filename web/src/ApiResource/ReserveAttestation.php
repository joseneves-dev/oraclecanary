<?php

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\OpenApi\Model\Operation;
use ApiPlatform\OpenApi\Model\Response;
use App\ApiResource\Model\Severity;
use App\State\ReserveAttestationProvider;

/**
 * A signed statement of a reserve's latest health, for the oracle_guard program: a transaction
 * carries it in an Ed25519 instruction and oracle_guard refuses to go on if it is unhealthy.
 */
#[ApiResource(
    shortName: 'ReserveAttestation',
    operations: [
        new Get(
            uriTemplate: '/reserves/{address}/attestation',
            description: 'The reserve\'s latest health, signed for the oracle_guard program.',
            provider: ReserveAttestationProvider::class,
            openapi: new Operation(
                summary: 'Signed health attestation of a reserve',
                description: 'Put `message`, `signature` and `publicKey` in an Ed25519 program instruction '.
                    '(e.g. Ed25519Program.createInstructionWithPublicKey) next to a call to oracle_guard. '.
                    '`issuedAt` is when the health was measured, not when it was signed, so a stopped indexer '.
                    'cannot produce fresh-looking attestations.',
                responses: [
                    '200' => new Response(description: 'Signed attestation'),
                    '404' => new Response(description: 'No reserve with this address'),
                    '503' => new Response(description: 'Signing is not configured on this server'),
                ],
            ),
        ),
    ],
    // Signatures are deterministic, so the response only changes when the indexer does.
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 30],
    normalizationContext: ['skip_null_values' => false],
)]
final class ReserveAttestation
{
    public function __construct(
        /** Reserve / bank / vault address. */
        #[ApiProperty(identifier: true)]
        public string $address,
        /** 0 (broken) to 100 (healthy). */
        public int $score,
        /** Worst severity among the failed checks, or "ok"; signed as 0 ok, 1 info, 2 warning, 3 critical. */
        public Severity $severity,
        /** Age of the oldest price at `issuedAt`; null if it could not be read (signed as 0xFFFFFFFF). */
        public ?int $priceAgeSeconds,
        /** When the health was measured. */
        public \DateTimeImmutable $issuedAt,
        /** The 54-byte attestation message, base64. */
        public string $message,
        /** Ed25519 signature of `message`, base64. */
        public string $signature,
        /** Signing key, Base58: must match the authority in oracle_guard's config. */
        public string $publicKey,
    ) {
    }
}
