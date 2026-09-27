<?php

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\OpenApi\Model\Operation;
use ApiPlatform\OpenApi\Model\Response;
use App\ApiResource\Model\ProtocolFreshness;
use App\State\HealthProvider;

/**
 * Liveness and freshness of the service, for uptime monitors and deploy checks.
 */
#[ApiResource(
    shortName: 'Health',
    operations: [
        new Get(
            uriTemplate: '/health',
            description: 'Whether the database answers and every protocol was refreshed recently.',
            provider: HealthProvider::class,
            // No error documents: without this API Platform documents a 404 this route never returns.
            errors: [],
            openapi: new Operation(
                summary: 'Service health',
                description: 'Returns 200 when the database answers and the indexer refreshed every protocol within maxDataAgeSeconds, 503 otherwise. Point uptime monitors here.',
                responses: [
                    '200' => new Response(description: 'Healthy'),
                    '503' => new Response(description: 'Degraded: data is stale, or the database is unreachable'),
                ],
            ),
        ),
    ],
    cacheHeaders: ['public' => false, 'max_age' => 0, 'shared_max_age' => 0],
    normalizationContext: ['skip_null_values' => false],
)]
final class Health
{
    public const STATUS_OK = 'ok';
    public const STATUS_DEGRADED = 'degraded';

    public function __construct(
        /** "ok" or "degraded". */
        public string $status,
        /** "ok" or "unreachable". */
        public string $database,
        /** Protocols not refreshed within this many seconds make the service degraded. */
        public int $maxDataAgeSeconds,
        /** @var list<ProtocolFreshness> */
        public array $protocols,
    ) {
    }
}
