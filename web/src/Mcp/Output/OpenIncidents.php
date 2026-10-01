<?php

namespace App\Mcp\Output;

/**
 * Result of the open_incidents tool.
 */
final readonly class OpenIncidents
{
    public function __construct(
        /** Number of incidents returned. */
        public int $count,
        /** @var list<OpenIncident> Most recent start first. */
        public array $incidents,
    ) {
    }
}
