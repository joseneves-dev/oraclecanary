<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class StatsApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    public function testCountsEachWatchedWalletOnceWithItsValue(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM wallet_watch');
        // One wallet watched by two chats, one wallet not checked yet.
        $this->watch($connection, 1, 'wallet-a', 200_000);
        $this->watch($connection, 2, 'wallet-a', 200_000);
        $this->watch($connection, 1, 'wallet-b', null);

        $stats = static::createClient()->request('GET', '/api/stats', ['headers' => ['Accept' => 'application/json']])->toArray();

        self::assertSame(2, $stats['walletsWatched']);
        self::assertSame(200_000.0, (float) $stats['valueWatchedUsd']);
    }

    private function watch(Connection $connection, int $chatId, string $wallet, ?float $usd): void
    {
        $connection->insert('wallet_watch', [
            'chat_id' => $chatId,
            'wallet' => $wallet,
            'created_at' => '2026-09-30 12:00:00',
            'last_state' => '[]',
            'last_usd' => $usd,
        ]);
    }
}
