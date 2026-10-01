<?php

namespace App\Mcp\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\Reserve;
use App\Entity\LendingReserve;
use App\Mcp\Output\ReserveSearch;
use App\Mcp\Output\ReserveSummary;
use App\Mcp\Tool\SearchReservesTool;
use App\Repository\LendingReserveRepository;
use Symfony\Component\ObjectMapper\ObjectMapperInterface;

/**
 * Answers search_reserves in the default order of GET /api/reserves: largest deposits first.
 *
 * @implements ProcessorInterface<SearchReservesTool, ReserveSearch>
 */
final readonly class SearchReservesProcessor implements ProcessorInterface
{
    public function __construct(
        private LendingReserveRepository $reserves,
        private ObjectMapperInterface $objectMapper,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): ReserveSearch
    {
        \assert($data instanceof SearchReservesTool);

        $query = $this->reserves->createQueryBuilder('r')
            ->orderBy('r.totalSupplyUsd', 'DESC')
            ->addOrderBy('r.score', 'ASC')
            ->addOrderBy('r.address', 'ASC');
        if (null !== $data->protocol) {
            $query->andWhere('r.protocol = :protocol')->setParameter('protocol', $data->protocol);
        }
        if (null !== $data->asset && '' !== $data->asset) {
            $query->andWhere('LOWER(r.asset) LIKE :asset')
                ->setParameter('asset', '%'.addcslashes(mb_strtolower($data->asset), '%_\\').'%');
        }
        // Severity is the worst of the stored checks, worked out as the REST API does, so the
        // filter runs on the mapped reserves; there are only about a thousand.
        if (null === $data->severity) {
            $query->setMaxResults($data->limit);
        }

        $found = [];
        /** @var LendingReserve $entity */
        foreach ($query->getQuery()->toIterable() as $entity) {
            $reserve = $this->objectMapper->map($entity, Reserve::class);
            if (null !== $data->severity && $reserve->severity->value !== $data->severity) {
                continue;
            }
            $found[] = ReserveSummary::fromReserve($reserve);
            if (\count($found) >= $data->limit) {
                break;
            }
        }

        return new ReserveSearch(\count($found), $found);
    }
}
