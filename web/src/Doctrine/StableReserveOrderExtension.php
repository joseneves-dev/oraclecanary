<?php

namespace App\Doctrine;

use ApiPlatform\Doctrine\Orm\Extension\QueryCollectionExtensionInterface;
use ApiPlatform\Doctrine\Orm\Util\QueryNameGeneratorInterface;
use ApiPlatform\Metadata\Operation;
use App\Entity\LendingReserve;
use Doctrine\ORM\QueryBuilder;
use Symfony\Component\DependencyInjection\Attribute\AsTaggedItem;

/**
 * Appends the primary key as the last sort key of every reserve collection.
 *
 * Many reserves share a score or supply, and PostgreSQL returns ties in no fixed order, so without
 * a unique tiebreaker pages overlap and some reserves are never returned. Runs after the sort
 * filters (-16) and the default order (-32), and before pagination (-64).
 */
#[AsTaggedItem(priority: -48)]
final class StableReserveOrderExtension implements QueryCollectionExtensionInterface
{
    public function applyToCollection(QueryBuilder $queryBuilder, QueryNameGeneratorInterface $queryNameGenerator, string $resourceClass, ?Operation $operation = null, array $context = []): void
    {
        $entityClass = $operation?->getStateOptions()?->getEntityClass() ?? $resourceClass;
        if (LendingReserve::class !== $entityClass) {
            return;
        }

        $queryBuilder->addOrderBy($queryBuilder->getRootAliases()[0].'.address', 'ASC');
    }
}
