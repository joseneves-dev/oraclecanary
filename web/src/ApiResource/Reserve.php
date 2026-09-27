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
use ApiPlatform\OpenApi\Model\Parameter;
use App\ApiResource\Model\HealthCheck;
use App\ApiResource\Model\MarketRef;
use App\ApiResource\Model\OracleAccounts;
use App\ApiResource\Model\PriceStatus;
use App\ApiResource\Model\Severity;
use App\Entity\LendingReserve;
use App\Filter\NotNullFilter;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

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
            // Each parameter documents exactly what it accepts; the filters' generated docs also advertise
            // array and operator variants this API rejects.
            parameters: [
                'protocol' => new QueryParameter(
                    filter: new ExactFilter(),
                    openApi: new Parameter('protocol', 'query', 'Lending protocol', schema: ['type' => 'string', 'enum' => ['kamino', 'marginfi', 'jupiter-lend']]),
                ),
                'market' => new QueryParameter(
                    filter: new ExactFilter(),
                    openApi: new Parameter('market', 'query', 'Lending market address', schema: ['type' => 'string']),
                ),
                'marketName' => new QueryParameter(
                    filter: new PartialSearchFilter(),
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('marketName', 'query', 'Part of the market name, case-insensitive', schema: ['type' => 'string']),
                ),
                'listed' => new QueryParameter(
                    filter: new NotNullFilter(),
                    property: 'marketName',
                    openApi: new Parameter('listed', 'query', 'true: only markets listed in the protocol\'s own app. Unlisted (permissionless) markets can hold tokens with arbitrary prices.', schema: ['type' => 'boolean']),
                ),
                'asset' => new QueryParameter(
                    filter: new PartialSearchFilter(),
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('asset', 'query', 'Part of the asset symbol, case-insensitive', schema: ['type' => 'string', 'example' => 'SOL']),
                ),
                'status' => new QueryParameter(
                    filter: new ExactFilter(),
                    openApi: new Parameter('status', 'query', 'Reserve status', schema: ['type' => 'string', 'enum' => ['active', 'obsolete', 'hidden', 'unknown']]),
                ),
                'score' => new QueryParameter(
                    filter: new ComparisonFilter(new ExactFilter()),
                    constraints: [new Assert\Collection(
                        fields: [
                            'gt' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 100)]),
                            'gte' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 100)]),
                            'lt' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 100)]),
                            'lte' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 100)]),
                        ],
                    )],
                    openApi: [
                        new Parameter('score[gt]', 'query', 'Score greater than', schema: ['type' => 'integer', 'minimum' => 0, 'maximum' => 100]),
                        new Parameter('score[gte]', 'query', 'Score greater than or equal to', schema: ['type' => 'integer', 'minimum' => 0, 'maximum' => 100]),
                        new Parameter('score[lt]', 'query', 'Score less than, e.g. score[lt]=100 for reserves with any issue', schema: ['type' => 'integer', 'minimum' => 0, 'maximum' => 100]),
                        new Parameter('score[lte]', 'query', 'Score less than or equal to', schema: ['type' => 'integer', 'minimum' => 0, 'maximum' => 100]),
                    ],
                ),
                'totalSupplyUsd' => new QueryParameter(
                    filter: new ComparisonFilter(new ExactFilter()),
                    constraints: [new Assert\Collection(
                        fields: [
                            'gt' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 1e15)]),
                            'gte' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 1e15)]),
                            'lt' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 1e15)]),
                            'lte' => new Assert\Optional([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 1e15)]),
                        ],
                    )],
                    openApi: [
                        new Parameter('totalSupplyUsd[gt]', 'query', 'Supply greater than, in USD', schema: ['type' => 'number', 'minimum' => 0]),
                        new Parameter('totalSupplyUsd[gte]', 'query', 'Supply greater than or equal to, in USD, e.g. 1000000', schema: ['type' => 'number', 'minimum' => 0]),
                        new Parameter('totalSupplyUsd[lt]', 'query', 'Supply less than, in USD', schema: ['type' => 'number', 'minimum' => 0]),
                        new Parameter('totalSupplyUsd[lte]', 'query', 'Supply less than or equal to, in USD', schema: ['type' => 'number', 'minimum' => 0]),
                    ],
                ),
                'order[score]' => new QueryParameter(filter: new SortFilter(), property: 'score', openApi: new Parameter('order[score]', 'query', 'Sort by score', schema: ['type' => 'string', 'enum' => ['asc', 'desc']])),
                'order[totalSupplyUsd]' => new QueryParameter(filter: new SortFilter(), property: 'totalSupplyUsd', openApi: new Parameter('order[totalSupplyUsd]', 'query', 'Sort by supply', schema: ['type' => 'string', 'enum' => ['asc', 'desc']])),
                'order[priceAgeSeconds]' => new QueryParameter(filter: new SortFilter(), property: 'priceAgeSeconds', openApi: new Parameter('order[priceAgeSeconds]', 'query', 'Sort by price age', schema: ['type' => 'string', 'enum' => ['asc', 'desc']])),
                'order[asset]' => new QueryParameter(filter: new SortFilter(), property: 'asset', openApi: new Parameter('order[asset]', 'query', 'Sort by asset symbol', schema: ['type' => 'string', 'enum' => ['asc', 'desc']])),
            ],
        ),
        new Get(),
    ],
    order: ['score' => 'ASC', 'totalSupplyUsd' => 'DESC'],
    // Every field is always present (null when unknown) so clients can rely on the shape.
    normalizationContext: ['skip_null_values' => false],
    // The indexer refreshes the data about once a minute, so caches may reuse a response briefly.
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 60, 'stale_while_revalidate' => 60],
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
        return Severity::worstOf(array_map(static fn (HealthCheck $check) => $check->severity->value, self::toChecks($checks)));
    }

    public static function toPrice(?int $ageSeconds, LendingReserve $source): PriceStatus
    {
        return PriceStatus::from($ageSeconds, $source->getMaxAgePriceSeconds());
    }

    /** @return list<HealthCheck> */
    public static function toChecks(array $checks): array
    {
        return array_values(array_map(HealthCheck::fromArray(...), $checks));
    }
}
