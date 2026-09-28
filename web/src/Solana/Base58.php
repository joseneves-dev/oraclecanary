<?php

namespace App\Solana;

/**
 * Base58 (Bitcoin alphabet) as used for Solana addresses and keys. Works on bytes one digit at a
 * time, so it needs neither GMP nor BCMath; inputs are short (32-byte keys).
 */
final class Base58
{
    private const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    public static function encode(string $bytes): string
    {
        $digits = [];
        foreach (str_split($bytes) as $byte) {
            $carry = \ord($byte);
            foreach ($digits as $i => $digit) {
                $carry += $digit << 8;
                $digits[$i] = $carry % 58;
                $carry = intdiv($carry, 58);
            }
            for (; $carry > 0; $carry = intdiv($carry, 58)) {
                $digits[] = $carry % 58;
            }
        }

        $leadingZeros = \strlen($bytes) - \strlen(ltrim($bytes, "\0"));

        return str_repeat('1', $leadingZeros).implode('', array_map(static fn (int $d) => self::ALPHABET[$d], array_reverse($digits)));
    }

    /**
     * @throws \InvalidArgumentException when the text is not Base58
     */
    public static function decode(string $text): string
    {
        $bytes = [];
        foreach (str_split($text) as $char) {
            $carry = strpos(self::ALPHABET, $char);
            if ('' === $char || false === $carry) {
                throw new \InvalidArgumentException(\sprintf('"%s" is not Base58.', $text));
            }
            foreach ($bytes as $i => $byte) {
                $carry += $byte * 58;
                $bytes[$i] = $carry & 0xFF;
                $carry >>= 8;
            }
            for (; $carry > 0; $carry >>= 8) {
                $bytes[] = $carry & 0xFF;
            }
        }

        $leadingOnes = \strlen($text) - \strlen(ltrim($text, '1'));

        return str_repeat("\0", $leadingOnes).implode('', array_map('chr', array_reverse($bytes)));
    }

    /** Decodes a Solana public key (32 bytes). */
    public static function decodePublicKey(string $address): string
    {
        $bytes = self::decode($address);
        if (32 !== \strlen($bytes)) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a 32-byte public key.', $address));
        }

        return $bytes;
    }
}
