<?php

namespace App\Mcp\Tool;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\McpTool;
use App\Mcp\Notice;
use App\Mcp\Output\WalletPositions;
use App\Mcp\State\WalletPositionsProcessor;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Input of the wallet_positions MCP tool.
 */
#[ApiResource(
    shortName: 'McpWalletPositions',
    operations: [],
    // Not part of the REST API, so not in its Hydra documentation either.
    hideHydraOperation: true,
    mcp: [
        'wallet_positions' => new McpTool(
            title: 'Lending positions of a wallet, with oracle health',
            description: 'A Solana wallet\'s deposits and loans in Kamino and marginfi, and its Kamino vault shares, read '.
                'from the chain, each with the oracle health of its reserve. Read-only: the wallet is only an address '.
                'to look up. Lookups are rate-limited; a busy answer says when to retry.'.Notice::DISCLAIMER,
            annotations: ['openWorldHint' => true] + Notice::READ_ONLY,
            output: WalletPositions::class,
            processor: WalletPositionsProcessor::class,
            normalizationContext: Notice::CONTEXT,
            validate: true,
        ),
    ],
)]
final class WalletPositionsTool
{
    /** Wallet address on Solana (Base58). */
    #[Assert\NotBlank]
    #[Assert\Regex(Notice::ADDRESS_PATTERN, message: 'Not a Solana address.', htmlPattern: Notice::ADDRESS_SCHEMA_PATTERN)]
    public string $address;
}
