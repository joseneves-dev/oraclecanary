<?php

namespace App\ApiResource\Model;

enum Severity: string
{
    case Ok = 'ok';
    case Info = 'info';
    case Warning = 'warning';
    case Critical = 'critical';

    /**
     * @param list<string> $severities
     */
    public static function worstOf(array $severities): self
    {
        $worst = self::Ok;
        foreach ($severities as $value) {
            $severity = self::tryFrom($value) ?? self::Ok;
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
