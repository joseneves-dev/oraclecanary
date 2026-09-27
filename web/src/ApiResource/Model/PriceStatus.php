<?php

namespace App\ApiResource\Model;

final readonly class PriceStatus
{
    public function __construct(
        /** Age of the oldest price in the reserve's price chain; null when it could not be read. */
        public ?int $ageSeconds,
        /** The protocol's own limit: older prices are rejected. */
        public int $maxAgeSeconds,
        /** True when the price is older than the protocol accepts; null when the age is unknown. */
        public ?bool $isStale,
    ) {
    }

    public static function from(?int $ageSeconds, int $maxAgeSeconds): self
    {
        $isStale = null === $ageSeconds || $maxAgeSeconds <= 0 ? null : $ageSeconds > $maxAgeSeconds;

        return new self($ageSeconds, $maxAgeSeconds, $isStale);
    }
}
