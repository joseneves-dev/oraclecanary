<?php

namespace App\ApiResource\Model;

/**
 * A failed check as recorded in history: its code and severity, without the message.
 */
final readonly class CheckState
{
    public function __construct(
        public string $code,
        public Severity $severity,
    ) {
    }

    /**
     * Reads the "CODE:severity" strings the indexer stores in history.
     *
     * @return list<self>
     */
    public static function listFromStored(mixed $checks): array
    {
        if (!\is_array($checks)) {
            return [];
        }

        return array_values(array_map(static function (mixed $key): self {
            [$code, $severity] = explode(':', \is_string($key) ? $key : '', 2) + [1 => null];

            return new self('' !== $code ? $code : 'UNKNOWN', Severity::fromStored($severity));
        }, $checks));
    }
}
