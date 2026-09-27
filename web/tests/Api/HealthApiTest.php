<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use ApiPlatform\Test\Client;
use Doctrine\DBAL\Connection;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;

final class HealthApiTest extends ApiTestCase
{
    use ClockSensitiveTrait;

    protected static ?bool $alwaysBootKernel = true;

    private const NOW = '2026-09-27 18:00:00';

    private Client $client;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        static::mockTime(new \DateTimeImmutable(self::NOW, new \DateTimeZone('UTC')));
        self::getContainer()->get(Connection::class)->executeStatement('DELETE FROM lending_reserve');
    }

    public function testIsHealthyWhenEveryProtocolWasRefreshedRecently(): void
    {
        $this->insertCheck('kamino', '-60 seconds');
        $this->insertCheck('jupiter-lend', '-61 seconds');
        $this->insertCheck('marginfi', '-62 seconds');

        $data = $this->health();

        self::assertResponseStatusCodeSame(200);
        self::assertSame('ok', $data['status']);
        self::assertSame(
            ['protocol' => 'kamino', 'status' => 'ok', 'lastCheckedAt' => '2026-09-27T17:59:00+00:00', 'ageSeconds' => 60],
            $data['protocols'][0],
        );
    }

    public function testAnswers503WhenAProtocolIsStale(): void
    {
        $this->insertCheck('kamino', '-60 seconds');
        $this->insertCheck('jupiter-lend', '-10 minutes');
        $this->insertCheck('marginfi', '-60 seconds');

        $data = $this->health();

        self::assertResponseStatusCodeSame(503);
        self::assertSame('degraded', $data['status']);
        self::assertSame(['protocol' => 'jupiter-lend', 'status' => 'stale', 'lastCheckedAt' => '2026-09-27T17:50:00+00:00', 'ageSeconds' => 600], $data['protocols'][1]);
    }

    public function testAnswers503WhenAProtocolWasNeverChecked(): void
    {
        $this->insertCheck('kamino', '-60 seconds');

        $data = $this->health();

        self::assertResponseStatusCodeSame(503);
        self::assertSame(['protocol' => 'marginfi', 'status' => 'stale', 'lastCheckedAt' => null, 'ageSeconds' => null], $data['protocols'][2]);
    }

    public function testIsNotCached(): void
    {
        $this->health();

        self::assertStringContainsString('private', (string) $this->client->getResponse()->getHeaders(false)['cache-control'][0]);
    }

    public function testIsDocumentedWithBothStatusCodes(): void
    {
        $docs = $this->client->request('GET', '/api/docs', ['headers' => ['Accept' => 'application/vnd.openapi+json']])->toArray();

        $responses = $docs['paths']['/api/health']['get']['responses'];
        self::assertSame([200, 503], array_keys($responses));
        self::assertStringContainsString('Health', json_encode($responses[200]['content'] ?? []), 'the 200 response documents the Health schema');
    }

    /**
     * @return array<string, mixed>
     */
    private function health(): array
    {
        return $this->client->request('GET', '/api/health', ['headers' => ['Accept' => 'application/json']])->toArray(false);
    }

    private function insertCheck(string $protocol, string $ago): void
    {
        $checkedAt = (new \DateTimeImmutable(self::NOW, new \DateTimeZone('UTC')))->modify($ago);
        self::getContainer()->get(Connection::class)->insert('lending_reserve', [
            'address' => "reserve-$protocol",
            'protocol' => $protocol,
            'market' => 'market',
            'market_name' => 'Main',
            'asset' => 'SOL',
            'mint' => 'mint',
            'status' => 'active',
            'total_supply_usd' => 1,
            'max_age_price_seconds' => 60,
            'price_age_seconds' => 1,
            'score' => 100,
            'providers' => '[]',
            'checks' => '[]',
            'feeds' => '{}',
            'checked_at' => $checkedAt->format('Y-m-d H:i:s'),
        ]);
    }
}
