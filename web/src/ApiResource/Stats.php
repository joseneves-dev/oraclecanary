<?php

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use App\State\StatsProvider;

/**
 * Public usage figures: how many wallets people watch through the Telegram bot, and the deposits in
 * them. Only totals; no wallet is listed.
 */
#[ApiResource(
    shortName: 'Stats',
    operations: [
        new Get(
            uriTemplate: '/stats',
            description: 'How many wallets are watched through the Telegram bot, and the deposits in them.',
            provider: StatsProvider::class,
            errors: [],
        ),
    ],
    cacheHeaders: ['public' => true, 'max_age' => 60, 'shared_max_age' => 120],
)]
final class Stats
{
    public function __construct(
        /** Distinct wallets watched by at least one chat. */
        public int $walletsWatched,
        /** Deposits in those wallets (Kamino and marginfi) at their last check, in USD. */
        public float $valueWatchedUsd,
    ) {
    }
}
