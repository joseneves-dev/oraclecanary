<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Corrects incidents recorded before two rules existed (data only, no schema change):
 * - the FWDI and GLXY weekend incidents of 25–28 Sep 2026 were stock-market closures: they get the
 *   MARKET_CLOSED context later incidents carry, so they no longer read as oracle failures;
 * - three Kamino reserves priced only by a fixed value were flagged STALE from 27 to 28 Sep, which
 *   fc89ff3 stopped doing because a fixed price cannot be late: those incidents and the events that
 *   opened and closed them are removed.
 * Rows are matched by reserve address, recorded checks and date, so databases without them are left
 * unchanged, and running it again changes nothing.
 */
final class Version20260928160000 extends AbstractMigration
{
    private const MARKET_CLOSURES = [
        ['2ZdH2K1J6WHGvfjfjX73VbcSh1cGUeTjFfNkYQXpcEHn', '2026-09-25 19:59:59'], // FWDI
        ['4v8hN3DgJ86qH1KBr9PCKSgi3t8F1MJc7n6Wzsbw1C6g', '2026-09-25 23:59:59'], // GLXY
    ];

    private const FIXED_PRICE_RESERVES = [
        'FPAwg5jadDs8AvUtvtAbit2RCZdkZES6yY5X6nCSuEw9', // kSOLMSOLRaydium
        'D1ZdZSNfn6nfzEyK6uvFCcRi8SzihnPdYHLtnjBjwxGn', // ALP
        '57U9pEC8NsWvHgWywd2xHTRkGQzWWYsWivxYRhtxZrLB', // kSOLBSOLOrca
    ];

    public function getDescription(): string
    {
        return 'Add market-closed context to the 25 Sep stock incidents; remove the fixed-price STALE incidents of 27–28 Sep';
    }

    public function up(Schema $schema): void
    {
        // Appends the context, keeping whatever else the incident recorded.
        foreach (self::MARKET_CLOSURES as [$address, $startedAt]) {
            $this->addSql(
                "UPDATE reserve_incident SET checks = (checks::jsonb || '[\"MARKET_CLOSED:info\"]'::jsonb)::json
                  WHERE address = :address AND started_at = :started AND NOT (checks::jsonb @> '[\"MARKET_CLOSED:info\"]'::jsonb)",
                ['address' => $address, 'started' => $startedAt],
            );
        }
        // Every STALE-only incident of these reserves, however often the old rule reopened it, up to
        // the deploy of fc89ff3 (28 Sep 2026); later incidents, recorded under the new rule, stay.
        $this->addSql(
            "DELETE FROM reserve_incident
              WHERE address IN (:a, :b, :c) AND checks::jsonb = '[\"STALE:critical\"]'::jsonb
                AND started_at >= '2026-09-27 00:00:00' AND started_at < '2026-09-29 00:00:00'",
            ['a' => self::FIXED_PRICE_RESERVES[0], 'b' => self::FIXED_PRICE_RESERVES[1], 'c' => self::FIXED_PRICE_RESERVES[2]],
        );
        // The change events that opened and closed those periods, so the history agrees with the log.
        // (Hourly samples stay: they record what was measured then.)
        $this->addSql(
            "DELETE FROM reserve_health_event
              WHERE address IN (:a, :b, :c)
                AND (checks::jsonb @> '[\"STALE:critical\"]'::jsonb OR previous_checks::jsonb @> '[\"STALE:critical\"]'::jsonb)
                AND occurred_at >= '2026-09-27 00:00:00' AND occurred_at < '2026-09-29 00:00:00'",
            ['a' => self::FIXED_PRICE_RESERVES[0], 'b' => self::FIXED_PRICE_RESERVES[1], 'c' => self::FIXED_PRICE_RESERVES[2]],
        );
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException('Removed incidents are not restored; they recorded a rule that no longer applies.');
    }
}
