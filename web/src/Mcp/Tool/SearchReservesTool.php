<?php

namespace App\Mcp\Tool;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\McpTool;
use App\ApiResource\Reserve;
use App\Mcp\Notice;
use App\Mcp\Output\ReserveSearch;
use App\Mcp\State\SearchReservesProcessor;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Input of the search_reserves MCP tool.
 */
#[ApiResource(
    shortName: 'McpSearchReserves',
    operations: [],
    // Not part of the REST API, so not in its Hydra documentation either.
    hideHydraOperation: true,
    mcp: [
        'search_reserves' => new McpTool(
            title: 'Search lending reserves',
            description: 'Solana lending reserves with their oracle health, largest deposits first. Filter by protocol, '.
                'asset symbol (partial, case-insensitive) and worst severity (ok, info, warning, critical); '.
                'severity=critical lists reserves with a critical check: most mean the protocol cannot use the price; '.
                'PRICE_DEVIATION means it uses an overvalued one, and MARKET_CLOSED marks an expected market-hours pause.'.Notice::DISCLAIMER,
            annotations: Notice::READ_ONLY,
            output: ReserveSearch::class,
            processor: SearchReservesProcessor::class,
            normalizationContext: Notice::CONTEXT,
            validate: true,
        ),
    ],
)]
final class SearchReservesTool
{
    public const SEVERITIES = ['ok', 'info', 'warning', 'critical'];

    /** Lending protocol: kamino, marginfi or jupiter-lend. */
    #[Assert\Choice(choices: Reserve::PROTOCOLS)]
    public ?string $protocol = null;

    /** Part of the asset symbol, case-insensitive, e.g. "SOL". */
    #[Assert\Length(min: 1, max: 64)]
    public ?string $asset = null;

    /** Only reserves whose worst failed check has this severity: ok, info, warning or critical. */
    #[Assert\Choice(choices: self::SEVERITIES)]
    public ?string $severity = null;

    /** How many reserves to return, 1 to 100. */
    #[Assert\Range(min: 1, max: 100)]
    public int $limit = 20;
}
