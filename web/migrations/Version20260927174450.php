<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260927174450 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP INDEX idx_lending_reserve_market');
        $this->addSql('DROP INDEX idx_lending_reserve_score');
        $this->addSql('CREATE INDEX idx_lending_reserve_protocol ON lending_reserve (protocol, checked_at)');
        $this->addSql('CREATE INDEX idx_lending_reserve_default_order ON lending_reserve (score, total_supply_usd, address)');
        $this->addSql('CREATE INDEX idx_lending_reserve_market ON lending_reserve (market)');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('DROP INDEX idx_lending_reserve_protocol');
        $this->addSql('DROP INDEX idx_lending_reserve_default_order');
        $this->addSql('DROP INDEX idx_lending_reserve_market');
        $this->addSql('CREATE INDEX idx_lending_reserve_score ON lending_reserve (score)');
        $this->addSql('CREATE INDEX idx_lending_reserve_market ON lending_reserve (protocol, market)');
    }
}
