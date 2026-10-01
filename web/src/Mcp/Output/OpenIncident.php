<?php

namespace App\Mcp\Output;

use App\ApiResource\Model\CheckState;
use App\ApiResource\ReserveIncident;
use App\Mcp\Notice;

/**
 * One ongoing incident in an open_incidents result.
 */
final readonly class OpenIncident
{
    public function __construct(
        /** Id in GET /api/incidents/{id}. */
        public string $id,
        /** Reserve / bank / vault address. */
        public string $reserve,
        public string $asset,
        public string $protocol,
        public ?string $marketName,
        /** When the reserve started failing (UTC). */
        public \DateTimeImmutable $startedAt,
        /** True when the start is worked out from the price age (failing before tracking began). */
        public bool $startEstimated,
        /** How long it has lasted so far, in seconds. */
        public int $ongoingSeconds,
        /** @var list<CheckState> The critical checks when it started. */
        public array $checks,
        /** Largest deposits exposed during the incident, in USD. */
        public float $totalSupplyUsd,
        public string $link,
    ) {
    }

    public static function fromIncident(ReserveIncident $incident, \DateTimeImmutable $now): self
    {
        $startedAt = Notice::utc($incident->startedAt);

        return new self(
            $incident->id,
            $incident->reserve,
            $incident->asset,
            $incident->protocol,
            $incident->marketName,
            $startedAt,
            $incident->startEstimated,
            max(0, $now->getTimestamp() - $startedAt->getTimestamp()),
            $incident->checks,
            $incident->totalSupplyUsd,
            Notice::reserveLink($incident->reserve),
        );
    }
}
