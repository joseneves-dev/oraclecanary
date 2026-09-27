<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use Doctrine\DBAL\Connection;

final class HistoryApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const JSON = ['headers' => ['Accept' => 'application/json']];

    private Connection $connection;

    protected function setUp(): void
    {
        $this->connection = self::getContainer()->get(Connection::class);
        $this->connection->executeStatement('DELETE FROM reserve_health_event');
        $this->connection->executeStatement('DELETE FROM reserve_health_hourly');
    }

    public function testDescribesAChangeFromItsStoredChecks(): void
    {
        $this->insertEvent('reserve-fwdi', 'FWDI', '2026-09-26 20:00:00', ['NO_FALLBACK:warning'], ['NO_FALLBACK:warning', 'STALE:critical'], 85, 35);

        $events = static::createClient()->request('GET', '/api/events', self::JSON)->toArray();

        self::assertResponseIsSuccessful();
        self::assertSame([
            'reserve' => 'reserve-fwdi',
            'protocol' => 'kamino',
            'asset' => 'FWDI',
            'marketName' => 'Main Market',
            'occurredAt' => '2026-09-26T20:00:00+00:00',
            'direction' => 'degraded',
            'severity' => 'critical',
            'previousScore' => 85,
            'score' => 35,
            'started' => [['code' => 'STALE', 'severity' => 'critical']],
            'resolved' => [],
            'checks' => [['code' => 'NO_FALLBACK', 'severity' => 'warning'], ['code' => 'STALE', 'severity' => 'critical']],
            'totalSupplyUsd' => 27_000_000.0,
        ], array_diff_key($events[0], ['id' => true]));
    }

    public function testListsChangesNewestFirstAndFiltersByTime(): void
    {
        $this->insertEvent('reserve-fwdi', 'FWDI', '2026-09-26 20:00:00', [], ['STALE:critical'], 100, 50);
        $this->insertEvent('reserve-fwdi', 'FWDI', '2026-09-28 13:30:00', ['STALE:critical'], [], 50, 100);
        $this->insertEvent('reserve-sol', 'SOL', '2026-09-27 10:00:00', ['NO_FALLBACK:warning'], ['DEPRECATED_PROVIDER:warning'], 85, 85);
        $client = static::createClient();

        $all = $client->request('GET', '/api/events', self::JSON)->toArray();
        self::assertSame(['recovered', 'changed', 'degraded'], array_column($all, 'direction'));
        self::assertSame('ok', $all[0]['severity']);

        $since = $client->request('GET', '/api/events?occurredAt[after]=2026-09-27T00:00:00Z&reserve=reserve-fwdi', self::JSON)->toArray();
        self::assertSame(['2026-09-28T13:30:00+00:00'], array_column($since, 'occurredAt'));
    }

    public function testTellsWhetherAChangeIsForTheWorse(): void
    {
        $this->insertEvent('reserve-a', 'A', '2026-09-27 10:00:00', ['STALE:critical'], ['NO_FALLBACK:warning', 'STALE:critical'], 50, 35);
        $this->insertEvent('reserve-b', 'B', '2026-09-27 11:00:00', ['STALE:warning'], ['STALE:critical'], 85, 50);

        $events = static::createClient()->request('GET', '/api/events', self::JSON)->toArray();

        // Same worst severity, lower score.
        self::assertSame('degraded', $events[1]['direction']);
        // A check whose severity changed has started again, and is not resolved.
        self::assertSame([['code' => 'STALE', 'severity' => 'critical']], $events[0]['started']);
        self::assertSame([], $events[0]['resolved']);
    }

    public function testPollsNewEventsById(): void
    {
        $this->insertEvent('reserve-a', 'A', '2026-09-27 10:00:00', [], ['STALE:critical'], 100, 50);
        $this->insertEvent('reserve-b', 'B', '2026-09-27 09:00:00', [], ['STALE:critical'], 100, 50);
        $client = static::createClient();

        $all = $client->request('GET', '/api/events', self::JSON)->toArray();
        $newer = $client->request('GET', '/api/events?id[gt]='.min(array_column($all, 'id')), self::JSON)->toArray();

        // Recorded later although it started earlier.
        self::assertSame(['B'], array_column($newer, 'asset'));
        $client->request('GET', '/api/events/'.$newer[0]['id'], self::JSON);
        self::assertResponseIsSuccessful();
    }

    /**
     * @return iterable<string, array{string, int}>
     */
    public static function invalidRequests(): iterable
    {
        yield 'not a date' => ['/api/events?occurredAt[after]=yesterday', 422];
        yield 'not UTC' => ['/api/events?occurredAt[after]=2026-09-27T02:00:00%2B02:00', 422];
        yield 'array' => ['/api/events?reserve[]=x', 422];
        yield 'unknown protocol' => ['/api/events?protocol=aave', 422];
        yield 'not a boolean' => ['/api/events?listed=maybe', 422];
        yield 'bad cursor' => ['/api/events?id[gt]=abc', 422];
        yield 'bad id' => ['/api/events/abc', 404];
        yield 'huge id' => ['/api/events/99999999999999999999', 404];
        yield 'missing id' => ['/api/events/1', 404];
        yield 'history date' => ['/api/reserves/x/history?hour[before]=soon', 422];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidRequests')]
    public function testRejectsInvalidRequests(string $url, int $status): void
    {
        static::createClient()->request('GET', $url, self::JSON);

        self::assertResponseStatusCodeSame($status);
    }

    public function testReturnsTheHourlyHistoryOfOneReserve(): void
    {
        $this->insertSample('reserve-fwdi', '2026-09-27 10:00:00', 100, []);
        $this->insertSample('reserve-fwdi', '2026-09-27 11:00:00', 35, ['STALE:critical']);
        $this->insertSample('reserve-sol', '2026-09-27 11:00:00', 100, []);
        $client = static::createClient();

        $history = $client->request('GET', '/api/reserves/reserve-fwdi/history', self::JSON)->toArray();

        self::assertResponseIsSuccessful();
        self::assertSame(['2026-09-27T11:00:00+00:00', '2026-09-27T10:00:00+00:00'], array_column($history, 'hour'));
        self::assertSame(['critical', 'ok'], array_column($history, 'severity'));
        self::assertSame([['code' => 'STALE', 'severity' => 'critical']], $history[0]['checks']);

        self::assertSame([], $client->request('GET', '/api/reserves/unknown/history', self::JSON)->toArray());
    }

    private function insertEvent(string $address, string $asset, string $at, array $previousChecks, array $checks, int $previousScore, int $score): void
    {
        $this->connection->insert('reserve_health_event', [
            'address' => $address,
            'protocol' => 'kamino',
            'asset' => $asset,
            'market_name' => 'Main Market',
            'occurred_at' => $at,
            'previous_score' => $previousScore,
            'score' => $score,
            'previous_checks' => json_encode($previousChecks),
            'checks' => json_encode($checks),
            'total_supply_usd' => 27_000_000,
        ]);
    }

    private function insertSample(string $address, string $hour, int $score, array $checks): void
    {
        $this->connection->insert('reserve_health_hourly', [
            'address' => $address,
            'hour' => $hour,
            'protocol' => 'kamino',
            'score' => $score,
            'price_age_seconds' => 10,
            'total_supply_usd' => 27_000_000,
            'checks' => json_encode($checks),
        ]);
    }
}
