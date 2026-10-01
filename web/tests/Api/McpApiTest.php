<?php

namespace App\Tests\Api;

use ApiPlatform\Test\ApiTestCase;
use ApiPlatform\Test\Client;
use Doctrine\DBAL\Connection;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * The MCP endpoint, called as an MCP client does: JSON-RPC over the streamable HTTP transport.
 */
final class McpApiTest extends ApiTestCase
{
    protected static ?bool $alwaysBootKernel = true;

    private const SOL = 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q';
    private const FWDI = '2ZdH2K1J6WHGvfjfjX73VbcSh1cGUeTjFfNkYQXpcEHn';
    private const ALP = 'AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY';
    private const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

    private Client $client;
    private ?string $session = null;
    private int $id = 0;

    protected function setUp(): void
    {
        $connection = self::getContainer()->get(Connection::class);
        $connection->executeStatement('DELETE FROM lending_reserve');
        $connection->executeStatement('DELETE FROM reserve_incident');

        $this->insertReserve(self::SOL, 'SOL', score: 100, supplyUsd: 300_000_000);
        $this->insertReserve(self::FWDI, 'FWDI', score: 35, supplyUsd: 27_000_000, priceAgeSeconds: 159998, checks: [
            ['code' => 'STALE', 'severity' => 'critical', 'message' => 'Price is 159998s old.'],
            ['code' => 'MARKET_CLOSED', 'severity' => 'info', 'message' => 'Market closed.'],
        ]);
        $this->insertReserve(self::ALP, 'ALP', score: 85, supplyUsd: 30_000, checks: [
            ['code' => 'NO_FALLBACK', 'severity' => 'warning', 'message' => 'Price has no fallback.'],
        ], protocol: 'marginfi');

        $this->client = static::createClient();
        // One kernel for the whole conversation, so a test may swap a service for all its calls.
        $this->client->disableReboot();
    }

    public function testInitializesASession(): void
    {
        $response = $this->post(['method' => 'initialize', 'params' => self::initializeParams()]);

        self::assertResponseIsSuccessful();
        self::assertNotEmpty($response->getHeaders()['mcp-session-id'][0] ?? null);
        $result = $response->toArray()['result'];
        self::assertSame('OracleCanary', $result['serverInfo']['name']);
        self::assertArrayHasKey('tools', $result['capabilities']);
        self::assertStringContainsString('not investment advice', $result['instructions']);
    }

    public function testListsReadOnlyToolsThatSayTheyAreNotAdvice(): void
    {
        $tools = $this->rpc('tools/list')['result']['tools'];

        $names = array_column($tools, 'name');
        sort($names);
        self::assertSame(['attestation', 'open_incidents', 'reserve_health', 'search_reserves', 'wallet_positions'], $names);
        foreach ($tools as $tool) {
            self::assertStringContainsString('not investment advice', $tool['description'], $tool['name']);
            self::assertStringContainsString('Prices change every 5 minutes', $tool['description'], $tool['name']);
            self::assertTrue($tool['annotations']['readOnlyHint'], $tool['name']);
            self::assertSame('object', $tool['outputSchema']['type'], $tool['name']);
        }

        $health = $tools[array_search('reserve_health', array_column($tools, 'name'), true)];
        self::assertSame(['address'], $health['inputSchema']['required']);
        self::assertMatchesRegularExpression('/'.$health['inputSchema']['properties']['address']['pattern'].'/', self::FWDI);
    }

    public function testTellsTheHealthOfAReserve(): void
    {
        $result = $this->callTool('reserve_health', ['address' => self::FWDI]);

        self::assertFalse($result['isError']);
        $health = $result['structuredContent'];
        self::assertSame(self::FWDI, $health['address']);
        self::assertSame('FWDI', $health['asset']);
        self::assertSame('kamino', $health['protocol']);
        self::assertSame(['address' => 'market', 'name' => 'Main Market'], $health['market']);
        self::assertSame(35, $health['score']);
        self::assertSame('critical', $health['severity']);
        self::assertSame(['ageSeconds' => 159998, 'maxAgeSeconds' => 120, 'isStale' => true], $health['price']);
        self::assertSame(['PythLazer'], $health['providers']);
        self::assertSame(['STALE', 'MARKET_CLOSED'], array_column($health['checks'], 'code'));
        self::assertSame('Price is 159998s old.', $health['checks'][0]['message']);
        self::assertSame('2026-09-27T16:00:00+00:00', $health['checkedAt']);
        self::assertSame('https://oraclecanary.com/reserves/'.self::FWDI, $health['link']);
        // The text copy is the same JSON, for clients that ignore structured content.
        self::assertSame($health, json_decode($result['content'][0]['text'], true));
    }

