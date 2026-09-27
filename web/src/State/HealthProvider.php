<?php

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\Health;
use App\ApiResource\Model\ProtocolFreshness;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Response;

/**
 * Builds the Health resource and answers 503 when it is degraded, so monitors can alert on the status
 * code alone.
 *
 * @implements ProviderInterface<Health>
 */
final readonly class HealthProvider implements ProviderInterface
{
    /** Protocols the indexer is expected to refresh on every run. */
    private const PROTOCOLS = ['kamino', 'jupiter-lend', 'marginfi'];

    public function __construct(
        private Connection $connection,
        private ClockInterface $clock,
        #[Autowire(env: 'int:HEALTH_MAX_DATA_AGE_SECONDS')]
        private int $maxDataAgeSeconds,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): Health
    {
        $health = $this->check();

        if (Health::STATUS_OK !== $health->status) {
            // API Platform takes the response status from this request attribute.
            $context['request']?->attributes->set('_api_response_status', Response::HTTP_SERVICE_UNAVAILABLE);
        }

        return $health;
    }

    private function check(): Health
    {
        try {
            $lastChecks = $this->connection->fetchAllKeyValue('SELECT protocol, MAX(checked_at) FROM lending_reserve GROUP BY protocol');
        } catch (\Throwable) {
            return new Health(Health::STATUS_DEGRADED, 'unreachable', $this->maxDataAgeSeconds, []);
        }

        $now = $this->clock->now()->getTimestamp();
        $protocols = [];
        foreach (self::PROTOCOLS as $protocol) {
            // The indexer writes checked_at in UTC without a time zone.
            $checkedAt = isset($lastChecks[$protocol]) ? new \DateTimeImmutable($lastChecks[$protocol], new \DateTimeZone('UTC')) : null;
            $age = $checkedAt ? $now - $checkedAt->getTimestamp() : null;
            $fresh = null !== $age && $age <= $this->maxDataAgeSeconds;
            $protocols[] = new ProtocolFreshness($protocol, $fresh ? 'ok' : 'stale', $checkedAt, $age);
        }

        $healthy = array_all($protocols, static fn (ProtocolFreshness $p) => 'ok' === $p->status);

        return new Health($healthy ? Health::STATUS_OK : Health::STATUS_DEGRADED, 'ok', $this->maxDataAgeSeconds, $protocols);
    }
}
