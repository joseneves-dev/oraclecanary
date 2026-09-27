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
use App\ApiResource\Model\Severity;
use App\Entity\ReserveHealthEvent;
use App\Filter\NotNullFilter;
use App\Validator\UtcDateTime;
use Symfony\Component\ObjectMapper\Attribute\Map;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Public API view of a change in a reserve's oracle health, e.g. its price went stale or recovered.
 */
#[ApiResource(
    shortName: 'ReserveEvent',
    description: 'A change in the failed checks of a lending reserve, recorded when a check starts or stops failing. "Near stale" alone is not a change.',
    operations: [
        new GetCollection(
            uriTemplate: '/events',
            description: 'Health changes, newest first.',
            parameters: [
                'id' => new QueryParameter(
                    filter: new ComparisonFilter(new ExactFilter()),
                    constraints: [new Assert\Collection(
                        fields: ['gt' => new Assert\Required([new Assert\Type('string'), new Assert\Regex('/^\d{1,18}$/')])],
                    )],
                    openApi: new Parameter('id[gt]', 'query', 'Only events recorded after the event with this id. Ids only grow, so pollers can pass the highest id they have seen to get each event once.', schema: ['type' => 'integer', 'minimum' => 0]),
                ),
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
                'listed' => new QueryParameter(
                    filter: new NotNullFilter(),
                    property: 'marketName',
                    constraints: [new Assert\Choice(choices: NotNullFilter::VALUES)],
                    openApi: new Parameter('listed', 'query', 'true: only markets listed in the protocol\'s own app', schema: ['type' => 'boolean']),
                ),
                'occurredAt' => new QueryParameter(
                    filter: new DateFilter(),
                    constraints: [new Assert\Collection(
                        fields: [
                            'after' => new Assert\Optional([new UtcDateTime()]),
                            'before' => new Assert\Optional([new UtcDateTime()]),
                        ],
                    )],
                    openApi: [
                        new Parameter('occurredAt[after]', 'query', 'Changes that started at or after this UTC time, e.g. 2026-09-27T00:00:00Z', schema: ['type' => 'string', 'format' => 'date-time']),
                        new Parameter('occurredAt[before]', 'query', 'Changes that started at or before this UTC time', schema: ['type' => 'string', 'format' => 'date-time']),
                    ],
                ),
            ],
        ),
        // Ids are BIGINT; anything else would reach the database and fail there instead of a 404.
        new Get(uriTemplate: '/events/{id}', requirements: ['id' => '\d{1,18}']),
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
final class ReserveEvent
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

    /** When the new state was first seen. The event is recorded a few minutes later, once the change has lasted. */
    public \DateTimeImmutable $occurredAt;

    /**
     * "degraded" when the worst severity got worse (or, with the same severity, the score dropped),
     * "recovered" for the opposite, "changed" when neither moved.
     */
    #[ApiProperty(schema: ['type' => 'string', 'enum' => ['degraded', 'recovered', 'changed']])]
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

    /** Worse severity first; with the same severity, a lower score. */
    public static function toDirection(array $checks, ReserveHealthEvent $source): string
    {
        $before = [self::toSeverity($source->getPreviousChecks())->rank(), -$source->getPreviousScore()];
        $after = [self::toSeverity($checks)->rank(), -$source->getScore()];

        return match ($after <=> $before) {
            1 => 'degraded',
            -1 => 'recovered',
            default => 'changed',
        };
    }

    /**
     * Checks failing now that were not failing before, or failing with another severity.
     *
     * @return list<CheckState>
     */
    public static function toStarted(array $checks, ReserveHealthEvent $source): array
    {
        return array_values(array_diff_key(self::byKey($checks), self::byKey($source->getPreviousChecks())));
    }

    /**
     * Checks no longer failing at all (a check whose severity changed is listed under started).
     *
     * @return list<CheckState>
     */
    public static function toResolved(array $checks, ReserveHealthEvent $source): array
    {
        $failingCodes = array_map(static fn (CheckState $check) => $check->code, CheckState::listFromStored($checks));

        return array_values(array_filter(
            CheckState::listFromStored($source->getPreviousChecks()),
            static fn (CheckState $check) => !\in_array($check->code, $failingCodes, true),
        ));
    }

    /** @return array<string, CheckState> keyed by "CODE:severity" */
    private static function byKey(array $checks): array
    {
        $states = [];
        foreach (CheckState::listFromStored($checks) as $check) {
            $states[$check->code.':'.$check->severity->value] = $check;
        }

        return $states;
    }
}
