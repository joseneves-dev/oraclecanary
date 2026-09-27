<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260927214750 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Alert state per reserve; event indexes with the id tiebreak';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE reserve_health_state (address VARCHAR(44) NOT NULL, protocol VARCHAR(32) NOT NULL, reported_score SMALLINT NOT NULL, reported_checks JSON NOT NULL, pending_checks JSON DEFAULT NULL, pending_score SMALLINT DEFAULT NULL, pending_since TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, last_seen_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (address))');
        $this->addSql('CREATE INDEX idx_reserve_health_state_protocol ON reserve_health_state (protocol, last_seen_at)');
        $this->addSql('DROP INDEX idx_reserve_health_event_occurred');
        $this->addSql('DROP INDEX idx_reserve_health_event_reserve');
        $this->addSql('CREATE INDEX idx_reserve_health_event_protocol ON reserve_health_event (protocol, occurred_at, id)');
        $this->addSql('CREATE INDEX idx_reserve_health_event_occurred ON reserve_health_event (occurred_at, id)');
        $this->addSql('CREATE INDEX idx_reserve_health_event_reserve ON reserve_health_event (address, occurred_at, id)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP TABLE reserve_health_state');
        $this->addSql('DROP INDEX idx_reserve_health_event_occurred');
        $this->addSql('DROP INDEX idx_reserve_health_event_protocol');
        $this->addSql('DROP INDEX idx_reserve_health_event_reserve');
        $this->addSql('CREATE INDEX idx_reserve_health_event_occurred ON reserve_health_event (occurred_at)');
        $this->addSql('CREATE INDEX idx_reserve_health_event_reserve ON reserve_health_event (address, occurred_at)');
    }
}
