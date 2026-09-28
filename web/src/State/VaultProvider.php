<?php

namespace App\State;

use ApiPlatform\Metadata\CollectionOperationInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\Model\HealthCheck;
use App\ApiResource\Model\Severity;
use App\ApiResource\Model\VaultAllocation;
use App\ApiResource\Reserve;
use App\ApiResource\Vault;
use App\Entity\CuratorVault;
use App\Entity\LendingReserve;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Builds vaults with each allocation joined to its reserve's current health, loading every reserve
 * a page needs in one query.
 *
 * @implements ProviderInterface<Vault>
 */
final readonly class VaultProvider implements ProviderInterface
{
    public function __construct(
        private EntityManagerInterface $entityManager,
    ) {
    }

    /**
     * @return Vault|list<Vault>|null
     */
    public function provide(Operation $operation, array $uriVariables = [], array $context = []): Vault|array|null
    {
        $vaults = $this->entityManager->getRepository(CuratorVault::class);
        if ($operation instanceof CollectionOperationInterface) {
            $rows = $vaults->findBy([], ['totalUsd' => 'DESC', 'address' => 'ASC']);

            return $this->build($rows);
        }

        $row = $vaults->find($uriVariables['address'] ?? '');

        return $row ? $this->build([$row])[0] : null;
    }

    /**
     * @param list<CuratorVault> $rows
     *
     * @return list<Vault>
     */
    private function build(array $rows): array
    {
        $addresses = array_values(array_unique(array_merge(...array_map(
            static fn (CuratorVault $v) => array_column($v->getAllocations(), 'reserve'),
            $rows,
        ) ?: [[]])));
        $repository = $this->entityManager->getRepository(LendingReserve::class);
        $reserves = [];
        foreach ($addresses ? $repository->findBy(['address' => $addresses]) : [] as $reserve) {
            $reserves[$reserve->getAddress()] = $reserve;
        }

        // Every reserve of the markets the vaults lend into: the collateral their loans are made against.
        $markets = array_values(array_unique(array_map(static fn (LendingReserve $r) => $r->getMarket(), $reserves)));
        $byMarket = [];
        foreach ($markets ? $repository->findBy(['market' => $markets]) : [] as $reserve) {
            $byMarket[$reserve->getMarket()][] = $reserve;
        }

        return array_map(fn (CuratorVault $v) => $this->vault($v, $reserves, $byMarket), $rows);
    }

    /**
     * @param array<string, LendingReserve>       $reserves
     * @param array<string, list<LendingReserve>> $byMarket
     */
    private function vault(CuratorVault $vault, array $reserves, array $byMarket): Vault
    {
        $total = $vault->getTotalUsd();
        $allocations = [];
        $atRiskUsd = $warningUsd = 0.0;
        $worst = Severity::Ok;

        foreach ($vault->getAllocations() as ['reserve' => $address, 'usd' => $usd]) {
            $reserve = $reserves[$address] ?? null;
            // A reserve the indexer does not check (hidden by the protocol, or closed) has an unknown state.
            $checks = $reserve ? Reserve::toChecks($reserve->getChecks()) : [];
            $severity = $reserve ? self::severity($checks) : Severity::Warning;
            $collateralIssues = $reserve ? self::collateralIssues($reserve, $byMarket[$reserve->getMarket()] ?? []) : [];

            if (Severity::Critical === $severity || $collateralIssues) {
                $atRiskUsd += $usd;
            } elseif (Severity::Warning === $severity) {
                $warningUsd += $usd;
            }
            foreach ([$severity, $collateralIssues ? Severity::Critical : Severity::Ok] as $s) {
                if ($s->rank() > $worst->rank()) {
                    $worst = $s;
                }
            }

            $allocations[] = new VaultAllocation(
                $address,
                $reserve?->getAsset() ?? '',
                $reserve?->getMarketName(),
                $usd,
                $total > 0 ? $usd / $total : 0.0,
                $severity,
                $reserve?->getScore(),
                $reserve ? self::mainIssue($checks) : 'Not monitored: the protocol has hidden or closed this reserve.',
                $collateralIssues,
            );
        }

        return new Vault(
            $vault->getAddress(),
            $vault->getName(),
            $vault->getCurator(),
            $vault->getToken(),
            $total,
            $vault->getIdleUsd(),
            $atRiskUsd,
            $warningUsd,
            $worst,
            $allocations,
            new \DateTimeImmutable($vault->getCheckedAt()->format('Y-m-d H:i:s'), new \DateTimeZone('UTC')),
        );
    }

    /** Collateral issues listed per allocation; the rest are summarised in a count. */
    private const MAX_COLLATERAL_ISSUES = 3;

    /** Collateral worth less than this cannot back loans large enough to put a vault at risk. */
    private const MIN_COLLATERAL_USD = 10_000;

    /**
     * Critical checks of the other reserves in the same market, as "ASSET: message". Only critical
     * ones count: warnings such as a missing fallback are too common to single out a market. Dust
     * reserves are left out, and so is a stock whose price is only stale because its market is closed
     * (MARKET_CLOSED): that is expected, and not an oracle failure.
     *
     * @param list<LendingReserve> $market
     *
     * @return list<string>
     */
    private static function collateralIssues(LendingReserve $lent, array $market): array
    {
        $issues = [];
        foreach ($market as $other) {
            if ($other->getAddress() === $lent->getAddress() || $other->getTotalSupplyUsd() < self::MIN_COLLATERAL_USD) {
                continue;
            }
            foreach (self::withoutMarketClosure(Reserve::toChecks($other->getChecks())) as $check) {
                if (Severity::Critical === $check->severity) {
                    $issues[] = ['usd' => $other->getTotalSupplyUsd(), 'text' => \sprintf('%s: %s', $other->getAsset() ?: $other->getAddress(), $check->message)];
                    break;
                }
            }
        }
        usort($issues, static fn (array $a, array $b) => $b['usd'] <=> $a['usd']);
        $texts = array_column(\array_slice($issues, 0, self::MAX_COLLATERAL_ISSUES), 'text');
        if (\count($issues) > self::MAX_COLLATERAL_ISSUES) {
            $texts[] = \sprintf('and %d more', \count($issues) - self::MAX_COLLATERAL_ISSUES);
        }

        return $texts;
    }

    /**
     * A stock whose price is only stale because its market is closed (MARKET_CLOSED) is expected, not an
     * oracle failure: its STALE check does not count towards a vault's risk, whether the vault lends
     * into that reserve or lends against it as collateral.
     *
     * @param list<HealthCheck> $checks
     *
     * @return list<HealthCheck>
     */
    private static function withoutMarketClosure(array $checks): array
    {
        if (!array_any($checks, static fn (HealthCheck $c) => 'MARKET_CLOSED' === $c->code)) {
            return $checks;
        }

        return array_values(array_filter($checks, static fn (HealthCheck $c) => 'STALE' !== $c->code));
    }

    /** @param list<HealthCheck> $checks */
    private static function severity(array $checks): Severity
    {
        return Severity::worstOf(array_map(static fn (HealthCheck $c) => $c->severity->value, self::withoutMarketClosure($checks)));
    }

    /**
     * The message a reader should see first: the most severe check.
     *
     * @param list<HealthCheck> $checks
     */
    private static function mainIssue(array $checks): ?string
    {
        usort($checks, static fn (HealthCheck $a, HealthCheck $b) => $b->severity->rank() <=> $a->severity->rank());

        return $checks[0]->message ?? null;
    }
}
