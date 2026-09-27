<?php

namespace App\Tests\Controller;

use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;

final class HealthControllerTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const NOW = '2026-09-27 18:00:00';

    private KernelBrowser $client;

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
        self::assertSame(['status' => 'ok', 'lastCheckedAt' => '2026-09-27T17:59:00+00:00', 'ageSeconds' => 60], $data['protocols']['kamino']);
        self::assertResponseHeaderSame('cache-control', 'no-store, private');
    }

    public function testIsDegradedWhenAProtocolIsStale(): void
    {
        $this->insertCheck('kamino', '-60 seconds');
        $this->insertCheck('jupiter-lend', '-10 minutes');
        $this->insertCheck('marginfi', '-60 seconds');

        $data = $this->health();

        self::assertResponseStatusCodeSame(503);
        self::assertSame('degraded', $data['status']);
        self::assertSame('stale', $data['protocols']['jupiter-lend']['status']);
        self::assertSame(600, $data['protocols']['jupiter-lend']['ageSeconds']);
    }

    public function testIsDegradedWhenAProtocolWasNeverChecked(): void
    {
        $this->insertCheck('kamino', '-60 seconds');

        $data = $this->health();

        self::assertResponseStatusCodeSame(503);
        self::assertSame(['status' => 'stale', 'lastCheckedAt' => null, 'ageSeconds' => null], $data['protocols']['marginfi']);
    }

    /**
     * @return array<string, mixed>
     */
    private function health(): array
    {
        $this->client->request('GET', '/health');

        return json_decode((string) $this->client->getResponse()->getContent(), true, flags: \JSON_THROW_ON_ERROR);
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
