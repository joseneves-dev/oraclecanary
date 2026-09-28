<?php

namespace App\Tests\Attestation;

use App\ApiResource\Model\Severity;
use App\Attestation\AttestationSigner;
use App\Solana\Base58;
use PHPUnit\Framework\TestCase;

final class AttestationSignerTest extends TestCase
{
    public function testEncodesTheVectorSharedWithTheProgramAndTheTypeScriptHelper(): void
    {
        $reserve = Base58::encode(implode('', array_map('chr', range(1, 32))));

        $message = AttestationSigner::encode($reserve, 85, Severity::Warning, 12, 1_790_000_000);

        self::assertSame(
            '4f43414e41525931'.'0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'.'55'.'02'.'0c000000'.'803bb16a00000000',
            bin2hex($message),
        );
    }

    public function testMarksAnUnknownPriceAge(): void
    {
        $message = AttestationSigner::encode('11111111111111111111111111111111', 0, Severity::Critical, null, 0);

        self::assertSame('ffffffff', bin2hex(substr($message, 42, 4)));
        self::assertSame(3, \ord($message[41]));
    }

    public function testSignaturesVerifyWithThePublishedKey(): void
    {
        $signer = new AttestationSigner(base64_encode(str_repeat("\1", 32)));
        $message = AttestationSigner::encode('11111111111111111111111111111111', 100, Severity::Ok, 5, 1_790_000_000);

        $signature = $signer->sign($message);

        self::assertTrue(sodium_crypto_sign_verify_detached($signature, $message, Base58::decodePublicKey($signer->publicKey())));
    }

    public function testRejectsAKeyThatIsNotASeed(): void
    {
        $this->expectException(\LogicException::class);

        (new AttestationSigner(base64_encode('too short')))->publicKey();
    }

    public function testBase58RoundTripsKeysWithLeadingZeros(): void
    {
        $key = "\0\0".random_bytes(30);

        self::assertSame('11111111111111111111111111111111', Base58::encode(str_repeat("\0", 32)));
        self::assertSame($key, Base58::decode(Base58::encode($key)));
        self::assertSame('444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT', Base58::encode(Base58::decodePublicKey('444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT')));
    }

    public function testRejectsTextThatIsNotAPublicKey(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        Base58::decodePublicKey('reserve-0OIl');
    }
}
