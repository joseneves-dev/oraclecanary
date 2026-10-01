<?php

namespace App\Mcp\Output;

/**
 * Result of the wallet_positions tool.
 */
final readonly class WalletPositions
{
    public function __construct(
        public string $wallet,
        /** @var list<WalletPosition> */
        public array $positions,
        /** @var list<string> Protocols whose positions are not read yet, e.g. "jupiter-lend". */
        public array $notCovered,
        /** @var list<string> Sources that could not be read this time; the other positions are still listed. */
        public array $failed,
        /** When the chain was read (UTC). */
        public string $checkedAt,
    ) {
    }
}
