<?php

namespace App\ApiResource\Model;

enum Severity: string
{
    case Ok = 'ok';
    case Info = 'info';
    case Warning = 'warning';
    case Critical = 'critical';

    /**
     * Reads a severity stored by the indexer. An unknown value means something is wrong, so it is
     * reported as a warning rather than silently as healthy.
     */
    public static function fromStored(mixed $value): self
    {
        return \is_string($value) ? (self::tryFrom($value) ?? self::Warning) : self::Warning;
    }

    /**
     * @param list<mixed> $severities
     */
    public static function worstOf(array $severities): self
    {
        $worst = self::Ok;
        foreach ($severities as $value) {
            $severity = self::fromStored($value);
            if ($severity->rank() > $worst->rank()) {
                $worst = $severity;
            }
        }

        return $worst;
    }

    private function rank(): int
    {
        return match ($this) {
            self::Ok => 0,
            self::Info => 1,
            self::Warning => 2,
            self::Critical => 3,
        };
    }
}
