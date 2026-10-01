<?php

namespace App\Mcp\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\Reserve;
use App\Mcp\Notice;
use App\Mcp\Output\ReserveHealth;
use App\Mcp\Tool\ReserveHealthTool;
use App\Repository\LendingReserveRepository;
use Mcp\Schema\Result\CallToolResult;
use Symfony\Component\ObjectMapper\ObjectMapperInterface;

/**
 * Answers reserve_health with the same mapping as GET /api/reserves/{address}.
 *
 * @implements ProcessorInterface<ReserveHealthTool, ReserveHealth|CallToolResult>
 */
final readonly class ReserveHealthProcessor implements ProcessorInterface
{
    public function __construct(
        private LendingReserveRepository $reserves,
        private ObjectMapperInterface $objectMapper,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): ReserveHealth|CallToolResult
    {
        \assert($data instanceof ReserveHealthTool);

        $reserve = $this->reserves->find($data->address);
        if (null === $reserve) {
            return Notice::error(\sprintf('No reserve with address %s. Find one with search_reserves.', $data->address));
        }

        return ReserveHealth::fromReserve($this->objectMapper->map($reserve, Reserve::class));
    }
}
