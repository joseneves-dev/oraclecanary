<?php

namespace App\ApiResource;

use ApiPlatform\Doctrine\Orm\Filter\ExactFilter;
use ApiPlatform\Doctrine\Orm\State\Options;
use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\QueryParameter;
use ApiPlatform\OpenApi\Model\Parameter;
use App\Entity\ReserveConfigChange as ReserveConfigChangeEntity;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Public API view of a change to how a listed reserve is priced.
 */
#[ApiResource(
    shortName: 'ReserveConfigChange',
    description: 'A change to how a reserve in a listed market is priced: newly listed, a different price source, or a different limit on the price\'s age.',
    operations: [
        new GetCollection(
            uriTemplate: '/config-changes',
            description: 'Configuration changes, most recent first.',
            parameters: [
                'protocol' => new QueryParameter(
                    filter: new ExactFilter(),
                    constraints: [new Assert\Choice(choices: Reserve::PROTOCOLS)],
                    openApi: new Parameter('protocol', 'query', 'Lending protocol', schema: ['type' => 'string', 'enum' => Reserve::PROTOCOLS]),
                ),
                'kind' => new QueryParameter(
                    filter: new ExactFilter(),
                    constraints: [new Assert\Choice(choices: self::KINDS)],
                    openApi: new Parameter('kind', 'query', 'listed, price_source or max_age', schema: ['type' => 'string', 'enum' => self::KINDS]),
                ),
                'reserve' => new QueryParameter(
                    filter: new ExactFilter(),
                    property: 'address',
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('reserve', 'query', 'Reserve address', schema: ['type' => 'string']),
                ),
            ],
        ),
        // Ids are BIGINT; anything else would reach the database and fail there instead of a 404.
        new Get(uriTemplate: '/config-changes/{id}', requirements: ['id' => '\d{1,18}']),
    ],
    order: ['occurredAt' => 'DESC', 'id' => 'DESC'],
    normalizationContext: ['skip_null_values' => false],
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 60, 'stale_while_revalidate' => 60],
    paginationClientItemsPerPage: true,
    paginationItemsPerPage: 50,
    paginationMaximumItemsPerPage: 500,
    stateOptions: new Options(entityClass: ReserveConfigChangeEntity::class),
)]
#[Map(source: ReserveConfigChangeEntity::class)]
final class ReserveConfigChange
{
    public const KINDS = ['listed', 'price_source', 'max_age'];

    #[ApiProperty(identifier: true)]
    public string $id;

    /** Reserve / bank / vault address on Solana. */
    #[Map(source: 'address')]
    public string $reserve;

    public string $protocol;

    public string $asset;

    public ?string $marketName;

    public \DateTimeImmutable $occurredAt;

    /** "listed", "price_source" or "max_age". */
    public string $kind;

    /** The change in one sentence. */
    public string $detail;

    /** The changed fields before, as stored (null for a new listing): an object of fields, or a number for an age limit. */
    #[ApiProperty(schema: ['type' => ['object', 'number', 'null']])]
    public mixed $before;

    /** The changed fields after, in the same shape. */
    #[ApiProperty(schema: ['type' => ['object', 'number', 'null']])]
    public mixed $after;

    /** Supply in the reserve when the change was seen, in USD. */
    public float $totalSupplyUsd;
}
