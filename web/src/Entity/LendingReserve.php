<?php

namespace App\Entity;

use App\Repository\LendingReserveRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * Latest oracle health state of one lending reserve (a Kamino reserve, a marginfi bank...).
 *
 * Rows are written by the TypeScript indexer; the web app only reads them. The public API shape
 * lives in App\ApiResource\Reserve.
 */
#[ORM\Entity(repositoryClass: LendingReserveRepository::class)]
#[ORM\Index(name: 'idx_lending_reserve_protocol', columns: ['protocol', 'checked_at'])]
// Serves sorting by score (order[score]), then supply and address as tiebreakers.
#[ORM\Index(name: 'idx_lending_reserve_default_order', columns: ['score', 'total_supply_usd', 'address'])]
#[ORM\Index(name: 'idx_lending_reserve_market', columns: ['market'])]
class LendingReserve
{
    /** Reserve / bank account address on Solana. */
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    private string $address;

    #[ORM\Column(length: 32)]
    private string $protocol;

    #[ORM\Column(length: 44)]
    private string $market;

    /** Name shown by the protocol's own app; null for unlisted (permissionless) markets. */
    #[ORM\Column(length: 120, nullable: true)]
    private ?string $marketName = null;

    #[ORM\Column(length: 64)]
    private string $asset;

    #[ORM\Column(length: 44)]
    private string $mint;

    /** active | obsolete | hidden | unknown */
    #[ORM\Column(length: 16)]
    private string $status;

    #[ORM\Column(type: Types::FLOAT)]
    private float $totalSupplyUsd;

    /** The protocol's own staleness limit for this reserve, in seconds. */
    #[ORM\Column]
    private int $maxAgePriceSeconds;

    /** Age of the oldest price in the reserve's price chain when last checked. */
    #[ORM\Column(nullable: true)]
    private ?int $priceAgeSeconds = null;

    /** 0 (broken) to 100 (healthy). */
    #[ORM\Column(type: Types::SMALLINT)]
    private int $score;

    /** Upstream oracle providers the price ultimately comes from, e.g. ["PythLazer", "Chainlink"]. */
    #[ORM\Column(type: Types::JSON)]
    private array $providers = [];

    /** Failed checks: list of {code, severity, message}. */
    #[ORM\Column(type: Types::JSON)]
    private array $checks = [];

    /** Configured feed accounts: {pyth, switchboard, scope, scopeChain}. */
    #[ORM\Column(type: Types::JSON)]
    private array $feeds = [];

    #[ORM\Column]
    private \DateTimeImmutable $checkedAt;

    /** Jupiter Lend vaults only: the token borrowed from the vault (its own mint is the collateral). */
    #[ORM\Column(length: 44, nullable: true)]
    private ?string $borrowMint = null;

    /** The asset is a tokenized US stock, whose price follows the stock market's hours. */
    #[ORM\Column(options: ['default' => false])]
    private bool $marketHours = false;

    /** What depositors earn per year as the protocol reports it, a fraction (0.05 = 5%), without incentives. */
    #[ORM\Column(type: Types::FLOAT, nullable: true)]
    private ?float $supplyApy = null;

    /** What borrowers pay per year as the protocol reports it, a fraction. */
    #[ORM\Column(type: Types::FLOAT, nullable: true)]
    private ?float $borrowApy = null;

    /** Share of a deposit that can be borrowed against it (0 to 1); 0 means it is not accepted as collateral. */
    #[ORM\Column(type: Types::FLOAT, nullable: true)]
    private ?float $maxLtv = null;

    /** Where the rates come from: kamino-api or marginfi-onchain. */
    #[ORM\Column(length: 32, nullable: true)]
    private ?string $rateSource = null;

    /** When the source computed (or the indexer read) the rates. */
    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $rateAt = null;

    public function getAddress(): string
    {
        return $this->address;
    }

    public function getProtocol(): string
    {
        return $this->protocol;
    }

    public function getMarket(): string
    {
        return $this->market;
    }

    public function getMarketName(): ?string
    {
        return $this->marketName;
    }

    public function getAsset(): string
    {
        return $this->asset;
    }

    public function getMint(): string
    {
        return $this->mint;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function getTotalSupplyUsd(): float
    {
        return $this->totalSupplyUsd;
    }

    public function getMaxAgePriceSeconds(): int
    {
        return $this->maxAgePriceSeconds;
    }

    public function getPriceAgeSeconds(): ?int
    {
        return $this->priceAgeSeconds;
    }

    public function getScore(): int
    {
        return $this->score;
    }

    public function getProviders(): array
    {
        return $this->providers;
    }

    public function getChecks(): array
    {
        return $this->checks;
    }

    public function getFeeds(): array
    {
        return $this->feeds;
    }

    public function getCheckedAt(): \DateTimeImmutable
    {
        return $this->checkedAt;
    }

    public function getBorrowMint(): ?string
    {
        return $this->borrowMint;
    }

    public function isMarketHours(): bool
    {
        return $this->marketHours;
    }

    public function getSupplyApy(): ?float
    {
        return $this->supplyApy;
    }

    public function getBorrowApy(): ?float
    {
        return $this->borrowApy;
    }

    public function getMaxLtv(): ?float
    {
        return $this->maxLtv;
    }

    public function getRateSource(): ?string
    {
        return $this->rateSource;
    }

    public function getRateAt(): ?\DateTimeImmutable
    {
        return $this->rateAt;
    }
}
