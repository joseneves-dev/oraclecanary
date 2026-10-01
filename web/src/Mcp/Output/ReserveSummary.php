<?php

namespace App\Mcp\Output;

use App\ApiResource\Model\Severity;
use App\ApiResource\Reserve;
use App\Mcp\Notice;

/**
 * One reserve in a search_reserves result: enough to pick one, then ask reserve_health for details.
 */
final readonly class ReserveSummary
{
    public function __construct(
        public string $address,
        public string $asset,
        public string $protocol,
        /** Market name shown by the protocol's app; null for unlisted (permissionless) markets. */
        public ?string $marketName,
        /** 0 (broken) to 100 (healthy). */
        public int $score,
        public Severity $severity,
        /** Age of the oldest price, in seconds; null when it could not be read. */
        public ?int $priceAgeSeconds,
        /** The protocol's maximum price age, in seconds. */
        public int $maxPriceAgeSeconds,
        /** @var list<string> Codes of the failed checks, e.g. ["STALE"]. */
        public array $failedChecks,
        /** Deposited value, in USD. */
        public float $totalSupplyUsd,
        public string $link,
    ) {
    }

    public static function fromReserve(Reserve $reserve): self
    {
        return new self(
            $reserve->address,
            $reserve->asset,
            $reserve->protocol,
            $reserve->market->name,
            $reserve->score,
            $reserve->severity,
            $reserve->price->ageSeconds,
            $reserve->price->maxAgeSeconds,
            array_map(static fn ($check) => $check->code, $reserve->checks),
            $reserve->totalSupplyUsd,
            Notice::reserveLink($reserve->address),
        );
    }
}
