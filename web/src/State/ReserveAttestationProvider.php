<?php

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\Model\Severity;
use App\ApiResource\ReserveAttestation;
use App\Attestation\AttestationSigner;
use App\Repository\LendingReserveRepository;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

/**
 * Signs the stored health of a reserve.
 *
 * @implements ProviderInterface<ReserveAttestation>
 */
final readonly class ReserveAttestationProvider implements ProviderInterface
{
    public function __construct(
        private LendingReserveRepository $reserves,
        private AttestationSigner $signer,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): ?ReserveAttestation
    {
        $reserve = $this->reserves->find($uriVariables['address'] ?? '');
        if (null === $reserve) {
            return null;
        }
        if (!$this->signer->isConfigured()) {
            throw new ServiceUnavailableHttpException(null, 'Attestation signing is not configured on this server.');
        }

        $severity = Severity::worstOf(array_column($reserve->getChecks(), 'severity'));
        // The indexer writes checked_at in UTC without a time zone.
        $issuedAt = new \DateTimeImmutable($reserve->getCheckedAt()->format('Y-m-d H:i:s'), new \DateTimeZone('UTC'));
        $message = AttestationSigner::encode($reserve->getAddress(), $reserve->getScore(), $severity, $reserve->getPriceAgeSeconds(), $issuedAt->getTimestamp());

        return new ReserveAttestation(
            $reserve->getAddress(),
            $reserve->getScore(),
            $severity,
            $reserve->getPriceAgeSeconds(),
            $issuedAt,
            base64_encode($message),
            base64_encode($this->signer->sign($message)),
            $this->signer->publicKey(),
        );
    }
}
