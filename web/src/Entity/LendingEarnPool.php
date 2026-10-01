<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A Jupiter Lend Earn pool: deposits Jupiter Lend's vaults lend to borrowers of the same token. It has
 * no oracle of its own, so it is not a lending reserve.
 *
 * Written by the indexer from Jupiter's public API and replaced as a whole; read-only for the API.
 */
#[ORM\Entity]
class LendingEarnPool
{
    /** The pool's share token (fToken) address. */
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    private string $address;

    /** Deposit token symbol, e.g. "USDC". */
    #[ORM\Column(length: 64)]
    private string $asset;

    /** Deposit token mint. */
    #[ORM\Column(length: 44)]
    private string $mint;

    /** What depositors earn per year, a fraction (0.05 = 5%), without incentives. */
    #[ORM\Column(type: Types::FLOAT)]
    private float $supplyApy;

    /** Token incentives on top of supplyApy, a fraction. */
    #[ORM\Column(type: Types::FLOAT)]
    private float $rewardsApy;

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalSupplyUsd;

    /** Where the rate comes from, e.g. jupiter-api. */
    #[ORM\Column(length: 32)]
    private string $rateSource;

    /** When the indexer read the rate. */
    #[ORM\Column]
    private \DateTimeImmutable $rateAt;

    #[ORM\Column]
    private \DateTimeImmutable $checkedAt;

    public function getAddress(): string
    {
        return $this->address;
    }

    public function getAsset(): string
    {
        return $this->asset;
    }

    public function getMint(): string
    {
        return $this->mint;
    }

    public function getSupplyApy(): float
    {
        return $this->supplyApy;
    }

    public function getRewardsApy(): float
    {
        return $this->rewardsApy;
    }

    public function getTotalSupplyUsd(): float
    {
        return $this->totalSupplyUsd;
    }

    public function getRateSource(): string
    {
        return $this->rateSource;
    }

    public function getRateAt(): \DateTimeImmutable
    {
        return $this->rateAt;
    }

    public function getCheckedAt(): \DateTimeImmutable
    {
        return $this->checkedAt;
    }
}
