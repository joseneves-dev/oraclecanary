<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class ReserveApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    protected function setUp(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM lending_reserve');

        $this->insertReserve('reserve-sol', 'SOL', score: 100, supplyUsd: 300_000_000);
        $this->insertReserve('reserve-fwdi', 'FWDI', score: 35, supplyUsd: 27_000_000, priceAgeSeconds: 159998, checks: [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 159998s old.'],
        ]);
        $this->insertReserve('reserve-alp', 'ALP', score: 45, supplyUsd: 30_000);
    }

    public function testListsReservesWorstScoreFirst(): void
    {
        $response = static::createClient()->request('GET', '/api/reserves', ['headers' => ['Accept' => 'application/json']]);

        self::assertResponseIsSuccessful();
        self::assertSame(['FWDI', 'ALP', 'SOL'], array_column($response->toArray(), 'asset'));
    }

    public function testFiltersByScoreAndSortsBySupply(): void
    {
        $response = static::createClient()->request('GET', '/api/reserves?score[lt]=50&order[totalSupplyUsd]=asc', [
            'headers' => ['Accept' => 'application/json'],
        ]);

        self::assertResponseIsSuccessful();
        self::assertSame(['ALP', 'FWDI'], array_column($response->toArray(), 'asset'));
    }

    public function testFiltersListedMarkets(): void
    {
        $this->insertReserve('reserve-junk', 'JUNK', score: 100, supplyUsd: 2e12, marketName: null);
        $headers = ['headers' => ['Accept' => 'application/json']];
        $client = static::createClient();

        $listed = $client->request('GET', '/api/reserves?listed=true', $headers)->toArray();
        self::assertNotContains('JUNK', array_column($listed, 'asset'));

        $unlisted = $client->request('GET', '/api/reserves?listed=false', $headers)->toArray();
        self::assertSame(['JUNK'], array_column($unlisted, 'asset'));
    }

    public function testReturnsOneReserveWithItsChecks(): void
    {
        $response = static::createClient()->request('GET', '/api/reserves/reserve-fwdi', ['headers' => ['Accept' => 'application/json']]);

        self::assertResponseIsSuccessful();
        $data = $response->toArray();
        self::assertSame(35, $data['score']);
        self::assertSame(['address' => 'market', 'name' => 'Main Market'], $data['market']);
        self::assertSame(['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 159998s old.'], $data['checks'][0]);
        self::assertSame(['scopePrices' => 'prices', 'scopeChain' => [3], 'pyth' => null, 'switchboard' => null], $data['oracleAccounts']);
    }

    public function testSummarisesSeverityAndPriceFreshness(): void
    {
        $client = static::createClient();
        $headers = ['headers' => ['Accept' => 'application/json']];

        $fwdi = $client->request('GET', '/api/reserves/reserve-fwdi', $headers)->toArray();
        self::assertSame('critical', $fwdi['severity']);
        self::assertSame(['ageSeconds' => 159998, 'maxAgeSeconds' => 120, 'isStale' => true], $fwdi['price']);

        $sol = $client->request('GET', '/api/reserves/reserve-sol', $headers)->toArray();
        self::assertSame('ok', $sol['severity']);
        self::assertFalse($sol['price']['isStale']);
    }

    public function testDoesNotExposeStorageOnlyFields(): void
    {
        $data = static::createClient()->request('GET', '/api/reserves/reserve-sol', ['headers' => ['Accept' => 'application/json']])->toArray();

        self::assertArrayNotHasKey('feeds', $data);
        self::assertArrayNotHasKey('marketName', $data);
        self::assertArrayNotHasKey('maxAgePriceSeconds', $data);
    }

    public function testIsReadOnly(): void
    {
        static::createClient()->request('POST', '/api/reserves', ['json' => ['asset' => 'X']]);

        self::assertResponseStatusCodeSame(405);
    }

    public function testPublishesOpenApiDocumentation(): void
    {
        $response = static::createClient()->request('GET', '/api/docs', ['headers' => ['Accept' => 'application/vnd.openapi+json']]);

        self::assertResponseIsSuccessful();
        self::assertArrayHasKey('/api/reserves', $response->toArray()['paths']);
    }

    private function insertReserve(string $address, string $asset, int $score, float $supplyUsd, int $priceAgeSeconds = 10, array $checks = [], ?string $marketName = 'Main Market'): void
    {
        self::getContainer()->get(Connection::class)->insert('lending_reserve', [
            'address' => $address,
            'protocol' => 'kamino',
            'market' => 'market',
            'market_name' => $marketName,
            'asset' => $asset,
            'mint' => 'mint-'.$asset,
            'status' => 'active',
            'total_supply_usd' => $supplyUsd,
            'max_age_price_seconds' => 120,
            'price_age_seconds' => $priceAgeSeconds,
            'score' => $score,
            'providers' => json_encode(['PythLazer']),
            'checks' => json_encode($checks),
            'feeds' => json_encode(['scope' => 'prices', 'scopeChain' => [3]]),
            'checked_at' => '2026-09-27 16:00:00',
        ]);
    }
}
