<?php

namespace App\Mcp\Output;

use App\ApiResource\Model\HealthCheck;
use App\ApiResource\Model\MarketRef;
use App\ApiResource\Model\PriceStatus;
use App\ApiResource\Model\Severity;
use App\ApiResource\Reserve;
use App\Mcp\Notice;

/**
 * Result of the reserve_health tool: the same facts as GET /api/reserves/{address}, without the
 * oracle account addresses.
 */
final readonly class ReserveHealth
{
    public function __construct(
        /** Reserve / bank / vault address on Solana. */
        public string $address,
        /** Token symbol as configured by the protocol, e.g. "SOL". */
        public string $asset,
        /** Lending protocol, e.g. "kamino". */
        public string $protocol,
        public MarketRef $market,
        /** active, obsolete or hidden. */
        public string $status,
        /** 0 (broken) to 100 (healthy). */
        public int $score,
        /** Worst severity among the failed checks, or "ok" when none failed. */
        public Severity $severity,
        /** Age of the oldest price against the protocol's maximum age; stale when older. */
        public PriceStatus $price,
        /** @var list<string> Oracle providers the price comes from, e.g. ["PythLazer", "Chainlink"]. */
        public array $providers,
        /** @var list<HealthCheck> Failed checks; empty when healthy. */
        public array $checks,
        /** Deposited value (available + borrowed), in USD. */
        public float $totalSupplyUsd,
        /** When the health was measured (UTC). */
        public \DateTimeImmutable $checkedAt,
        /** The reserve's page on oraclecanary.com. */
        public string $link,
    ) {
    }

    public static function fromReserve(Reserve $reserve): self
    {
        return new self(
            $reserve->address,
            $reserve->asset,
            $reserve->protocol,
            $reserve->market,
            $reserve->status,
            $reserve->score,
            $reserve->severity,
            $reserve->price,
            $reserve->providers,
            $reserve->checks,
            $reserve->totalSupplyUsd,
            Notice::utc($reserve->checkedAt),
            Notice::reserveLink($reserve->address),
        );
    }
}
