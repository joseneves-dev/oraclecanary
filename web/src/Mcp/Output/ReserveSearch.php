<?php

namespace App\Mcp\Output;

/**
 * Result of the search_reserves tool.
 */
final readonly class ReserveSearch
{
    public function __construct(
        /** Number of reserves returned. */
        public int $count,
        /** @var list<ReserveSummary> Largest deposits first. */
        public array $reserves,
    ) {
    }
}
