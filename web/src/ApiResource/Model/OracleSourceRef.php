<?php

namespace App\ApiResource\Model;

/** One input of an oracle that chains several sources (Jupiter Lend). */
final readonly class OracleSourceRef
{
    public function __construct(
        /** Source type as named by the oracle program, e.g. "Chainlink", "Pyth", "StakePool". */
        public string $type,
        /** Source account on Solana. */
        public string $account,
    ) {
    }
}
