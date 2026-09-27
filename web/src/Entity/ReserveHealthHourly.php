<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * One sample per hour of a listed reserve's health, for history charts.
 *
 * Written by the indexer from the first run of each hour.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_reserve_health_hourly_protocol', columns: ['protocol', 'hour'])]
class ReserveHealthHourly
{
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    private string $address;

    /** Start of the hour, in UTC. */
    #[ORM\Id]
    #[ORM\Column]
    private \DateTimeImmutable $hour;

    #[ORM\Column(length: 32)]
    private string $protocol;

    #[ORM\Column(type: Types::SMALLINT)]
    private int $score;

    #[ORM\Column(nullable: true)]
    private ?int $priceAgeSeconds = null;

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalSupplyUsd;

    /** Failed checks, as "CODE:severity" strings. */
    #[ORM\Column(type: Types::JSON)]
    private array $checks = [];

    public function getAddress(): string
    {
        return $this->address;
    }

    public function getHour(): \DateTimeImmutable
    {
        return $this->hour;
    }

    public function getProtocol(): string
    {
        return $this->protocol;
    }

    public function getScore(): int
    {
        return $this->score;
    }

    public function getPriceAgeSeconds(): ?int
    {
        return $this->priceAgeSeconds;
    }

    public function getTotalSupplyUsd(): float
    {
        return $this->totalSupplyUsd;
    }

    public function getChecks(): array
    {
        return $this->checks;
    }
}
