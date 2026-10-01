<?php

namespace App\Mcp\State;

use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\Mcp\Notice;
use App\Mcp\Output\Attestation;
use App\Mcp\Tool\AttestationTool;
use App\State\ReserveAttestationProvider;
use Mcp\Schema\Result\CallToolResult;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

/**
 * Answers attestation with the provider behind GET /api/reserves/{address}/attestation.
 *
 * @implements ProcessorInterface<AttestationTool, Attestation|CallToolResult>
 */
final readonly class AttestationProcessor implements ProcessorInterface
{
    public function __construct(
        private ReserveAttestationProvider $attestations,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): Attestation|CallToolResult
    {
        \assert($data instanceof AttestationTool);

        try {
            $attestation = $this->attestations->provide(new Get(), ['address' => $data->address]);
        } catch (ServiceUnavailableHttpException $e) {
            return Notice::error($e->getMessage());
        }
        if (null === $attestation) {
            return Notice::error(\sprintf('No reserve with address %s. Find one with search_reserves.', $data->address));
        }

        return Attestation::fromAttestation($attestation);
    }
}
