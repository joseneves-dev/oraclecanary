<?php

namespace App\Mcp\Output;

use App\ApiResource\Model\Severity;
use App\ApiResource\ReserveAttestation;
use App\Mcp\Notice;

/**
 * Result of the attestation tool: GET /api/reserves/{address}/attestation.
 */
final readonly class Attestation
{
    public function __construct(
        public string $address,
        /** 0 (broken) to 100 (healthy). */
        public int $score,
        /** Signed as 0 ok, 1 info, 2 warning, 3 critical. */
        public Severity $severity,
        /** Age of the oldest price at issuedAt; null if it could not be read. */
        public ?int $priceAgeSeconds,
        /** When the health was measured (UTC), not when it was signed. */
        public \DateTimeImmutable $issuedAt,
        /** The 54-byte attestation message, base64. */
        public string $message,
        /** Ed25519 signature of `message`, base64. */
        public string $signature,
        /** Signing key, Base58: must match the authority in oracle_guard's config. */
        public string $publicKey,
        public string $link,
    ) {
    }

    public static function fromAttestation(ReserveAttestation $attestation): self
    {
        return new self(
            $attestation->address,
            $attestation->score,
            $attestation->severity,
            $attestation->priceAgeSeconds,
            $attestation->issuedAt,
            $attestation->message,
            $attestation->signature,
            $attestation->publicKey,
            Notice::reserveLink($attestation->address),
        );
    }
}
