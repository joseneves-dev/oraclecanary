<?php

namespace App\Mcp\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\Reserve;
use App\Entity\LendingReserve;
use App\Mcp\Notice;
use App\Mcp\Output\WalletPosition;
use App\Mcp\Output\WalletPositions;
use App\Mcp\Tool\WalletPositionsTool;
use App\Repository\LendingReserveRepository;
use Mcp\Schema\Result\CallToolResult;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\ObjectMapper\ObjectMapperInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Answers wallet_positions from the indexer's positions service (the one behind
 * GET /api/wallets/{address}/positions), joining each position with its reserve's health.
 *
 * @implements ProcessorInterface<WalletPositionsTool, WalletPositions|CallToolResult>
 */
final readonly class WalletPositionsProcessor implements ProcessorInterface
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private RequestStack $requestStack,
        private LendingReserveRepository $reserves,
        private ObjectMapperInterface $objectMapper,
        /** host:port, as the Caddyfile proxies to. */
        #[Autowire(env: 'POSITIONS_UPSTREAM')]
        private string $upstream,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): WalletPositions|CallToolResult
    {
        \assert($data instanceof WalletPositionsTool);

        try {
            $response = $this->httpClient->request('GET', \sprintf('http://%s/api/wallets/%s/positions', $this->upstream, $data->address), [
                'headers' => ['Accept' => 'application/json'] + $this->visitorHeaders(),
                // The service gives up on a lookup after 15 s.
                'timeout' => 30,
            ]);
            $status = $response->getStatusCode();
            $body = $response->toArray(false);
        } catch (ExceptionInterface) {
            return Notice::error('The wallet positions service is not reachable right now. Try again later.');
        }
        if (200 !== $status) {
            $reason = \is_string($body['error'] ?? null) ? $body['error'] : \sprintf('HTTP %d.', $status);

            return Notice::error('Could not look up this wallet: '.$reason);
        }

        return $this->withHealth($body);
    }

    /**
     * The service limits lookups per visitor by these headers; pass the agent's own on so one busy
     * agent does not use up everyone's share.
     *
     * @return array<string, string>
     */
    private function visitorHeaders(): array
    {
        $request = $this->requestStack->getMainRequest();
        if (null === $request) {
            return [];
        }
        $cloudflare = $request->headers->get('CF-Connecting-IP');
        if (null !== $cloudflare) {
            return ['CF-Connecting-IP' => $cloudflare];
        }
        $ip = $request->getClientIp();

        return null !== $ip ? ['X-Forwarded-For' => $ip] : [];
    }

    /**
     * @param array<string, mixed> $body
     */
    private function withHealth(array $body): WalletPositions
    {
        $rows = array_values(array_filter(\is_array($body['positions'] ?? null) ? $body['positions'] : [], 'is_array'));
        $addresses = array_values(array_unique(array_filter(array_column($rows, 'reserve'), 'is_string')));
        $health = [];
        foreach ($addresses ? $this->reserves->findBy(['address' => $addresses]) : [] as $entity) {
            /** @var LendingReserve $entity */
            $health[$entity->getAddress()] = $this->objectMapper->map($entity, Reserve::class);
        }

        $positions = [];
        foreach ($rows as $row) {
            $reserveAddress = \is_string($row['reserve'] ?? null) ? $row['reserve'] : null;
            $reserve = null !== $reserveAddress ? ($health[$reserveAddress] ?? null) : null;
            $unpriced = true === ($row['unpriced'] ?? false);
            $positions[] = new WalletPosition(
                \is_string($row['protocol'] ?? null) ? $row['protocol'] : 'unknown',
                \is_string($row['side'] ?? null) ? $row['side'] : 'deposit',
                $reserveAddress,
                \is_string($row['vault'] ?? null) ? $row['vault'] : null,
                $reserve?->asset,
                !$unpriced && is_numeric($row['tokens'] ?? null) ? (float) $row['tokens'] : null,
                !$unpriced && is_numeric($row['usd'] ?? null) ? (float) $row['usd'] : null,
                is_numeric($row['share'] ?? null) ? (float) $row['share'] : null,
                $reserve?->score,
                $reserve?->severity,
                $reserve ? array_map(static fn ($check) => $check->code, $reserve->checks) : [],
                null !== $reserveAddress ? Notice::reserveLink($reserveAddress) : null,
            );
        }

        $strings = static fn (mixed $list): array => array_values(array_filter(\is_array($list) ? $list : [], 'is_string'));

        return new WalletPositions(
            \is_string($body['wallet'] ?? null) ? $body['wallet'] : '',
            $positions,
            $strings($body['notCovered'] ?? null),
            $strings($body['failed'] ?? null),
            \is_string($body['checkedAt'] ?? null) ? $body['checkedAt'] : '',
        );
    }
}
