<?php

namespace App\Validator;

use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Constraints\Compound;

/**
 * An ISO 8601 date-time in UTC, e.g. 2026-09-27T00:00:00Z.
 *
 * Date filters compare the value with UTC columns as written, so any other offset would silently
 * shift the range.
 */
#[\Attribute]
final class UtcDateTime extends Compound
{
    protected function getConstraints(array $options): array
    {
        return [
            new Assert\Type('string'),
            new Assert\DateTime(format: \DateTimeInterface::ATOM),
            new Assert\Regex(pattern: '/(Z|[+-]00:?00)$/', message: 'Use a UTC time, e.g. 2026-09-27T00:00:00Z.'),
        ];
    }
}
