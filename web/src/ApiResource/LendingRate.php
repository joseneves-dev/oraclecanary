<?php

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use App\ApiResource\Model\LentAgainst;
use App\ApiResource\Model\MarketRef;
use App\ApiResource\Model\Severity;
use App\State\LendingRateProvider;

/**
 * A supply pool's lending rates next to oracle facts about the pool and about the collateral its
 * deposits are lent against. Facts only: no ranking, score or recommendation.
 */
#[ApiResource(
    shortName: 'LendingRate',
    description: 'Supply pools of Kamino, marginfi and Jupiter Lend with the rates each protocol reports, and oracle facts about the pool and the collateral it is lent against. Rates come from each protocol\'s public API or on-chain state; not investment advice.',
    operations: [
        new GetCollection(
            uriTemplate: '/rates',
            description: 'Supply pools in the markets listed by each protocol\'s own app, largest deposits first. Also as CSV (Accept: text/csv).',
            outputFormats: ['jsonld' => ['application/ld+json'], 'json' => ['application/json'], 'csv' => ['text/csv']],
            paginationEnabled: false,
            provider: LendingRateProvider::class,
        ),
        new Get(
            uriTemplate: '/rates/{address}',
            description: 'One supply pool.',
            provider: LendingRateProvider::class,
        ),
    ],
    normalizationContext: ['skip_null_values' => false],
    cacheHeaders: ['public' => true, 'max_age' => 60, 'shared_max_age' => 120, 'stale_while_revalidate' => 60],
)]
final class LendingRate
{
    public function __construct(
        /** Reserve or bank address; for a Jupiter Lend Earn pool, its share token (fToken) address. */
        #[ApiProperty(identifier: true)]
        public string $address,
        /** kamino, marginfi or jupiter-lend. */
        public string $protocol,
        /** "reserve" (a Kamino reserve or marginfi bank) or "earn" (a Jupiter Lend Earn pool). */
        public string $kind,
        /** For an Earn pool, Jupiter Lend as a whole. */
        public MarketRef $market,
        /** Deposit token symbol, e.g. "USDC". */
        public string $asset,
        /** Deposit token mint. */
        public string $mint,
        /** What depositors earn per year as the protocol reports it, a fraction (0.05 = 5%), without token incentives. */
        public ?float $supplyApy,
        /** What borrowers pay per year as the protocol reports it, a fraction; null for an Earn pool. */
        public ?float $borrowApy,
        /** Token incentives on top of supplyApy where the source reports them apart (Jupiter Lend), a fraction. */
        public ?float $rewardsApy,
        /** Where the rates come from: kamino-api (Kamino's public API), marginfi-onchain (the bank account) or jupiter-api (Jupiter's public API). */
        public ?string $rateSource,
        /** When the source computed (or OracleCanary read) the rates. */
        public ?\DateTimeImmutable $rateAt,
        /** Deposits in the pool, in USD. */
        public float $totalSupplyUsd,
        /** The pool's own oracle score, 0 (broken) to 100 (healthy); null for an Earn pool, which has no oracle of its own. */
        public ?int $score,
        /** Worst severity among the pool's own failed checks; null for an Earn pool. */
        public ?Severity $severity,
        /** How the pool's health reads: its severity, or "paused" when a stock's price is only stopped by its closed market; null for an Earn pool. */
        public ?string $healthState,
        /**
         * Oracle providers the pool's own price comes from.
         *
         * @var list<string>
         */
        public array $providers,
        /**
         * Codes of the pool's own failed checks, e.g. NO_FALLBACK.
         *
         * @var list<string>
         */
        public array $checks,
        /** Oracle facts about the collateral the pool's deposits are lent against (an approximation; see LentAgainst). */
        public LentAgainst $lentAgainst,
        /** When OracleCanary last checked the pool's oracle (or read an Earn pool). */
        public \DateTimeImmutable $checkedAt,
    ) {
    }
}
