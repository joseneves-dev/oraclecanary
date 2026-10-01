<?php

namespace App\Mcp;

use Mcp\Schema\Content\TextContent;
use Mcp\Schema\Result\CallToolResult;

/**
 * What every MCP tool says about its results, and the links it gives back.
 */
final class Notice
{
    /** Appended to every tool description. */
    public const DISCLAIMER = ' Results are informational, not investment advice. Data is refreshed every 5 minutes, so re-check before acting on a result.';

    public const SITE_URL = 'https://oraclecanary.com';

    /** Base58 Solana address. `D` stops `$` from also matching before a trailing newline. */
    public const ADDRESS_PATTERN = '/^[1-9A-HJ-NP-Za-km-z]{32,44}$/D';
    /** The same, for the tools' JSON schema, which anchors it itself. */
    public const ADDRESS_SCHEMA_PATTERN = '[1-9A-HJ-NP-Za-km-z]{32,44}';

    /**
     * Every field is always present (null when unknown) so agents can rely on the shape, and the
     * text copy of the result keeps links and symbols readable.
     */
    public const CONTEXT = ['skip_null_values' => false, 'json_encode_options' => \JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE];

    /** Read-only, repeatable, and answered from OracleCanary's own data. */
    public const READ_ONLY = ['readOnlyHint' => true, 'destructiveHint' => false, 'idempotentHint' => true, 'openWorldHint' => false];

    public static function reserveLink(string $address): string
    {
        return self::SITE_URL.'/reserves/'.rawurlencode($address);
    }

    /**
     * A failure the agent should see and can act on (unknown address, service down), as a tool
     * result rather than a protocol error, as the MCP specification asks.
     */
    public static function error(string $message): CallToolResult
    {
        return CallToolResult::error([new TextContent($message)]);
    }

    /**
     * The indexer stores times in UTC without a zone; read them as UTC whatever PHP's default zone.
     */
    public static function utc(\DateTimeImmutable $time): \DateTimeImmutable
    {
        return new \DateTimeImmutable($time->format('Y-m-d H:i:s'), new \DateTimeZone('UTC'));
    }
}
