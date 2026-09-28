<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use App\ApiResource\Model\Severity;
use App\Attestation\AttestationSigner;
use App\Repository\LendingReserveRepository;
use App\Solana\Base58;
use App\State\ReserveAttestationProvider;
use ApiPlatform\Metadata\Get;
use Doctrine\DBAL\Connection;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

final class AttestationApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const FWDI = '2ZdH2K1J6WHGvfjfjX73VbcSh1cGUeTjFfNkYQXpcEHn';

    protected function setUp(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM lending_reserve');
        $connection->insert('lending_reserve', [
            'address' => self::FWDI,
            'protocol' => 'kamino',
            'market' => 'market',
            'market_name' => 'Superstate Opening Bell Market',
            'asset' => 'FWDI',
            'mint' => 'mint',
            'status' => 'active',
            'total_supply_usd' => 27_000_000,
            'max_age_price_seconds' => 185,
            'price_age_seconds' => 224820,
            'score' => 35,
            'providers' => json_encode(['PythLazer']),
            'checks' => json_encode([
                ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 224820s old.'],
                ['code' => 'MARKET_CLOSED', 'severity' => 'info', 'message' => 'Market closed.'],
            ]),
            'feeds' => json_encode([]),
            'checked_at' => '2026-09-28 10:26:59',
        ]);
    }

    public function testSignsTheStoredHealthDatedWhenItWasMeasured(): void
    {
        $response = static::createClient()->request('GET', '/api/reserves/'.self::FWDI.'/attestation', ['headers' => ['Accept' => 'application/json']]);

        self::assertResponseIsSuccessful();
        $body = $response->toArray();
        self::assertSame(self::FWDI, $body['address']);
        self::assertSame(35, $body['score']);
        self::assertSame('critical', $body['severity']);
        self::assertSame(224820, $body['priceAgeSeconds']);
        self::assertSame('2026-09-28T10:26:59+00:00', $body['issuedAt']);

        $message = base64_decode($body['message'], true);
        $issuedAt = (new \DateTimeImmutable('2026-09-28 10:26:59', new \DateTimeZone('UTC')))->getTimestamp();
        self::assertSame(bin2hex(AttestationSigner::encode(self::FWDI, 35, Severity::Critical, 224820, $issuedAt)), bin2hex($message));
        self::assertTrue(sodium_crypto_sign_verify_detached(base64_decode($body['signature'], true), $message, Base58::decodePublicKey($body['publicKey'])));
    }

    public function testUnknownReserveIsNotFound(): void
    {
        static::createClient()->request('GET', '/api/reserves/11111111111111111111111111111111/attestation', ['headers' => ['Accept' => 'application/json']]);

        self::assertResponseStatusCodeSame(404);
    }

    public function testSignsUnrecognisedOrMissingSeveritiesAsCritical(): void
    {
        self::assertSame(Severity::Warning, ReserveAttestationProvider::signedSeverity([['code' => 'NO_FALLBACK', 'severity' => 'warning']]));
        self::assertSame(Severity::Ok, ReserveAttestationProvider::signedSeverity([]));
        self::assertSame(Severity::Critical, ReserveAttestationProvider::signedSeverity([['code' => 'NEW_CHECK', 'severity' => 'high']]));
        self::assertSame(Severity::Critical, ReserveAttestationProvider::signedSeverity([['code' => 'NEW_CHECK']]));
        self::assertSame(Severity::Critical, ReserveAttestationProvider::signedSeverity(['not a check']));
    }

    public function testAnswers503WhenTheKeyIsMalformed(): void
    {
        $provider = new ReserveAttestationProvider(self::getContainer()->get(LendingReserveRepository::class), new AttestationSigner(base64_encode('not a 32-byte seed')));

        $this->expectException(ServiceUnavailableHttpException::class);
        $this->expectExceptionMessage('misconfigured');
        $provider->provide(new Get(), ['address' => self::FWDI]);
    }

    public function testRefusesWhenNoSigningKeyIsConfigured(): void
    {
        $provider = new ReserveAttestationProvider(self::getContainer()->get(LendingReserveRepository::class), new AttestationSigner(''));

        $this->expectException(ServiceUnavailableHttpException::class);
        $provider->provide(new Get(), ['address' => self::FWDI]);
    }
}
