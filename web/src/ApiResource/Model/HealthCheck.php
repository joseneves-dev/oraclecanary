<?php

namespace App\ApiResource\Model;

final readonly class HealthCheck
{
    public function __construct(
        /** e.g. STALE, NO_FALLBACK, DEPRECATED_PROVIDER, EMPTY_PRICE_ENTRY, SOURCES_DIVERGE. */
        public string $code,
        public Severity $severity,
        public string $message,
    ) {
    }

    /**
     * @param array{code: string, severity: string, message: string} $check
     */
    public static function fromArray(array $check): self
    {
        return new self($check['code'], Severity::from($check['severity']), $check['message']);
    }
}
