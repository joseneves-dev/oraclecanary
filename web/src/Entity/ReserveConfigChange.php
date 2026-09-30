<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A change to how a listed reserve is priced, seen from one indexer run to the next: newly listed, a
 * different price source, or a different limit on the price's age.
 *
 * Written by the indexer in the same transaction as the reserve's health; read-only for the API.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_reserve_config_change_occurred', columns: ['occurred_at', 'id'])]
#[ORM\Index(name: 'idx_reserve_config_change_address', columns: ['address'])]
class ReserveConfigChange
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: Types::BIGINT)]
    private string $id;

    /** Reserve / bank / vault address on Solana. */
    #[ORM\Column(length: 44)]
    private string $address;

    #[ORM\Column(length: 32)]
    private string $protocol;

    #[ORM\Column(length: 64)]
    private string $asset;

    #[ORM\Column(length: 120, nullable: true)]
    private ?string $marketName = null;

    #[ORM\Column]
    private \DateTimeImmutable $occurredAt;

    /** "listed", "price_source" or "max_age". */
    #[ORM\Column(length: 20)]
    private string $kind;

    /** The change in one sentence. */
    #[ORM\Column(type: Types::TEXT)]
    private string $detail;

    /** The changed fields before (null for a new listing); "before" is an SQL keyword, hence the name. */
    #[ORM\Column(name: 'before_value', type: Types::JSON, nullable: true)]
    private mixed $before = null;

    #[ORM\Column(name: 'after_value', type: Types::JSON, nullable: true)]
    private mixed $after = null;

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalSupplyUsd;

    public function getId(): string
    {
        return $this->id;
    }

    public function getAddress(): string
    {
        return $this->address;
    }

    public function getProtocol(): string
    {
        return $this->protocol;
    }

    public function getAsset(): string
    {
        return $this->asset;
    }

    public function getMarketName(): ?string
    {
        return $this->marketName;
    }

    public function getOccurredAt(): \DateTimeImmutable
    {
        return $this->occurredAt;
    }

    public function getKind(): string
    {
        return $this->kind;
    }

    public function getDetail(): string
    {
        return $this->detail;
    }

    public function getBefore(): mixed
    {
        return $this->before;
    }

    public function getAfter(): mixed
    {
        return $this->after;
    }

    public function getTotalSupplyUsd(): float
    {
        return $this->totalSupplyUsd;
    }
}