    public function testAnUnknownReserveIsAToolErrorTheAgentCanSee(): void
    {
        $result = $this->callTool('reserve_health', ['address' => '11111111111111111111111111111111']);

        self::assertTrue($result['isError']);
        self::assertStringContainsString('search_reserves', $result['content'][0]['text']);
    }

    public function testRejectsAnInvalidAddress(): void
    {
        $response = $this->rpc('tools/call', ['name' => 'reserve_health', 'arguments' => ['address' => "x' OR 1=1"]]);

        self::assertStringContainsString('Not a Solana address.', $response['error']['message']);
    }

    public function testSearchesReservesLargestFirst(): void
    {
        $all = $this->callTool('search_reserves', [])['structuredContent'];
        self::assertSame(3, $all['count']);
        self::assertSame(['SOL', 'FWDI', 'ALP'], array_column($all['reserves'], 'asset'));
        self::assertSame(['STALE', 'MARKET_CLOSED'], $all['reserves'][1]['failedChecks']);
        self::assertSame(['priceAgeSeconds' => 10, 'maxPriceAgeSeconds' => 120], array_intersect_key($all['reserves'][0], ['priceAgeSeconds' => 0, 'maxPriceAgeSeconds' => 0]));

        $critical = $this->callTool('search_reserves', ['severity' => 'critical'])['structuredContent'];
        self::assertSame(['FWDI'], array_column($critical['reserves'], 'asset'));

        $marginfi = $this->callTool('search_reserves', ['protocol' => 'marginfi'])['structuredContent'];
        self::assertSame(['ALP'], array_column($marginfi['reserves'], 'asset'));

        $byAsset = $this->callTool('search_reserves', ['asset' => 'fw', 'limit' => 1])['structuredContent'];
        self::assertSame(['FWDI'], array_column($byAsset['reserves'], 'asset'));

        // A LIKE wildcard in the symbol is matched literally.
        self::assertSame(0, $this->callTool('search_reserves', ['asset' => '%'])['structuredContent']['count']);

        $first = $this->callTool('search_reserves', ['limit' => 1])['structuredContent'];
        self::assertSame(['SOL'], array_column($first['reserves'], 'asset'));

        self::assertStringContainsString('between 1 and 100', $this->rpc('tools/call', ['name' => 'search_reserves', 'arguments' => ['limit' => 0]])['error']['message']);
        self::assertArrayHasKey('error', $this->rpc('tools/call', ['name' => 'search_reserves', 'arguments' => ['severity' => 'bad']]));
    }

    public function testListsOnlyOngoingIncidents(): void
    {
        $this->insertIncident('FWDI', self::FWDI, '2026-09-25 18:00:00', null);
        $this->insertIncident('wstUSR', self::ALP, '2026-09-26 10:00:00', '2026-09-26 12:00:00');

        $incidents = $this->callTool('open_incidents', ['limit' => 10])['structuredContent'];

        self::assertSame(1, $incidents['count']);
        $incident = $incidents['incidents'][0];
        self::assertSame(self::FWDI, $incident['reserve']);
        self::assertSame('2026-09-25T18:00:00+00:00', $incident['startedAt']);
        self::assertGreaterThan(0, $incident['ongoingSeconds']);
        self::assertSame([['code' => 'STALE', 'severity' => 'critical']], $incident['checks']);
        self::assertSame('https://oraclecanary.com/reserves/'.self::FWDI, $incident['link']);
    }

    public function testSignsAnAttestation(): void
    {
        $attestation = $this->callTool('attestation', ['address' => self::FWDI])['structuredContent'];

        self::assertSame(self::FWDI, $attestation['address']);
        self::assertSame('critical', $attestation['severity']);
        self::assertSame('2026-09-27T16:00:00+00:00', $attestation['issuedAt']);
        self::assertSame(54, \strlen(base64_decode($attestation['message'], true)));
        self::assertSame(64, \strlen(base64_decode($attestation['signature'], true)));
        self::assertNotEmpty($attestation['publicKey']);
    }

