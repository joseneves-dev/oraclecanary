<?php

namespace App\Mcp\Tool;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\McpTool;
use App\Mcp\Notice;
use App\Mcp\Output\ReserveHealth;
use App\Mcp\State\ReserveHealthProcessor;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Input of the reserve_health MCP tool: a resource with no HTTP operation, only the tool.
 */
#[ApiResource(
    shortName: 'McpReserveHealth',
    operations: [],
    // Not part of the REST API, so not in its Hydra documentation either.
    hideHydraOperation: true,
    mcp: [
        'reserve_health' => new McpTool(
            title: 'Oracle health of a lending reserve',
            description: 'Oracle health of one Solana lending reserve (Kamino reserve, marginfi bank, Jupiter Lend vault): '.
                'its 0-100 score, worst severity, how old its price is against the protocol\'s maximum age, the oracle '.
                'providers its price comes from, and every failed check. Find addresses with search_reserves.'.Notice::DISCLAIMER,
            annotations: Notice::READ_ONLY,
            output: ReserveHealth::class,
            processor: ReserveHealthProcessor::class,
            normalizationContext: Notice::CONTEXT,
            validate: true,
        ),
    ],
)]
final class ReserveHealthTool
{
    /** Reserve / bank / vault address on Solana (Base58). */
    #[Assert\NotBlank]
    #[Assert\Regex(Notice::ADDRESS_PATTERN, message: 'Not a Solana address.', htmlPattern: Notice::ADDRESS_SCHEMA_PATTERN)]
    public string $address;
}
