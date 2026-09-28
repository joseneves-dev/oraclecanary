<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Kamino curator vaults and their allocations, written by the indexer.
 */
final class Version20260928170804 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Curator vaults and how their deposits are spread across reserves';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE curator_vault (address VARCHAR(44) NOT NULL, name VARCHAR(80) NOT NULL, curator VARCHAR(40) DEFAULT NULL, token_mint VARCHAR(44) NOT NULL, token VARCHAR(64) DEFAULT NULL, total_usd DOUBLE PRECISION NOT NULL, idle_usd DOUBLE PRECISION NOT NULL, allocations JSON NOT NULL, checked_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (address))');
        $this->addSql('CREATE INDEX idx_curator_vault_total ON curator_vault (total_usd, address)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE curator_vault');
    }
}
