<?php

namespace App\ApiResource;

use ApiPlatform\Doctrine\Orm\Filter\ComparisonFilter;
use ApiPlatform\Doctrine\Orm\Filter\DateFilter;
use ApiPlatform\Doctrine\Orm\Filter\ExactFilter;
use ApiPlatform\Doctrine\Orm\Filter\PartialSearchFilter;
use ApiPlatform\Doctrine\Orm\State\Options;
use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\QueryParameter;
use ApiPlatform\OpenApi\Model\Parameter;
use App\ApiResource\Model\CheckState;
use App\Entity\ReserveIncident as ReserveIncidentEntity;
use App\Filter\NotNullFilter;
use App\Validator\UtcDateTime;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Public API view of an incident: a period during which a listed reserve's price could not be used.
 */
#[ApiResource(
    shortName: 'ReserveIncident',
    description: 'A period during which a reserve in a listed market had a critical check, so the protocol could not use its price.',
    operations: [
        new GetCollection(
            uriTemplate: '/incidents',
            description: 'Incidents, most recent start first.',
            parameters: [
                'protocol' => new QueryParameter(
                    filter: new ExactFilter(),
                    constraints: [new Assert\Choice(choices: Reserve::PROTOCOLS)],
                    openApi: new Parameter('protocol', 'query', 'Lending protocol', schema: ['type' => 'string', 'enum' => Reserve::PROTOCOLS]),
                ),
                'reserve' => new QueryParameter(
                    filter: new ExactFilter(),
                    property: 'address',
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('reserve', 'query', 'Reserve address', schema: ['type' => 'string']),
                ),
                'asset' => new QueryParameter(
                    filter: new PartialSearchFilter(),
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('asset', 'query', 'Part of the asset symbol, case-insensitive', schema: ['type' => 'string']),
                ),
                'resolved' => new QueryParameter(
                    filter: new NotNullFilter(),
                    property: 'endedAt',
                    constraints: [new Assert\Choice(choices: NotNullFilter::VALUES)],
                    openApi: new Parameter('resolved', 'query', 'true: only incidents that ended; false: only ongoing ones', schema: ['type' => 'boolean']),
                ),
                'totalSupplyUsd' => new QueryParameter(
                    filter: new ComparisonFilter(new ExactFilter()),
                    constraints: [new Assert\Collection(
                        fields: [
                            'gte' => new Assert\Required([new Assert\Type('numeric'), new Assert\Range(min: 0, max: 1e15)]),
                        ],
                    )],
                    openApi: new Parameter('totalSupplyUsd[gte]', 'query', 'Largest exposure at least this many USD, e.g. 1 to leave out empty reserves', schema: ['type' => 'number', 'minimum' => 0]),
                ),
                'startedAt' => new QueryParameter(
                    filter: new DateFilter(),
                    constraints: [new Assert\Collection(
                        fields: [
                            'after' => new Assert\Optional([new UtcDateTime()]),
                            'before' => new Assert\Optional([new UtcDateTime()]),
                        ],
                    )],
                    openApi: [
                        new Parameter('startedAt[after]', 'query', 'Incidents that started at or after this UTC time, e.g. 2026-09-27T00:00:00Z', schema: ['type' => 'string', 'format' => 'date-time']),
                        new Parameter('startedAt[before]', 'query', 'Incidents that started at or before this UTC time', schema: ['type' => 'string', 'format' => 'date-time']),
                    ],
                ),
            ],
        ),
        // Ids are BIGINT; anything else would reach the database and fail there instead of a 404.
        new Get(uriTemplate: '/incidents/{id}', requirements: ['id' => '\d{1,18}']),
    ],
    order: ['startedAt' => 'DESC', 'id' => 'DESC'],
    normalizationContext: ['skip_null_values' => false],
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 60, 'stale_while_revalidate' => 60],
    paginationClientItemsPerPage: true,
    paginationItemsPerPage: 50,
    paginationMaximumItemsPerPage: 500,
    stateOptions: new Options(entityClass: ReserveIncidentEntity::class),
)]
#[Map(source: ReserveIncidentEntity::class)]
final class ReserveIncident
{
    #[ApiProperty(identifier: true)]
    public string $id;

    /** Reserve / bank / vault address on Solana. */
    #[Map(source: 'address')]
    public string $reserve;

    public string $protocol;

    public string $asset;

    public ?string $marketName;

    public \DateTimeImmutable $startedAt;

    /**
     * True when the reserve was already failing when OracleCanary started tracking it: the start is
     * then worked out from the age of its price.
     */
    #[Map(source: 'startEstimated')]
    public bool $startEstimated;

    /** Null while the incident is ongoing. */
    // Explicit: durationSeconds also reads endedAt, and would otherwise be the only property mapped from it.
    #[Map(source: 'endedAt')]
    public ?\DateTimeImmutable $endedAt;

    /** Length of the incident in seconds; null while it is ongoing. */
    #[Map(source: 'endedAt', transform: [self::class, 'toDuration'])]
    public ?int $durationSeconds;

    /** @var list<CheckState> The critical checks when the incident started. */
    #[Map(source: 'checks', transform: [CheckState::class, 'listFromStored'])]
    public array $checks;

    /** Largest supply exposed during the incident, in USD. */
    public float $totalSupplyUsd;

    public static function toDuration(?\DateTimeImmutable $endedAt, ReserveIncidentEntity $source): ?int
    {
        return $endedAt ? $endedAt->getTimestamp() - $source->getStartedAt()->getTimestamp() : null;
    }
}