    public function testJoinsWalletPositionsWithReserveHealth(): void
    {
        $requests = [];
        $this->mockPositionsService(function (string $method, string $url) use (&$requests): MockResponse {
            $requests[] = $url;

            return new MockResponse(json_encode([
                'wallet' => self::WALLET,
                'positions' => [
                    ['protocol' => 'kamino', 'side' => 'deposit', 'reserve' => self::FWDI, 'account' => 'obligation', 'tokens' => 10, 'usd' => 1000, 'weight' => 0.8],
                    ['protocol' => 'kamino-vault', 'side' => 'deposit', 'vault' => 'vault-address', 'share' => 0.01],
                ],
                'notCovered' => ['jupiter-lend'],
                'failed' => [],
                'checkedAt' => '2026-10-01T12:00:00.000Z',
            ]), ['response_headers' => ['Content-Type' => 'application/json']]);
        });

        $result = $this->callTool('wallet_positions', ['address' => self::WALLET])['structuredContent'];

        self::assertSame(['http://positions:3001/api/wallets/'.self::WALLET.'/positions'], $requests);
        self::assertSame(self::WALLET, $result['wallet']);
        self::assertSame(['jupiter-lend'], $result['notCovered']);
        [$deposit, $vault] = $result['positions'];
        self::assertSame('FWDI', $deposit['asset']);
        self::assertEquals(1000, $deposit['usd']);
        self::assertSame('critical', $deposit['severity']);
        self::assertSame(['STALE', 'MARKET_CLOSED'], $deposit['failedChecks']);
        self::assertSame('vault-address', $vault['vault']);
        self::assertEquals(0.01, $vault['vaultShare']);
        self::assertNull($vault['severity']);
    }

    public function testPassesOnWhyAWalletCouldNotBeLookedUp(): void
    {
        $this->mockPositionsService(fn () => new MockResponse(
            json_encode(['error' => 'Busy looking up other wallets. Try again in a few seconds.']),
            ['http_code' => 503, 'response_headers' => ['Content-Type' => 'application/json']],
        ));

        $result = $this->callTool('wallet_positions', ['address' => self::WALLET]);

        self::assertTrue($result['isError']);
        self::assertStringContainsString('Try again in a few seconds', $result['content'][0]['text']);
    }

    private function mockPositionsService(callable $responder): void
    {
        self::getContainer()->set('http_client', new MockHttpClient($responder));
    }

    /**
     * @param array<string, mixed> $arguments
     *
     * @return array<string, mixed> the CallToolResult
     */
    private function callTool(string $name, array $arguments): array
    {
        $response = $this->rpc('tools/call', ['name' => $name, 'arguments' => (object) $arguments]);
        self::assertArrayHasKey('result', $response, json_encode($response));

        return $response['result'];
    }

    /**
     * Sends one JSON-RPC request in an initialized session.
     *
     * @return array<string, mixed>
     */
    private function rpc(string $method, array $params = []): array
    {
        if (null === $this->session) {
            $init = $this->post(['method' => 'initialize', 'params' => self::initializeParams()]);
            $this->session = $init->getHeaders()['mcp-session-id'][0];
            $this->post(['method' => 'notifications/initialized'], notification: true);
        }

        return $this->post(['method' => $method] + ($params ? ['params' => $params] : []))->toArray(false);
    }

    private function post(array $message, bool $notification = false): ResponseInterface
    {
        $headers = ['Accept' => 'application/json, text/event-stream', 'Content-Type' => 'application/json'];
        if (null !== $this->session) {
            $headers['Mcp-Session-Id'] = $this->session;
            $headers['MCP-Protocol-Version'] = '2025-06-18';
        }
        $body = ['jsonrpc' => '2.0'] + ($notification ? [] : ['id' => ++$this->id]) + $message;

        return $this->client->request('POST', '/mcp', ['headers' => $headers, 'body' => json_encode($body)]);
    }

    private static function initializeParams(): array
    {
        return ['protocolVersion' => '2025-06-18', 'capabilities' => new \stdClass(), 'clientInfo' => ['name' => 'phpunit', 'version' => '1.0']];
    }

    private function insertReserve(string $address, string $asset, int $score, float $supplyUsd, int $priceAgeSeconds = 10, array $checks = [], string $protocol = 'kamino'): void
    {
        self::getContainer()->get(Connection::class)->insert('lending_reserve', [
            'address' => $address,
            'protocol' => $protocol,
            'market' => 'market',
            'market_name' => 'Main Market',
            'asset' => $asset,
            'mint' => 'mint-'.$asset,
            'status' => 'active',
            'total_supply_usd' => $supplyUsd,
            'max_age_price_seconds' => 120,
            'price_age_seconds' => $priceAgeSeconds,
            'score' => $score,
            'providers' => json_encode(['PythLazer']),
            'checks' => json_encode($checks),
            'feeds' => json_encode(['scope' => 'prices', 'scopeChain' => [3]]),
            'checked_at' => '2026-09-27 16:00:00',
        ]);
    }

    private function insertIncident(string $asset, string $address, string $startedAt, ?string $endedAt): void
    {
        self::getContainer()->get(Connection::class)->insert('reserve_incident', [
            'address' => $address,
            'protocol' => 'kamino',
            'asset' => $asset,
            'market_name' => 'Main Market',
            'started_at' => $startedAt,
            'start_estimated' => 'false',
            'ended_at' => $endedAt,
            'checks' => json_encode(['STALE:critical']),
            'total_supply_usd' => 27_000_000,
        ]);
    }
}
