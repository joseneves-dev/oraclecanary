<?php

namespace App\Attestation;

use App\ApiResource\Model\Severity;
use App\Solana\Base58;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Signs health attestations that the oracle_guard program verifies on-chain (see onchain/README.md).
 *
 * Message (54 bytes, little-endian): "OCANARY1" | reserve (32) | score u8 | severity u8 |
 * price_age_seconds u32 (0xFFFFFFFF = unknown) | issued_at i64 unix seconds.
 */
final class AttestationSigner
{
    public const DOMAIN_TAG = 'OCANARY1';
    public const PRICE_AGE_UNKNOWN = 0xFFFFFFFF;

    private ?string $secretKey = null;

    public function __construct(
        /** Base64 of the 32-byte Ed25519 seed; empty disables signing. */
        #[Autowire(env: 'ATTESTATION_SECRET_KEY')]
        private readonly string $seed,
    ) {
    }

    public function isConfigured(): bool
    {
        return '' !== $this->seed;
    }

    /** The signer's public key, Base58, as oracle_guard's config must hold it. */
    public function publicKey(): string
    {
        return Base58::encode(sodium_crypto_sign_publickey_from_secretkey($this->secretKey()));
    }

    public static function encode(string $reserve, int $score, Severity $severity, ?int $priceAgeSeconds, int $issuedAt): string
    {
        if ($score < 0 || $score > 100) {
            throw new \RangeError(\sprintf('Score out of range: %d', $score));
        }
        $priceAge = null === $priceAgeSeconds ? self::PRICE_AGE_UNKNOWN : min(max(0, $priceAgeSeconds), self::PRICE_AGE_UNKNOWN - 1);

        return self::DOMAIN_TAG.Base58::decodePublicKey($reserve).pack('CCVP', $score, $severity->rank(), $priceAge, $issuedAt);
    }

    /** Detached Ed25519 signature of a message. */
    public function sign(string $message): string
    {
        return sodium_crypto_sign_detached($message, $this->secretKey());
    }

    private function secretKey(): string
    {
        if (null === $this->secretKey) {
            $seed = base64_decode($this->seed, true);
            if (false === $seed || SODIUM_CRYPTO_SIGN_SEEDBYTES !== \strlen($seed)) {
                throw new \LogicException('ATTESTATION_SECRET_KEY must be the base64 of a 32-byte Ed25519 seed.');
            }
            $this->secretKey = sodium_crypto_sign_secretkey(sodium_crypto_sign_seed_keypair($seed));
        }

        return $this->secretKey;
    }
}
