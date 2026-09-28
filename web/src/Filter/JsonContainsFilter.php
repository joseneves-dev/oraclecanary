<?php

namespace App\Filter;

use ApiPlatform\Doctrine\Common\Filter\OpenApiFilterTrait;
use ApiPlatform\Doctrine\Orm\Filter\FilterInterface;
use ApiPlatform\Doctrine\Orm\Util\QueryNameGeneratorInterface;
use ApiPlatform\Metadata\BackwardCompatibleFilterDescriptionTrait;
use ApiPlatform\Metadata\OpenApiParameterFilterInterface;
use ApiPlatform\Metadata\Operation;
use Doctrine\ORM\QueryBuilder;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Keeps reserves whose JSON list column contains the parameter's value:
 * - `new JsonContainsFilter('checks', 'code')`: a failed check with that code, e.g. `check=STALE`;
 * - `new JsonContainsFilter('providers')`: a price source of that name, e.g. `provider=Chainlink`.
 *
 * DQL cannot look inside a JSON column, so the matching addresses come from PostgreSQL's JSON
 * containment first; the reserve table is small enough for that to be cheap. The column and key are
 * fixed in code; only the value comes from the request, and it is bound as a parameter.
 *
 * Created in the resource's parameters with its column, not by the container.
 */
#[Exclude]
final class JsonContainsFilter implements FilterInterface, OpenApiParameterFilterInterface
{
    use BackwardCompatibleFilterDescriptionTrait;
    use OpenApiFilterTrait;

    /**
     * Check codes: upper-case words joined by underscores. Validate with an `Assert\Regex`; `D` stops
     * `$` from also matching before a trailing newline.
     */
    public const CHECK_PATTERN = '/^[A-Z][A-Z_]{1,39}$/D';
    /** Provider names: letters, digits and spaces, e.g. "PythLazer" or "Stake pool rate". */
    public const PROVIDER_PATTERN = '/^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/D';

    public function __construct(
        private readonly string $column,
        private readonly ?string $key = null,
    ) {
    }

    public function apply(QueryBuilder $queryBuilder, QueryNameGeneratorInterface $queryNameGenerator, string $resourceClass, ?Operation $operation = null, array $context = []): void
    {
        $value = $context['parameter']->getValue();
        if (!\is_string($value) || '' === $value) {
            return;
        }

        $needle = null === $this->key ? [$value] : [[$this->key => $value]];
        $addresses = $queryBuilder->getEntityManager()->getConnection()->fetchFirstColumn(
            \sprintf('SELECT address FROM lending_reserve WHERE %s::jsonb @> :needle::jsonb', $this->column),
            ['needle' => json_encode($needle, \JSON_THROW_ON_ERROR)],
        );

        $alias = $queryBuilder->getRootAliases()[0];
        if (!$addresses) {
            $queryBuilder->andWhere('1 = 0');

            return;
        }
        $parameter = $queryNameGenerator->generateParameterName($this->column.'_match');
        $queryBuilder->andWhere(\sprintf('%s.address IN (:%s)', $alias, $parameter))->setParameter($parameter, $addresses);
    }
}
