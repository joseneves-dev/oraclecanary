<?php

namespace App\Mcp;

use Symfony\Component\DependencyInjection\Attribute\Target;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/**
 * Rate-limits the MCP endpoint before the MCP server runs: every request per visitor, and new
 * sessions (initialize) per visitor and in total. Over the limit, the answer is an HTTP 429 carrying
 * a JSON-RPC error, with Retry-After.
 */
final readonly class RateLimitListener
{
    public const ROUTE = '_mcp_endpoint_oraclecanary';

    public function __construct(
        #[Target('mcp_requests')]
        private RateLimiterFactoryInterface $requests,
        #[Target('mcp_sessions')]
        private RateLimiterFactoryInterface $sessions,
        #[Target('mcp_sessions_global')]
        private RateLimiterFactoryInterface $sessionsGlobal,
    ) {
    }

    // After routing (32), which sets _route, and before the firewall (8).
    #[AsEventListener(KernelEvents::REQUEST, priority: 16)]
    public function onRequest(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if (!$event->isMainRequest() || self::ROUTE !== $request->attributes->get('_route') || $request->isMethod('OPTIONS')) {
            return;
        }

        $visitor = Visitor::of($request);
        $limit = $this->requests->create($visitor)->consume();
        if ($limit->isAccepted() && self::isInitialize($request)) {
            $session = $this->sessions->create($visitor)->consume();
            $limit = $session->isAccepted() ? $this->sessionsGlobal->create('all')->consume() : $session;
        }

        if (!$limit->isAccepted()) {
            $event->setResponse(self::tooManyRequests($request, $limit));
        }
    }

    private static function isInitialize(Request $request): bool
    {
        if (!$request->isMethod('POST')) {
            return false;
        }
        $message = json_decode($request->getContent(), true);
        // A JSON-RPC batch (older protocol revisions) counts if any of its messages is an initialize.
        $messages = \is_array($message) && array_is_list($message) ? $message : [$message];
        foreach ($messages as $one) {
            if (\is_array($one) && 'initialize' === ($one['method'] ?? null)) {
                return true;
            }
        }

        return false;
    }

    private static function tooManyRequests(Request $request, RateLimit $limit): JsonResponse
    {
        $retryAfter = max(1, $limit->getRetryAfter()->getTimestamp() - time());
        $message = json_decode($request->getContent(), true);
        $id = \is_array($message) && (\is_int($message['id'] ?? null) || \is_string($message['id'] ?? null)) ? $message['id'] : null;

        return new JsonResponse([
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => [
                'code' => -32000,
                'message' => \sprintf('Too many requests to the OracleCanary MCP server. Retry in %d seconds.', $retryAfter),
                'data' => ['retryAfterSeconds' => $retryAfter],
            ],
        ], JsonResponse::HTTP_TOO_MANY_REQUESTS, [
            'Retry-After' => (string) $retryAfter,
            'X-RateLimit-Limit' => (string) $limit->getLimit(),
            'X-RateLimit-Remaining' => (string) $limit->getRemainingTokens(),
        ]);
    }
}
