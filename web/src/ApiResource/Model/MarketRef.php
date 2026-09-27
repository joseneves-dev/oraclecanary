<?php

namespace App\ApiResource\Model;

final readonly class MarketRef
{
    public function __construct(
        /** Lending market address on Solana. */
        public string $address,
        /** Name shown by the protocol's own app; null for unlisted (permissionless) markets. */
        public ?string $name,
    ) {
    }
}
