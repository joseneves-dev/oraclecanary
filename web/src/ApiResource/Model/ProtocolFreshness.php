<?php

namespace App\ApiResource\Model;

final readonly class ProtocolFreshness
{
    public function __construct(
        /** e.g. "kamino". */
        public string $protocol,
        /** "ok" when refreshed within the limit, "stale" otherwise. */
        public string $status,
        /** When the indexer last saved this protocol; null if it never did. */
        public ?\DateTimeImmutable $lastCheckedAt,
        public ?int $ageSeconds,
    ) {
    }
}
