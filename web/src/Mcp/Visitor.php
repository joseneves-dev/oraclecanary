<?php

namespace App\Mcp;

use Symfony\Component\HttpFoundation\Request;

/**
 * Who is calling, for rate limits: the visitor as Cloudflare reports it, else the peer address.
 *
 * Someone reaching the server without Cloudflare can fake the header; the global limits still cover
 * that, as in the positions service.
 */
final class Visitor
{
    public static function of(Request $request): string
    {
        return $request->headers->get('CF-Connecting-IP') ?? $request->getClientIp() ?? 'unknown';
    }
}
