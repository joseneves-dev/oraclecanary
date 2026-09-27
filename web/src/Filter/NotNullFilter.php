<?php

namespace App\Filter;

use ApiPlatform\Doctrine\Common\Filter\OpenApiFilterTrait;
use ApiPlatform\Doctrine\Orm\Filter\FilterInterface;
use ApiPlatform\Doctrine\Orm\Util\QueryNameGeneratorInterface;
use ApiPlatform\Metadata\BackwardCompatibleFilterDescriptionTrait;
use ApiPlatform\Metadata\Exception\InvalidArgumentException;
use ApiPlatform\Metadata\OpenApiParameterFilterInterface;
use ApiPlatform\Metadata\Operation;
use Doctrine\ORM\QueryBuilder;

/**
 * Keeps rows where the parameter's property is set (`true`) or empty (`false`).
 *
 * Usage: `new QueryParameter(filter: new NotNullFilter(), property: 'marketName', schema: ['type' => 'boolean'])`.
 */
final class NotNullFilter implements FilterInterface, OpenApiParameterFilterInterface
{
    use BackwardCompatibleFilterDescriptionTrait;
    use OpenApiFilterTrait;

    public function apply(QueryBuilder $queryBuilder, QueryNameGeneratorInterface $queryNameGenerator, string $resourceClass, ?Operation $operation = null, array $context = []): void
    {
        $parameter = $context['parameter'];
        $property = $parameter->getProperty()
            ?? throw new InvalidArgumentException(\sprintf('The filter parameter "%s" must specify a property.', $parameter->getKey()));

        $value = filter_var($parameter->getValue(), \FILTER_VALIDATE_BOOLEAN, \FILTER_NULL_ON_FAILURE);
        if (null === $value) {
            return;
        }

        $alias = $queryBuilder->getRootAliases()[0];
        $queryBuilder->andWhere(\sprintf('%s.%s IS %s', $alias, $property, $value ? 'NOT NULL' : 'NULL'));
    }
}
