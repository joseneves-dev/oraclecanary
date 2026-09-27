<?php

namespace App\Controller;

use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Liveness and freshness probe for uptime monitors and deploy checks.
 *
 * Healthy means the database answers and the indexer refreshed every protocol recently; anything
 * else returns 503 so a monitor can alert on it.
 */
final class HealthController extends AbstractController
{
    /** Protocols the indexer is expected to refresh on every run. */
    private const PROTOCOLS = ['kamino', 'jupiter-lend', 'marginfi'];

    public function __construct(
        private readonly Connection $connection,
        private readonly ClockInterface $clock,
        #[Autowire(env: 'int:HEALTH_MAX_DATA_AGE_SECONDS')]
        private readonly int $maxDataAgeSeconds,
    ) {
    }

    #[Route('/health', name: 'health', methods: ['GET'])]
    public function __invoke(): JsonResponse
    {
        try {
            $rows = $this->connection->fetchAllKeyValue('SELECT protocol, MAX(checked_at) FROM lending_reserve GROUP BY protocol');
        } catch (\Throwable) {
            return $this->respond(['status' => 'error', 'database' => 'unreachable'], Response::HTTP_SERVICE_UNAVAILABLE);
        }

        $now = $this->clock->now()->getTimestamp();
        $protocols = [];
        $healthy = true;
        foreach (self::PROTOCOLS as $protocol) {
            // The indexer writes checked_at in UTC without a time zone.
            $checkedAt = isset($rows[$protocol]) ? new \DateTimeImmutable($rows[$protocol], new \DateTimeZone('UTC')) : null;
            $age = $checkedAt ? $now - $checkedAt->getTimestamp() : null;
            $fresh = null !== $age && $age <= $this->maxDataAgeSeconds;
            $healthy = $healthy && $fresh;
            $protocols[$protocol] = [
                'status' => $fresh ? 'ok' : 'stale',
                'lastCheckedAt' => $checkedAt?->format(\DATE_ATOM),
                'ageSeconds' => $age,
            ];
        }

        return $this->respond(
            ['status' => $healthy ? 'ok' : 'degraded', 'database' => 'ok', 'maxDataAgeSeconds' => $this->maxDataAgeSeconds, 'protocols' => $protocols],
            $healthy ? Response::HTTP_OK : Response::HTTP_SERVICE_UNAVAILABLE,
        );
    }

    private function respond(array $body, int $status): JsonResponse
    {
        $response = new JsonResponse($body, $status);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}
