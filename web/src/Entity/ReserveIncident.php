<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A period during which a listed reserve had a critical check: the protocol could not use its price.
 *
 * Written by the indexer: opened when the reported state becomes critical, closed when it stops being
 * critical. Reserves already critical when first tracked get an incident whose start is estimated.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_reserve_incident_started', columns: ['started_at', 'id'])]
#[ORM\Index(name: 'idx_reserve_incident_reserve', columns: ['address', 'started_at'])]
#[ORM\Index(name: 'idx_reserve_incident_protocol', columns: ['protocol', 'started_at'])]
class ReserveIncident
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: Types::BIGINT)]
    private ?string $id = null;

    #[ORM\Column(length: 44)]
    private string $address;

    #[ORM\Column(length: 32)]
    private string $protocol;

    #[ORM\Column(length: 64)]
    private string $asset;

    #[ORM\Column(length: 120, nullable: true)]
    private ?string $marketName = null;

    #[ORM\Column]
    private \DateTimeImmutable $startedAt;

    /** True when the reserve was already critical when first tracked; the start comes from the price age. */
    #[ORM\Column]
    private bool $startEstimated = false;

    /** Null while the incident is ongoing. */
    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $endedAt = null;

    /** Critical checks when it started (plus MARKET_CLOSED if the stock market was closed), as "CODE:severity" strings. */
    #[ORM\Column(type: Types::JSON)]
    private array $checks = [];

    /** Largest supply seen during the incident, in USD. */
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

    public function getStartedAt(): \DateTimeImmutable
    {
        return $this->startedAt;
    }

    public function isStartEstimated(): bool
    {
        return $this->startEstimated;
    }

    public function getEndedAt(): ?\DateTimeImmutable
    {
        return $this->endedAt;
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
