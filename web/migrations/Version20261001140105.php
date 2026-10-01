<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Lending rates on reserves, and Jupiter Lend Earn pools.
 */
final class Version20261001140105 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Lending rates: supply and borrow APY, max LTV and their source on lending_reserve, the borrowed token of Jupiter Lend vaults, a market-hours flag, and Jupiter Lend Earn pools';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE lending_earn_pool (address VARCHAR(44) NOT NULL, asset VARCHAR(64) NOT NULL, mint VARCHAR(44) NOT NULL, supply_apy DOUBLE PRECISION NOT NULL, rewards_apy DOUBLE PRECISION NOT NULL, total_supply_usd DOUBLE PRECISION NOT NULL, rate_source VARCHAR(32) NOT NULL, rate_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, checked_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (address))');
        $this->addSql('ALTER TABLE lending_reserve ADD borrow_mint VARCHAR(44) DEFAULT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD market_hours BOOLEAN DEFAULT false NOT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD supply_apy DOUBLE PRECISION DEFAULT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD borrow_apy DOUBLE PRECISION DEFAULT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD max_ltv DOUBLE PRECISION DEFAULT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD rate_source VARCHAR(32) DEFAULT NULL');
        $this->addSql('ALTER TABLE lending_reserve ADD rate_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE lending_earn_pool');
        $this->addSql('ALTER TABLE lending_reserve DROP borrow_mint');
        $this->addSql('ALTER TABLE lending_reserve DROP market_hours');
        $this->addSql('ALTER TABLE lending_reserve DROP supply_apy');
        $this->addSql('ALTER TABLE lending_reserve DROP borrow_apy');
        $this->addSql('ALTER TABLE lending_reserve DROP max_ltv');
        $this->addSql('ALTER TABLE lending_reserve DROP rate_source');
        $this->addSql('ALTER TABLE lending_reserve DROP rate_at');
    }
}
