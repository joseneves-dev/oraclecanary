<?php

namespace App\ApiResource;

use ApiPlatform\Doctrine\Orm\Filter\ComparisonFilter;
use ApiPlatform\Doctrine\Orm\Filter\ExactFilter;
use ApiPlatform\Doctrine\Orm\Filter\PartialSearchFilter;
use ApiPlatform\Doctrine\Orm\Filter\SortFilter;
use ApiPlatform\Doctrine\Orm\State\Options;
use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\QueryParameter;
use App\ApiResource\Model\HealthCheck;
use App\ApiResource\Model\MarketRef;
use App\ApiResource\Model\OracleAccounts;
use App\ApiResource\Model\PriceStatus;
use App\ApiResource\Model\Severity;
use App\Entity\LendingReserve;
use App\Filter\NotNullFilter;
use Symfony\Component\ObjectMapper\Attribute\Map;

/**
 * Public API view of a lending reserve's oracle health.
 *
 * Kept separate from the LendingReserve entity so the storage written by the indexer can change
 * without changing the API contract.
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
                'listed' => new QueryParameter(
                    filter: new NotNullFilter(),
                    property: 'marketName',
                    schema: ['type' => 'boolean'],
                    description: 'true: only markets listed in the protocol\'s own app. Unlisted (permissionless) markets can hold tokens with arbitrary prices.',
                ),
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
    // Every field is always present (null when unknown) so clients can rely on the shape.
    normalizationContext: ['skip_null_values' => false],
    paginationClientItemsPerPage: true,
    paginationItemsPerPage: 50,
    paginationMaximumItemsPerPage: 500,
    stateOptions: new Options(entityClass: LendingReserve::class),
)]
#[Map(source: LendingReserve::class)]
final class Reserve
{
    /** Reserve / bank account address on Solana. */
    #[ApiProperty(identifier: true)]
    public string $address;

    /** Lending protocol, e.g. "kamino". */
    public string $protocol;

    /** Token symbol as configured by the protocol, e.g. "SOL". */
    public string $asset;

    public string $mint;

    #[Map(source: 'market', transform: [self::class, 'toMarket'])]
    public MarketRef $market;

    /** active, obsolete or hidden. */
    public string $status;

    /** Deposited value (available + borrowed) in USD, at the protocol's last stored price. */
    public float $totalSupplyUsd;

    /** 0 (broken) to 100 (healthy). */
    public int $score;

    /** Worst severity among the failed checks, or "ok" when none failed. */
    #[Map(source: 'checks', transform: [self::class, 'toSeverity'])]
    public Severity $severity;

    #[Map(source: 'priceAgeSeconds', transform: [self::class, 'toPrice'])]
    public PriceStatus $price;

    /**
     * Oracle providers the price ultimately comes from, e.g. ["PythLazer", "Chainlink"].
     *
     * @var list<string>
     */
    public array $providers;

    /** @var list<HealthCheck> */
    #[Map(source: 'checks', transform: [self::class, 'toChecks'])]
    public array $checks;

    #[Map(source: 'feeds', transform: [OracleAccounts::class, 'fromArray'])]
    public OracleAccounts $oracleAccounts;

    public \DateTimeImmutable $checkedAt;

    public static function toMarket(string $address, LendingReserve $source): MarketRef
    {
        return new MarketRef($address, $source->getMarketName());
    }

    public static function toSeverity(array $checks): Severity
    {
        return Severity::worstOf(array_column($checks, 'severity'));
    }

    public static function toPrice(?int $ageSeconds, LendingReserve $source): PriceStatus
    {
        return PriceStatus::from($ageSeconds, $source->getMaxAgePriceSeconds());
    }

    /** @return list<HealthCheck> */
    public static function toChecks(array $checks): array
    {
        return array_map(HealthCheck::fromArray(...), $checks);
    }
}
