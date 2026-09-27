<?php

namespace App\ApiResource;

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
use App\ApiResource\Model\Severity;
use App\Entity\ReserveHealthEvent;
use App\Filter\NotNullFilter;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Public API view of a change in a reserve's oracle health, e.g. its price went stale or recovered.
 */
#[ApiResource(
    shortName: 'HealthEvent',
    description: 'A change in the failed checks of a lending reserve, recorded when a check starts or stops failing. "Near stale" alone is not a change.',
    operations: [
        new GetCollection(
            uriTemplate: '/events',
            description: 'Health changes, newest first.',
            parameters: [
                'protocol' => new QueryParameter(
                    filter: new ExactFilter(),
                    openApi: new Parameter('protocol', 'query', 'Lending protocol', schema: ['type' => 'string', 'enum' => ['kamino', 'marginfi', 'jupiter-lend']]),
                ),
                'reserve' => new QueryParameter(
                    filter: new ExactFilter(),
                    property: 'address',
                    openApi: new Parameter('reserve', 'query', 'Reserve address', schema: ['type' => 'string']),
                ),
                'asset' => new QueryParameter(
                    filter: new PartialSearchFilter(),
                    constraints: [new Assert\Type('string')],
                    openApi: new Parameter('asset', 'query', 'Part of the asset symbol, case-insensitive', schema: ['type' => 'string']),
                ),
                'listed' => new QueryParameter(
                    filter: new NotNullFilter(),
                    property: 'marketName',
                    openApi: new Parameter('listed', 'query', 'true: only markets listed in the protocol\'s own app', schema: ['type' => 'boolean']),
                ),
                'occurredAt' => new QueryParameter(
                    filter: new DateFilter(),
                    constraints: [new Assert\Collection(
                        fields: [
                            'after' => new Assert\Optional([new Assert\Type('string'), new Assert\DateTime(format: \DateTimeInterface::ATOM)]),
                            'before' => new Assert\Optional([new Assert\Type('string'), new Assert\DateTime(format: \DateTimeInterface::ATOM)]),
                        ],
                    )],
                    openApi: [
                        new Parameter('occurredAt[after]', 'query', 'Changes at or after this time, e.g. 2026-09-27T00:00:00+00:00', schema: ['type' => 'string', 'format' => 'date-time']),
                        new Parameter('occurredAt[before]', 'query', 'Changes at or before this time', schema: ['type' => 'string', 'format' => 'date-time']),
                    ],
                ),
            ],
        ),
        new Get(uriTemplate: '/events/{id}'),
    ],
    order: ['occurredAt' => 'DESC', 'id' => 'DESC'],
    // Every field is always present (null when unknown) so clients can rely on the shape.
    normalizationContext: ['skip_null_values' => false],
    cacheHeaders: ['public' => true, 'max_age' => 30, 'shared_max_age' => 60, 'stale_while_revalidate' => 60],
    paginationClientItemsPerPage: true,
    paginationItemsPerPage: 50,
    paginationMaximumItemsPerPage: 500,
    stateOptions: new Options(entityClass: ReserveHealthEvent::class),
)]
#[Map(source: ReserveHealthEvent::class)]
final class HealthEvent
{
    #[ApiProperty(identifier: true)]
    public string $id;

    /** Reserve / bank / vault address on Solana. */
    #[Map(source: 'address')]
    public string $reserve;

    public string $protocol;

    public string $asset;

    /** Null for markets not listed in the protocol's own app. */
    public ?string $marketName;

    public \DateTimeImmutable $occurredAt;

    /** "degraded" when the worst severity got worse, "recovered" when it got better, "changed" otherwise. */
    #[Map(source: 'checks', transform: [self::class, 'toDirection'])]
    public string $direction;

    /** Worst severity after the change, or "ok" when no check fails any more. */
    #[Map(source: 'checks', transform: [self::class, 'toSeverity'])]
    public Severity $severity;

    public int $previousScore;

    public int $score;

    /** @var list<CheckState> Checks that started failing. */
    #[Map(source: 'checks', transform: [self::class, 'toStarted'])]
    public array $started;

    /** @var list<CheckState> Checks that stopped failing. */
    #[Map(source: 'checks', transform: [self::class, 'toResolved'])]
    public array $resolved;

    /** @var list<CheckState> Every failed check after the change. */
    #[Map(source: 'checks', transform: [CheckState::class, 'listFromStored'])]
    public array $checks;

    /** Supply in USD when the change happened. */
    public float $totalSupplyUsd;

    public static function toSeverity(array $checks): Severity
    {
        return Severity::worstOf(array_map(static fn (CheckState $check) => $check->severity->value, CheckState::listFromStored($checks)));
    }

    public static function toDirection(array $checks, ReserveHealthEvent $source): string
    {
        $before = self::toSeverity($source->getPreviousChecks())->rank();
        $after = self::toSeverity($checks)->rank();

        return match (true) {
            $after > $before => 'degraded',
            $after < $before => 'recovered',
            default => 'changed',
        };
    }

    /** @return list<CheckState> */
    public static function toStarted(array $checks, ReserveHealthEvent $source): array
    {
        return CheckState::listFromStored(array_values(array_diff($checks, $source->getPreviousChecks())));
    }

    /** @return list<CheckState> */
    public static function toResolved(array $checks, ReserveHealthEvent $source): array
    {
        return CheckState::listFromStored(array_values(array_diff($source->getPreviousChecks(), $checks)));
    }
}
