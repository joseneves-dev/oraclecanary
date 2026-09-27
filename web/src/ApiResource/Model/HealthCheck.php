<?php

namespace App\ApiResource\Model;

final readonly class HealthCheck
{
    public function __construct(
        /** e.g. STALE, NO_FALLBACK, NO_ORACLE, DEPRECATED_PROVIDER, EMPTY_PRICE_ENTRY, SOURCES_DIVERGE. */
        public string $code,
        public Severity $severity,
        public string $message,
    ) {
    }

    /**
     * Builds a check from the JSON the indexer stored. Tolerates a malformed entry so one bad row
     * cannot break a whole listing.
     */
    public static function fromArray(mixed $check): self
    {
        $check = \is_array($check) ? $check : [];

        return new self(
            \is_string($check['code'] ?? null) ? $check['code'] : 'UNKNOWN',
            Severity::fromStored($check['severity'] ?? null),
            \is_string($check['message'] ?? null) ? $check['message'] : '',
        );
    }
}
