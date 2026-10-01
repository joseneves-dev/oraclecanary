<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class LendingRateApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const HEADERS = ['headers' => ['Accept' => 'application/json']];

    private const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    protected function setUp(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM lending_earn_pool');
        $connection->executeStatement('DELETE FROM lending_reserve');

        // A Kamino market: USDC is lent against SOL (with a fallback), JitoSOL (single feed), a fixed-price
        // token, a stock and a broken token; one reserve is not accepted as collateral.
        $this->insertReserve('usdc', 'kamino', 'main', 'Main Market', 'USDC', 100_000_000, [
            ['code' => 'NO_FALLBACK', 'severity' => 'warning', 'message' => 'Price has no fallback.'],
        ], rate: [0.045, 0.06, 0.8]);
        $this->insertReserve('sol', 'kamino', 'main', 'Main Market', 'SOL', 40_000_000, [], rate: [0.05, 0.07, 0.75]);
        $this->insertReserve('jitosol', 'kamino', 'main', 'Main Market', 'JITOSOL', 30_000_000, [
            ['code' => 'NO_FALLBACK', 'severity' => 'warning', 'message' => 'Price has no fallback.'],
        ], rate: [0.0, 0.02, 0.7]);
        $this->insertReserve('fixed', 'kamino', 'main', 'Main Market', 'PST', 10_000_000, [
            ['code' => 'FIXED_PRICE', 'severity' => 'info', 'message' => 'Price is fixed.'],
        ], rate: [0.0, 0.01, 0.5]);
        $this->insertReserve('stock', 'kamino', 'main', 'Main Market', 'SPYx', 10_000_000, [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 9000s old.'],
            ['code' => 'MARKET_CLOSED', 'severity' => 'info', 'message' => 'The US stock market is closed.'],
        ], rate: [0.001, 0.01, 0.5], marketHours: true);
        $this->insertReserve('broken', 'kamino', 'main', 'Main Market', 'BRK', 10_000_000, [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 9000s old.'],
        ], rate: [0.0, 0.01, 0.5]);
        $this->insertReserve('no-collateral', 'kamino', 'main', 'Main Market', 'XYZ', 50_000_000, [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 9000s old.'],
        ], rate: [0.0, 0.01, 0.0]);
        // No rate reported yet: not a supply pool, but still collateral.
        $this->insertReserve('no-rate', 'kamino', 'other', 'JLP Market', 'JLP', 5_000_000, []);
        // Unlisted market: never listed.
        $this->insertReserve('unlisted', 'kamino', 'anyone', null, 'USDC', 9_000_000, [], rate: [0.5, 0.6, 0.8]);

        // Jupiter Lend: two vaults borrow USDC, one borrows SOL.
        $this->insertReserve('vault-sol-usdc', 'jupiter-lend', 'jupiter', 'Jupiter Lend', 'SOL/USDC', 300_000_000, [
            ['code' => 'NO_FALLBACK', 'severity' => 'warning', 'message' => 'Price has no fallback.'],
        ], borrowMint: self::USDC);
        $this->insertReserve('vault-btc-usdc', 'jupiter-lend', 'jupiter', 'Jupiter Lend', 'cbBTC/USDC', 100_000_000, [], borrowMint: self::USDC);
        $this->insertReserve('vault-usdc-sol', 'jupiter-lend', 'jupiter', 'Jupiter Lend', 'USDC/SOL', 50_000_000, [], borrowMint: 'So11111111111111111111111111111111111111112');
        $connection->insert('lending_earn_pool', [
            'address' => 'earn-usdc',
            'asset' => 'USDC',
            'mint' => self::USDC,
            'supply_apy' => 0.0408,
            'rewards_apy' => 0.0038,
            'total_supply_usd' => 470_000_000,
            'rate_source' => 'jupiter-api',
            'rate_at' => '2026-10-01 12:00:00',
            'checked_at' => '2026-10-01 12:00:00',
        ]);
    }

    public function testListsSupplyPoolsLargestFirstWithTheirRateSources(): void
    {
        $pools = static::createClient()->request('GET', '/api/rates', self::HEADERS)->toArray();

        self::assertResponseIsSuccessful();
        self::assertSame(
            ['earn-usdc', 'usdc', 'sol', 'stock'],
            array_column($pools, 'address'),
            'listed pools whose depositors earn something, by deposits: reserves that only hold collateral earn nothing and are left out',
        );

        $earn = $pools[0];
        self::assertSame('jupiter-lend', $earn['protocol']);
        self::assertSame('earn', $earn['kind']);
        self::assertSame('Jupiter Lend Earn', $earn['market']['name']);
        self::assertEqualsWithDelta(0.0408, $earn['supplyApy'], 1e-9);
        self::assertEqualsWithDelta(0.0038, $earn['rewardsApy'], 1e-9);
        self::assertNull($earn['borrowApy']);
        self::assertSame('jupiter-api', $earn['rateSource']);
        self::assertSame('2026-10-01T12:00:00+00:00', $earn['rateAt']);
        self::assertNull($earn['score']);
        self::assertNull($earn['healthState']);

        $usdc = $pools[1];
        self::assertSame('reserve', $usdc['kind']);
        self::assertSame(['address' => 'main', 'name' => 'Main Market'], $usdc['market']);
        self::assertEqualsWithDelta(0.045, $usdc['supplyApy'], 1e-9);
        self::assertEqualsWithDelta(0.06, $usdc['borrowApy'], 1e-9);
        self::assertSame('kamino-api', $usdc['rateSource']);
        self::assertSame('warning', $usdc['severity']);
        self::assertSame(['NO_FALLBACK'], $usdc['checks']);
        self::assertSame(['PythLazer'], $usdc['providers']);
    }

    public function testDescribesTheCollateralOfAMarketAsShares(): void
    {
        $pool = static::createClient()->request('GET', '/api/rates/usdc', self::HEADERS)->toArray();
        $lent = $pool['lentAgainst'];

        // SOL 40M, JITOSOL 30M, PST 10M, SPYx 10M, BRK 10M; XYZ is not accepted as collateral.
        self::assertSame('market', $lent['basis']);
        self::assertSame(100_000_000.0, (float) $lent['collateralUsd']);
        self::assertSame(5, $lent['reserves']);
        self::assertEqualsWithDelta(0.6, $lent['withFallbackShare'], 1e-9, 'SOL, SPYx and BRK have no single-feed or fixed price');
        self::assertEqualsWithDelta(0.3, $lent['singleFeedShare'], 1e-9);
        self::assertEqualsWithDelta(0.1, $lent['fixedPriceShare'], 1e-9);
        self::assertEqualsWithDelta(0.1, $lent['marketHoursShare'], 1e-9);
        self::assertSame(0.0, (float) $lent['windingDownShare']);
        // The stock is only paused by its closed market: not counted as critical.
        self::assertSame(1, $lent['criticalCount']);
        self::assertSame(10_000_000.0, (float) $lent['criticalUsd']);
        self::assertSame(['BRK'], $lent['criticalAssets']);
    }

    public function testReadsAStockPausedByItsClosedMarketAsPaused(): void
    {
        $pool = static::createClient()->request('GET', '/api/rates/stock', self::HEADERS)->toArray();

        self::assertSame('critical', $pool['severity']);
        self::assertSame('paused', $pool['healthState']);
        self::assertSame(['STALE', 'MARKET_CLOSED'], $pool['checks']);
    }

    public function testLendsAnEarnPoolAgainstTheVaultsBorrowingItsToken(): void
    {
        $lent = static::createClient()->request('GET', '/api/rates/earn-usdc', self::HEADERS)->toArray()['lentAgainst'];

        self::assertSame('vaults', $lent['basis']);
        self::assertSame(2, $lent['reserves']);
        self::assertSame(400_000_000.0, (float) $lent['collateralUsd']);
        self::assertEqualsWithDelta(0.75, $lent['singleFeedShare'], 1e-9);
        self::assertEqualsWithDelta(0.25, $lent['withFallbackShare'], 1e-9);
        self::assertSame(0, $lent['criticalCount']);
    }

    public function testExportsCsv(): void
    {
        $response = static::createClient()->request('GET', '/api/rates', ['headers' => ['Accept' => 'text/csv']]);

        self::assertResponseIsSuccessful();
        self::assertStringStartsWith('text/csv', $response->getHeaders()['content-type'][0]);
        $header = strtok($response->getContent(), "\n");
        self::assertStringContainsString('supplyApy', $header);
        self::assertStringContainsString('lentAgainst.singleFeedShare', $header);
    }

    public function testUnknownPoolIsNotFound(): void
    {
        static::createClient()->request('GET', '/api/rates/unlisted', self::HEADERS);

        self::assertResponseStatusCodeSame(404);
    }

    /**
     * @param list<array{code: string, severity: string, message: string}> $checks
     * @param array{0: float, 1: float, 2: float}|null                     $rate    supply APY, borrow APY, max LTV
     */
    private function insertReserve(
        string $address,
        string $protocol,
        string $market,
        ?string $marketName,
        string $asset,
        float $supplyUsd,
        array $checks,
        ?array $rate = null,
        bool $marketHours = false,
        ?string $borrowMint = null,
    ): void {
        $severities = array_column($checks, 'severity');
        self::getContainer()->get(Connection::class)->insert('lending_reserve', [
            'address' => $address,
            'protocol' => $protocol,
            'market' => $market,
            'market_name' => $marketName,
            'asset' => $asset,
            'mint' => 'USDC' === $asset ? self::USDC : 'mint-'.$asset,
            'status' => 'active',
            'total_supply_usd' => $supplyUsd,
            'max_age_price_seconds' => 120,
            'price_age_seconds' => 10,
            'score' => \in_array('critical', $severities, true) ? 50 : (\in_array('warning', $severities, true) ? 85 : 100),
            'providers' => json_encode(['PythLazer']),
            'checks' => json_encode($checks),
            'feeds' => json_encode([]),
            'checked_at' => '2026-10-01 12:00:00',
            'borrow_mint' => $borrowMint,
            'market_hours' => $marketHours ? 'true' : 'false',
            'supply_apy' => $rate[0] ?? null,
            'borrow_apy' => $rate[1] ?? null,
            'max_ltv' => $rate[2] ?? null,
            'rate_source' => $rate ? 'kamino-api' : null,
            'rate_at' => $rate ? '2026-10-01 11:55:00' : null,
        ]);
    }
}
