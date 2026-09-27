<?php

namespace App\ApiResource\Model;

/** Oracle accounts a reserve is configured to read; null or empty where not used. */
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
        /** Oracle account that chains several sources (Jupiter Lend). */
        public ?string $oracle,
        /**
         * Sources of that oracle, each multiplied or divided into the price.
         *
         * @var list<OracleSourceRef>
         */
        public array $sources,
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

        $oracle = \is_array($feeds['oracle'] ?? null) ? $feeds['oracle'] : [];
        $sources = [];
        foreach (\is_array($oracle['sources'] ?? null) ? $oracle['sources'] : [] as $source) {
            if (\is_string($source['type'] ?? null) && \is_string($source['account'] ?? null)) {
                $sources[] = new OracleSourceRef($source['type'], $source['account']);
            }
        }

        return new self(
            $address($feeds['scope'] ?? null),
            $chain,
            $address($feeds['pyth'] ?? null),
            $address($feeds['switchboard'] ?? null),
            $address($oracle['account'] ?? null),
            $sources,
        );
    }
}
