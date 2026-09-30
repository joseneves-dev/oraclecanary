<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * A wallet a Telegram user asked to be alerted about, and what they were last told.
 *
 * Written by the indexer's Telegram bot (/watch, /unwatch) and its wallet checker; the API only
 * reads totals from it (how many wallets are watched and the value they hold).
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uniq_wallet_watch_chat_wallet', columns: ['chat_id', 'wallet'])]
#[ORM\Index(name: 'idx_wallet_watch_wallet', columns: ['wallet'])]
class WalletWatch
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: Types::BIGINT)]
    private string $id;

    /** Telegram chat the alerts go to (a private chat with the bot). */
    #[ORM\Column(type: Types::BIGINT)]
    private string $chatId;

    /** Solana wallet address. */
    #[ORM\Column(length: 44)]
    private string $wallet;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    /** @var list<string> Loan accounts held up at the last check, as "account:state:blockers", to alert only on changes. */
    #[ORM\Column(type: Types::JSON)]
    private array $lastState = [];

    /** Deposits plus loans at the last check, in USD: the value under watch. */
    #[ORM\Column(type: Types::FLOAT, nullable: true)]
    private ?float $lastUsd = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $lastCheckedAt = null;

    public function getWallet(): string
    {
        return $this->wallet;
    }

    public function getLastUsd(): ?float
    {
        return $this->lastUsd;
    }
}
