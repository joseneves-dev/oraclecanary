<?php

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use App\ApiResource\Model\Severity;
use App\ApiResource\Model\VaultAllocation;
use App\State\VaultProvider;

/**
 * A Kamino curator vault and how much of it sits in reserves whose oracle is unhealthy.
 */
#[ApiResource(
    shortName: 'Vault',
    description: 'A Kamino curator vault, its allocations across reserves, and the share of it in reserves with oracle problems.',
    operations: [
        new GetCollection(
            uriTemplate: '/vaults',
            description: 'Kamino curator vaults, largest first.',
            paginationEnabled: false,
            provider: VaultProvider::class,
        ),
        new Get(
            uriTemplate: '/vaults/{address}',
            description: 'One vault with each allocation and the health of its reserve.',
            provider: VaultProvider::class,
        ),
    ],
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 60, 'stale_while_revalidate' => 60],
    normalizationContext: ['skip_null_values' => false],
)]
final class Vault
{
    public function __construct(
        /** Vault state account address on Solana. */
        #[ApiProperty(identifier: true)]
        public string $address,
        /** Name shown by Kamino, e.g. "Steakhouse USDC". */
        public string $name,
        /** Curator recognised in the name, e.g. "Steakhouse", or null. */
        public ?string $curator,
        /** Deposit token symbol, e.g. "USDC". */
        public ?string $token,
        /** Deposits in USD: allocations plus idle funds. */
        public float $totalUsd,
        /** Deposits not lent to any reserve, in USD. */
        public float $idleUsd,
        /**
         * USD lent into a reserve that has a critical check, or into a market where another asset
         * (the collateral borrowers post) has one: while its price is unusable or wrong, bad loans
         * cannot be liquidated and losses fall on lenders such as this vault.
         */
        public float $atRiskUsd,
        /** USD in reserves whose own worst check is a warning (e.g. no fallback oracle). */
        public float $warningUsd,
        /** Worst severity among the reserves the vault lends to and their markets' collateral. */
        public Severity $worstSeverity,
        /** @var list<VaultAllocation> Largest first. */
        public array $allocations,
        public \DateTimeImmutable $checkedAt,
    ) {
    }
}
