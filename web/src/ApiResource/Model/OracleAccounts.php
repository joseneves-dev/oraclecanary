<?php

namespace App\ApiResource\Model;

/** Oracle accounts a reserve is configured to read; null where a slot is not used. */
final readonly class OracleAccounts
{
    public function __construct(
        /** Scope price account (Kamino's oracle aggregator). */
        public ?string $scopePrices,
        /**
         * Entries of the Scope price account multiplied together to get the price.
         *
         * @var list<int>
         */
        public array $scopeChain,
        public ?string $pyth,
        public ?string $switchboard,
    ) {
    }

    /**
     * @param array{scope?: ?string, scopeChain?: list<int>, pyth?: ?string, switchboard?: ?string} $feeds
     */
    public static function fromArray(array $feeds): self
    {
        return new self($feeds['scope'] ?? null, $feeds['scopeChain'] ?? [], $feeds['pyth'] ?? null, $feeds['switchboard'] ?? null);
    }
}
