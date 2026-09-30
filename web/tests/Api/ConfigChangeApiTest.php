<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class ConfigChangeApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const JSON = ['headers' => ['Accept' => 'application/json']];

    public function testListsChangesNewestFirstAndFiltersByKind(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM reserve_config_change');
        $this->insert($connection, 'SOL', '2026-09-30 10:00:00', 'price_source', 'Price source changed: Scope price chain [3] → [495].', ['scopeChain' => [3]], ['scopeChain' => [495]]);
        $this->insert($connection, 'NEW', '2026-09-30 12:00:00', 'listed', 'Newly listed in Main Market, priced by PythLazer.', null, ['providers' => ['PythLazer']]);
        $client = static::createClient();

        $changes = $client->request('GET', '/api/config-changes', self::JSON)->toArray();
        self::assertSame(['NEW', 'SOL'], array_column($changes, 'asset'));
        self::assertNull($changes[0]['before']);
        self::assertSame(['scopeChain' => [495]], $changes[1]['after']);

        $listed = $client->request('GET', '/api/config-changes?kind=listed', self::JSON)->toArray();
        self::assertSame(['NEW'], array_column($listed, 'asset'));

        $client->request('GET', '/api/config-changes?kind=nope', self::JSON);
        self::assertResponseStatusCodeSame(422);
    }

    private function insert(Connection $connection, string $asset, string $at, string $kind, string $detail, ?array $before, ?array $after): void
    {
        $connection->insert('reserve_config_change', [
            'address' => "reserve-$asset",
            'protocol' => 'kamino',
            'asset' => $asset,
            'market_name' => 'Main Market',
            'occurred_at' => $at,
            'kind' => $kind,
            'detail' => $detail,
            'before_value' => null === $before ? null : json_encode($before),
            'after_value' => null === $after ? null : json_encode($after),
            'total_supply_usd' => 1_000_000,
        ]);
    }
}
