<?php

namespace App\Mcp\Output;

use App\ApiResource\Model\Severity;

/**
 * One position in a wallet_positions result, joined with its reserve's oracle health.
 */
final readonly class WalletPosition
{
    public function __construct(
        /** kamino, marginfi or kamino-vault. */
        public string $protocol,
        /** deposit or borrow. */
        public string $side,
        /** Reserve or bank address; null for a vault share. */
        public ?string $reserve,
        /** Kamino vault address; null for a reserve position. */
        public ?string $vault,
        /** Asset symbol of the reserve; null when the reserve is not tracked or for a vault. */
        public ?string $asset,
        /** Token amount; null for a vault share or when unknown. */
        public ?float $tokens,
        /** Value in USD at the protocol's stored price; null for a vault share or when unknown. */
        public ?float $usd,
        /** Share of the vault, 0 to 1; null for a reserve position. */
        public ?float $vaultShare,
        /** Reserve health score, 0 to 100; null when not known. */
        public ?int $score,
        public ?Severity $severity,
        /** @var list<string> Codes of the reserve's failed checks. */
        public array $failedChecks,
        /** Page on oraclecanary.com; null for a vault share. */
        public ?string $link,
    ) {
    }
}
