<?php

namespace App\Mcp\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\ReserveIncident;
use App\Entity\ReserveIncident as ReserveIncidentEntity;
use App\Mcp\Output\OpenIncident;
use App\Mcp\Output\OpenIncidents;
use App\Mcp\Tool\OpenIncidentsTool;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\ObjectMapper\ObjectMapperInterface;

/**
 * Answers open_incidents as GET /api/incidents?resolved=false does: ongoing ones, most recent start first.
 *
 * @implements ProcessorInterface<OpenIncidentsTool, OpenIncidents>
 */
final readonly class OpenIncidentsProcessor implements ProcessorInterface
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private ObjectMapperInterface $objectMapper,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): OpenIncidents
    {
        \assert($data instanceof OpenIncidentsTool);

        $entities = $this->entityManager->getRepository(ReserveIncidentEntity::class)
            ->findBy(['endedAt' => null], ['startedAt' => 'DESC', 'id' => 'DESC'], $data->limit);

        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $incidents = array_map(
            fn (ReserveIncidentEntity $entity) => OpenIncident::fromIncident($this->objectMapper->map($entity, ReserveIncident::class), $now),
            $entities,
        );

        return new OpenIncidents(\count($incidents), $incidents);
    }
}
