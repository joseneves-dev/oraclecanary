<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A Kamino curator vault and how its deposits are spread across reserves.
 *
 * Written by the indexer on every Kamino run and replaced as a whole; read-only for the API, which
 * joins each allocation with the reserve's current health.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_curator_vault_total', columns: ['total_usd', 'address'])]
class CuratorVault
{
    /** Vault state account address on Solana. */
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    private string $address;

    #[ORM\Column(length: 80)]
    private string $name;

    /** Curator recognised in the vault's name, e.g. "Steakhouse". */
    #[ORM\Column(length: 40, nullable: true)]
    private ?string $curator = null;

    #[ORM\Column(length: 44)]
    private string $tokenMint;

    /** Symbol of the deposit token, e.g. "USDC". */
    #[ORM\Column(length: 64, nullable: true)]
    private ?string $token = null;

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalUsd;

    /** Deposits not lent to any reserve, in USD. */
    #[ORM\Column(type: Types::FLOAT)]
    private float $idleUsd;

    /** @var list<array{reserve: string, usd: float}> Allocations with value, largest first. */
    #[ORM\Column(type: Types::JSON)]
    private array $allocations = [];

    #[ORM\Column]
    private \DateTimeImmutable $checkedAt;

    public function getAddress(): string
    {
        return $this->address;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getCurator(): ?string
    {
        return $this->curator;
    }

    public function getTokenMint(): string
    {
        return $this->tokenMint;
    }

    public function getToken(): ?string
    {
        return $this->token;
    }

    public function getTotalUsd(): float
    {
        return $this->totalUsd;
    }

    public function getIdleUsd(): float
    {
        return $this->idleUsd;
    }

    /** @return list<array{reserve: string, usd: float}> */
    public function getAllocations(): array
    {
        return $this->allocations;
    }

    public function getCheckedAt(): \DateTimeImmutable
    {
        return $this->checkedAt;
    }
}
