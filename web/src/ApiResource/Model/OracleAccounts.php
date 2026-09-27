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
     * Builds the accounts from the JSON the indexer stored, ignoring values of the wrong type.
     */
    public static function fromArray(mixed $feeds): self
    {
        $feeds = \is_array($feeds) ? $feeds : [];
        $address = static fn (mixed $value): ?string => \is_string($value) ? $value : null;
        $chain = \is_array($feeds['scopeChain'] ?? null) ? array_values(array_filter($feeds['scopeChain'], 'is_int')) : [];

        return new self($address($feeds['scope'] ?? null), $chain, $address($feeds['pyth'] ?? null), $address($feeds['switchboard'] ?? null));
    }
}
