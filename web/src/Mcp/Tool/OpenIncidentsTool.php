<?php

namespace App\Mcp\Tool;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\McpTool;
use App\Mcp\Notice;
use App\Mcp\Output\OpenIncidents;
use App\Mcp\State\OpenIncidentsProcessor;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Input of the open_incidents MCP tool.
 */
#[ApiResource(
    shortName: 'McpOpenIncidents',
    operations: [],
    // Not part of the REST API, so not in its Hydra documentation either.
    hideHydraOperation: true,
    mcp: [
        'open_incidents' => new McpTool(
            title: 'Ongoing oracle incidents',
            description: 'Ongoing incidents, most recent start first: reserves in listed markets with a critical check: '.
                'most mean the protocol cannot use the price; PRICE_DEVIATION means it uses an overvalued one, and '.
                'MARKET_CLOSED marks an expected market-hours pause. Each gives when it started, how long it has lasted, '.
                'the critical checks and the largest deposits exposed, in USD.'.Notice::DISCLAIMER,
            annotations: Notice::READ_ONLY,
            output: OpenIncidents::class,
            processor: OpenIncidentsProcessor::class,
            normalizationContext: Notice::CONTEXT,
            validate: true,
        ),
    ],
)]
final class OpenIncidentsTool
{
    /** How many incidents to return, 1 to 100. */
    #[Assert\Range(min: 1, max: 100)]
    public int $limit = 20;
}
