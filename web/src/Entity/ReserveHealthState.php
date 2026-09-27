<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * The indexer's memory for change detection: the last reported health of each listed reserve, and a
 * change waiting to be confirmed.
 *
 * Kept apart from lending_reserve so a reserve that drops out of a run and comes back is still
 * compared with its last reported state.
 */
#[ORM\Entity]
#[ORM\Index(name: 'idx_reserve_health_state_protocol', columns: ['protocol', 'last_seen_at'])]
class ReserveHealthState
{
    #[ORM\Id]
    #[ORM\Column(length: 44)]
    private string $address;

    #[ORM\Column(length: 32)]
    private string $protocol;

    #[ORM\Column(type: Types::SMALLINT)]
    private int $reportedScore;

    /** Lasting failed checks last reported, as "CODE:severity" strings. */
    #[ORM\Column(type: Types::JSON)]
    private array $reportedChecks = [];

    /** Checks seen since pendingSince that differ from the reported ones, not yet confirmed. */
    #[ORM\Column(type: Types::JSON, nullable: true)]
    private ?array $pendingChecks = null;

    #[ORM\Column(type: Types::SMALLINT, nullable: true)]
    private ?int $pendingScore = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $pendingSince = null;

    #[ORM\Column]
    private \DateTimeImmutable $lastSeenAt;
}
