<?php

namespace App\Mcp\Tool;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\McpTool;
use App\Mcp\Notice;
use App\Mcp\Output\Attestation;
use App\Mcp\State\AttestationProcessor;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Input of the attestation MCP tool.
 */
#[ApiResource(
    shortName: 'McpAttestation',
    operations: [],
    // Not part of the REST API, so not in its Hydra documentation either.
    hideHydraOperation: true,
    mcp: [
        'attestation' => new McpTool(
            title: 'Signed health attestation of a reserve',
            description: 'The reserve\'s latest health, signed with Ed25519 for the oracle_guard Solana program: put '.
                '`message`, `signature` and `publicKey` in an Ed25519 program instruction next to a call to oracle_guard, '.
                'which refuses to go on if the reserve is unhealthy. `issuedAt` is when the health was measured.'.Notice::DISCLAIMER,
            annotations: Notice::READ_ONLY,
            output: Attestation::class,
            processor: AttestationProcessor::class,
            normalizationContext: Notice::CONTEXT,
            validate: true,
        ),
    ],
)]
final class AttestationTool
{
    /** Reserve / bank / vault address on Solana (Base58). */
    #[Assert\NotBlank]
    #[Assert\Regex(Notice::ADDRESS_PATTERN, message: 'Not a Solana address.', htmlPattern: Notice::ADDRESS_SCHEMA_PATTERN)]
    public string $address;
}
