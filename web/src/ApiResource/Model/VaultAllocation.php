<?php

namespace App\ApiResource\Model;

/**
 * The part of a curator vault lent to one reserve, with that reserve's current oracle health.
 */
final readonly class VaultAllocation
{
    public function __construct(
        /** Reserve address. */
        public string $reserve,
        public string $asset,
        public ?string $marketName,
        /** Value the vault has in this reserve, in USD. */
        public float $usd,
        /** Share of the vault, 0 to 1. */
        public float $share,
        /** The reserve's worst open check, or "ok"; a stock only stale because its market is closed counts as not stale. */
        public Severity $severity,
        /** The reserve's score, or null when it is not monitored. */
        public ?int $score,
        /** The reserve's most severe check message, or null when healthy. */
        public ?string $mainIssue,
        /**
         * Other assets in the same market with a critical check, e.g. "FWDI: Price is 226140s old…":
         * collateral whose price cannot be used, so loans against it cannot be liquidated.
         *
         * @var list<string>
         */
        public array $collateralIssues,
    ) {
    }
}
