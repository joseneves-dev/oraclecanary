<?php

namespace App\ApiResource;

use ApiPlatform\Doctrine\Orm\Filter\DateFilter;
use ApiPlatform\Doctrine\Orm\State\Options;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Link;
use ApiPlatform\Metadata\QueryParameter;
use ApiPlatform\OpenApi\Model\Parameter;
use App\ApiResource\Model\CheckState;
use App\ApiResource\Model\Severity;
use App\Entity\ReserveHealthHourly;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Public API view of one hourly sample of a reserve's oracle health, for history charts.
 */
#[ApiResource(
    shortName: 'ReserveSnapshot',
    description: 'A reserve\'s health at the start of an hour. Recorded for reserves in listed markets.',
    operations: [
        new GetCollection(
            uriTemplate: '/reserves/{address}/history',
            uriVariables: ['address' => new Link(fromClass: ReserveHealthHourly::class, identifiers: ['address'])],
            description: 'Hourly health samples of one reserve, newest first. Empty for unknown reserves and unlisted markets.',
            parameters: [
                'hour' => new QueryParameter(
                    filter: new DateFilter(),
                    constraints: [new Assert\Collection(
                        fields: [
                            'after' => new Assert\Optional([new Assert\Type('string'), new Assert\DateTime(format: \DateTimeInterface::ATOM)]),
                            'before' => new Assert\Optional([new Assert\Type('string'), new Assert\DateTime(format: \DateTimeInterface::ATOM)]),
                        ],
                    )],
                    openApi: [
                        new Parameter('hour[after]', 'query', 'Samples at or after this time, e.g. 2026-09-27T00:00:00+00:00', schema: ['type' => 'string', 'format' => 'date-time']),
                        new Parameter('hour[before]', 'query', 'Samples at or before this time', schema: ['type' => 'string', 'format' => 'date-time']),
                    ],
                ),
            ],
        ),
    ],
    order: ['hour' => 'DESC'],
    normalizationContext: ['skip_null_values' => false],
    cacheHeaders: ['public' => true, 'max_age' => 300, 'shared_max_age' => 300, 'stale_while_revalidate' => 300],
    paginationClientItemsPerPage: true,
    // A week of samples per page by default, up to 90 days.
    paginationItemsPerPage: 168,
    paginationMaximumItemsPerPage: 2160,
    stateOptions: new Options(entityClass: ReserveHealthHourly::class),
)]
#[Map(source: ReserveHealthHourly::class)]
final class ReserveSnapshot
{
    public string $address;

    /** Start of the hour, in UTC. */
    public \DateTimeImmutable $hour;

    /** 0 (broken) to 100 (healthy). */
    public int $score;

    /** Worst severity among the failed checks, or "ok" when none failed. */
    #[Map(source: 'checks', transform: [self::class, 'toSeverity'])]
    public Severity $severity;

    /** Age of the price the protocol would use, in seconds; null when unknown. */
    public ?int $priceAgeSeconds;

    public float $totalSupplyUsd;

    /** @var list<CheckState> */
    #[Map(source: 'checks', transform: [CheckState::class, 'listFromStored'])]
    public array $checks;

    public static function toSeverity(array $checks): Severity
    {
        return Severity::worstOf(array_map(static fn (CheckState $check) => $check->severity->value, CheckState::listFromStored($checks)));
    }
}
