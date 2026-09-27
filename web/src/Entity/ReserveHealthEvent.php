<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A change in a reserve's health: the set of lasting failed checks changed.
 *
 * Written by the indexer for listed markets, once a change has lasted a few minutes; the basis for
 * alerts and the incident timeline.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_reserve_health_event_occurred', columns: ['occurred_at', 'id'])]
#[ORM\Index(name: 'idx_reserve_health_event_protocol', columns: ['protocol', 'occurred_at', 'id'])]
#[ORM\Index(name: 'idx_reserve_health_event_reserve', columns: ['address', 'occurred_at', 'id'])]
class ReserveHealthEvent
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: Types::BIGINT)]
    private ?string $id = null;

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

    #[ORM\Column(type: Types::SMALLINT)]
    private int $previousScore;

    #[ORM\Column(type: Types::SMALLINT)]
    private int $score;

    /** Lasting failed checks before the change, as "CODE:severity" strings (near-stale is left out). */
    #[ORM\Column(type: Types::JSON)]
    private array $previousChecks = [];

    /** Lasting failed checks after the change, as "CODE:severity" strings. */
    #[ORM\Column(type: Types::JSON)]
    private array $checks = [];

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalSupplyUsd;

    public function getId(): ?string
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

    public function getPreviousScore(): int
    {
        return $this->previousScore;
    }

    public function getScore(): int
    {
        return $this->score;
    }

    public function getPreviousChecks(): array
    {
        return $this->previousChecks;
    }

    public function getChecks(): array
    {
        return $this->checks;
    }

    public function getTotalSupplyUsd(): float
    {
        return $this->totalSupplyUsd;
    }
}
