<?php

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\ComparisonFilter;
use ApiPlatform\Doctrine\Orm\Filter\ExactFilter;
use ApiPlatform\Doctrine\Orm\Filter\PartialSearchFilter;
use ApiPlatform\Doctrine\Orm\Filter\SortFilter;
use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\QueryParameter;
use App\Repository\LendingReserveRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * Latest oracle health state of one lending reserve (a Kamino reserve, a marginfi bank...).
 *
 * Rows are written by the TypeScript indexer; the web app only reads them, so the API is read-only.
 */
#[ApiResource(
    shortName: 'Reserve',
    description: 'Oracle dependency and health of a lending reserve.',
    operations: [
        new GetCollection(
            description: 'Lending reserves with their oracle health, filterable and sortable.',
            parameters: [
                'protocol' => new QueryParameter(filter: new ExactFilter(), description: 'e.g. kamino'),
                'market' => new QueryParameter(filter: new ExactFilter(), description: 'Lending market address'),
                'marketName' => new QueryParameter(filter: new PartialSearchFilter(), description: 'Part of the market name'),
                'asset' => new QueryParameter(filter: new PartialSearchFilter(), description: 'Part of the asset symbol'),
                'status' => new QueryParameter(filter: new ExactFilter(), description: 'active, obsolete or hidden'),
                'score' => new QueryParameter(filter: new ComparisonFilter(new ExactFilter()), description: 'e.g. score[lt]=50'),
                'totalSupplyUsd' => new QueryParameter(filter: new ComparisonFilter(new ExactFilter()), description: 'e.g. totalSupplyUsd[gte]=100000'),
                'order[score]' => new QueryParameter(filter: new SortFilter(), property: 'score'),
                'order[totalSupplyUsd]' => new QueryParameter(filter: new SortFilter(), property: 'totalSupplyUsd'),
                'order[priceAgeSeconds]' => new QueryParameter(filter: new SortFilter(), property: 'priceAgeSeconds'),
                'order[asset]' => new QueryParameter(filter: new SortFilter(), property: 'asset'),
            ],
        ),
        new Get(),
    ],
    order: ['score' => 'ASC', 'totalSupplyUsd' => 'DESC'],
    paginationClientItemsPerPage: true,
    paginationItemsPerPage: 50,
    paginationMaximumItemsPerPage: 500,
)]
#[ORM\Entity(repositoryClass: LendingReserveRepository::class)]
#[ORM\Index(name: 'idx_lending_reserve_market', columns: ['protocol', 'market'])]
#[ORM\Index(name: 'idx_lending_reserve_score', columns: ['score'])]
class LendingReserve
{
    /** Reserve / bank account address on Solana. */
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    #[ApiProperty(identifier: true)]
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
}
