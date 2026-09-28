<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class VaultApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const HEADERS = ['headers' => ['Accept' => 'application/json']];

    protected function setUp(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM curator_vault');
        $connection->executeStatement('DELETE FROM lending_reserve');

        // A stock market: the vault lends USDC, borrowers post FWDI, whose price is frozen.
        $this->insertReserve('usdc-stocks', 'USDC', 'stocks', 'Superstate Market', 3_000_000, []);
        $this->insertReserve('fwdi', 'FWDI', 'stocks', 'Superstate Market', 27_000_000, [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 226140s old.'],
        ]);
        // A healthy market.
        $this->insertReserve('usdc-main', 'USDC', 'main', 'Main Market', 100_000_000, [
            ['code' => 'NO_FALLBACK', 'severity' => 'warning', 'message' => 'Price has no fallback.'],
        ]);

        $this->insertVault('vault-big', 'Steakhouse USDC', 'Steakhouse', 10_500_000, [['reserve' => 'usdc-main', 'usd' => 9_000_000], ['reserve' => 'usdc-stocks', 'usd' => 1_500_000]]);
        $this->insertVault('vault-small', 'Allez USDC', 'Allez', 2_000_000, [['reserve' => 'usdc-main', 'usd' => 2_000_000]]);
    }

    public function testListsVaultsLargestFirstWithMoneyAtRisk(): void
    {
        $vaults = static::createClient()->request('GET', '/api/vaults', self::HEADERS)->toArray();

        self::assertSame(['Steakhouse USDC', 'Allez USDC'], array_column($vaults, 'name'));
        self::assertSame(1_500_000.0, (float) $vaults[0]['atRiskUsd']);
        self::assertSame(9_000_000.0, (float) $vaults[0]['warningUsd']);
        self::assertSame('critical', $vaults[0]['worstSeverity']);
        self::assertSame(0.0, (float) $vaults[1]['atRiskUsd']);
        self::assertSame('warning', $vaults[1]['worstSeverity']);
    }

    public function testShowsEachAllocationWithItsReserveAndCollateralHealth(): void
    {
        $vault = static::createClient()->request('GET', '/api/vaults/vault-big', self::HEADERS)->toArray();

        [$main, $stocks] = $vault['allocations'];
        self::assertSame('usdc-main', $main['reserve']);
        self::assertSame('warning', $main['severity']);
        self::assertSame('Price has no fallback.', $main['mainIssue']);
        self::assertSame([], $main['collateralIssues']);

        self::assertSame('Superstate Market', $stocks['marketName']);
        self::assertSame('ok', $stocks['severity']);
        self::assertSame(['FWDI: Price is 226140s old.'], $stocks['collateralIssues']);
        self::assertEqualsWithDelta(1_500_000 / 10_500_000, $stocks['share'], 1e-9);
    }

    public function testIgnoresDustCollateralAndClosedStockMarkets(): void
    {
        // Ten cents of broken collateral, and a stock that is only stale because its market is closed.
        $this->insertReserve('dust', 'USDT', 'main', 'Main Market', 0.10, [
            ['code' => 'EMPTY_PRICE_ENTRY', 'severity' => 'critical', 'message' => 'Price depends on Scope entry 14, which is not configured.'],
        ]);
        $connection = self::getContainer()->get(Connection::class);
        $connection->update('lending_reserve', ['checks' => json_encode([
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 226140s old.'],
            ['code' => 'MARKET_CLOSED', 'severity' => 'info', 'message' => 'The US stock market is closed for the weekend.'],
        ])], ['address' => 'fwdi']);

        $vault = static::createClient()->request('GET', '/api/vaults/vault-big', self::HEADERS)->toArray();

        self::assertSame(0.0, (float) $vault['atRiskUsd']);
        self::assertSame([[], []], array_column($vault['allocations'], 'collateralIssues'));
    }

    public function testShowsAnAllocationWhoseReserveIsNotMonitored(): void
    {
        $this->insertVault('vault-hidden', 'Allez USDC', 'Allez', 500_000, [['reserve' => 'hidden-reserve', 'usd' => 500_000]]);

        $vault = static::createClient()->request('GET', '/api/vaults/vault-hidden', self::HEADERS)->toArray();

        self::assertSame('', $vault['allocations'][0]['asset']);
        self::assertSame('warning', $vault['allocations'][0]['severity']);
        self::assertNull($vault['allocations'][0]['score']);
        self::assertStringStartsWith('Not monitored', $vault['allocations'][0]['mainIssue']);
        self::assertSame(500_000.0, (float) $vault['warningUsd']);
        self::assertSame('warning', $vault['worstSeverity']);
    }

    public function testDoesNotCountAStockOnlyStaleBecauseItsMarketIsClosed(): void
    {
        self::getContainer()->get(Connection::class)->update('lending_reserve', ['checks' => json_encode([
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 226140s old.'],
            ['code' => 'MARKET_CLOSED', 'severity' => 'info', 'message' => 'The US stock market is closed for the weekend.'],
        ])], ['address' => 'fwdi']);
        $this->insertVault('vault-stock', 'Stock lender', 'Allez', 1_000_000, [['reserve' => 'fwdi', 'usd' => 1_000_000]]);

        $vault = static::createClient()->request('GET', '/api/vaults/vault-stock', self::HEADERS)->toArray();

        self::assertSame(0.0, (float) $vault['atRiskUsd']);
        self::assertSame('info', $vault['allocations'][0]['severity']);
    }

    public function testUnknownVaultIsNotFound(): void
    {
        static::createClient()->request('GET', '/api/vaults/nope', self::HEADERS);

        self::assertResponseStatusCodeSame(404);
    }

    /** @param list<array{code: string, severity: string, message: string}> $checks */
    private function insertReserve(string $address, string $asset, string $market, string $marketName, float $supplyUsd, array $checks): void
    {
        $severities = array_column($checks, 'severity');
        self::getContainer()->get(Connection::class)->insert('lending_reserve', [
            'address' => $address,
            'protocol' => 'kamino',
            'market' => $market,
            'market_name' => $marketName,
            'asset' => $asset,
            'mint' => 'mint-'.$asset,
            'status' => 'active',
            'total_supply_usd' => $supplyUsd,
            'max_age_price_seconds' => 120,
            'price_age_seconds' => 10,
            'score' => \in_array('critical', $severities, true) ? 50 : (\in_array('warning', $severities, true) ? 85 : 100),
            'providers' => json_encode(['PythLazer']),
            'checks' => json_encode($checks),
            'feeds' => json_encode([]),
            'checked_at' => '2026-09-28 17:00:00',
        ]);
    }

    /** @param list<array{reserve: string, usd: float}> $allocations */
    private function insertVault(string $address, string $name, string $curator, float $totalUsd, array $allocations): void
    {
        self::getContainer()->get(Connection::class)->insert('curator_vault', [
            'address' => $address,
            'name' => $name,
            'curator' => $curator,
            'token_mint' => 'mint-USDC',
            'token' => 'USDC',
            'total_usd' => $totalUsd,
            'idle_usd' => 0,
            'allocations' => json_encode($allocations),
            'checked_at' => '2026-09-28 17:00:00',
        ]);
    }
}
