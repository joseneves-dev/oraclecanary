<?php

namespace App\ApiResource\Model;

/**
 * Oracle facts about the collateral a supply pool's deposits are lent against.
 *
 * An approximation: the protocols do not say which deposit backs which loan. For a Kamino reserve or
 * a marginfi bank, the collateral is the other reserves of the same market (group), weighted by
 * their deposits and leaving out reserves the protocol does not accept as collateral (max LTV 0). For
 * a Jupiter Lend Earn pool, it is the deposits of every Jupiter Lend vault that borrows the pool's
 * token. Deposits are counted whether or not they back a loan.
 */
final readonly class LentAgainst
{
    public function __construct(
        /** How the collateral was chosen: "market" (other reserves of the same market) or "vaults" (Jupiter Lend vaults borrowing this token). */
        public string $basis,
        /** Deposits in the collateral reserves, in USD. */
        public float $collateralUsd,
        /** How many collateral reserves (or vaults) there are. */
        public int $reserves,
        /**
         * Share of the collateral (by USD, 0 to 1) whose price has a fallback: no single feed it depends
         * on, not fixed, and readable. The three oracle shares need not add to 1; the rest is collateral
         * whose oracle could not be read or has none.
         */
        public float $withFallbackShare,
        /** Share of the collateral whose price depends on one feed with no fallback (check NO_FALLBACK): if it stops, the price stops. */
        public float $singleFeedShare,
        /** Share of the collateral priced at a fixed value that does not follow the market (check FIXED_PRICE). */
        public float $fixedPriceShare,
        /** Share of the collateral that is tokenized US stocks, whose prices pause while the stock market is closed. */
        public float $marketHoursShare,
        /** Share of the collateral in reserves being wound down (check WINDING_DOWN). */
        public float $windingDownShare,
        /**
         * Collateral reserves holding $10K or more that have a critical check now; a stock whose price
         * is only paused because its market is closed is not counted.
         */
        public int $criticalCount,
        /** Deposits in those reserves, in USD. */
        public float $criticalUsd,
        /**
         * Their assets, largest first (at most five).
         *
         * @var list<string>
         */
        public array $criticalAssets,
    ) {
    }
}
