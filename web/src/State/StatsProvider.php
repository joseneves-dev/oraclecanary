<?php

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\Stats;
use Doctrine\DBAL\Connection;

/**
 * @implements ProviderInterface<Stats>
 */
final readonly class StatsProvider implements ProviderInterface
{
    public function __construct(private Connection $connection)
    {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): Stats
    {
        // A wallet watched by several chats counts once, at its most recently checked value.
        $row = $this->connection->fetchAssociative(
            'SELECT COUNT(*) AS wallets, COALESCE(SUM(usd), 0) AS usd
               FROM (SELECT DISTINCT ON (wallet) wallet, last_usd AS usd
                       FROM wallet_watch ORDER BY wallet, last_checked_at DESC NULLS LAST) AS watched',
        );

        return new Stats((int) ($row['wallets'] ?? 0), (float) ($row['usd'] ?? 0));
    }
}
