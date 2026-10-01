<?php

namespace App\State;

use ApiPlatform\Metadata\CollectionOperationInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\LendingRate;
use App\ApiResource\Model\HealthCheck;
use App\ApiResource\Model\LentAgainst;
use App\ApiResource\Model\MarketRef;
use App\ApiResource\Model\Severity;
use App\ApiResource\Reserve;
use App\Entity\LendingEarnPool;
use App\Entity\LendingReserve;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Builds the supply pools with their rates and the oracle facts of the collateral they are lent
 * against, from every listed reserve and Jupiter Lend vault in two queries.
 *
 * @implements ProviderInterface<LendingRate>
 */
final readonly class LendingRateProvider implements ProviderInterface
{
    /** Jupiter Lend runs every vault in one program, shown as one market. */
    private const JUPITER_LEND_MARKET = 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi';

    /** Collateral worth less than this is too small to count as a critical issue of a pool. */
    private const MIN_CRITICAL_USD = 10_000;

    private const MAX_CRITICAL_ASSETS = 5;

    /** A supply APY under 0.01% means next to nothing of the deposits is lent out. */
    private const MIN_SUPPLY_APY = 0.0001;

    /** Checks that make a protocol refuse a price (as in ui/src/lib/priceState.ts). */
    private const BLOCKING = ['STALE', 'NO_ORACLE', 'EMPTY_PRICE_ENTRY', 'DEPRECATED_PROVIDER'];

    /** Collateral whose price has none of these has a fallback. */
    private const NO_FALLBACK_CODES = ['NO_FALLBACK', 'FIXED_PRICE', 'NO_ORACLE', 'UNREADABLE_ORACLE'];

    public function __construct(private EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return LendingRate|list<LendingRate>|null
     */
    public function provide(Operation $operation, array $uriVariables = [], array $context = []): LendingRate|array|null
    {
        $pools = $this->build();
        if ($operation instanceof CollectionOperationInterface) {
            return $pools;
        }

        foreach ($pools as $pool) {
            if ($pool->address === ($uriVariables['address'] ?? null)) {
                return $pool;
            }
        }

        return null;
    }

    /** @return list<LendingRate> */
    private function build(): array
    {
        $reserves = $this->entityManager->getRepository(LendingReserve::class)
            ->createQueryBuilder('r')
            ->where('r.status = :active')
            ->andWhere('r.marketName IS NOT NULL')
            ->setParameter('active', 'active')
            ->getQuery()
            ->getResult();

        /** @var array<string, list<LendingReserve>> $byMarket */
        $byMarket = [];
        /** @var array<string, list<LendingReserve>> $vaultsByBorrowMint */
        $vaultsByBorrowMint = [];
        foreach ($reserves as $reserve) {
            if ('jupiter-lend' === $reserve->getProtocol()) {
                if (null !== $reserve->getBorrowMint()) {
                    $vaultsByBorrowMint[$reserve->getBorrowMint()][] = $reserve;
                }
            } else {
                $byMarket[$reserve->getProtocol().':'.$reserve->getMarket()][] = $reserve;
            }
        }

        $pools = [];
        foreach ($reserves as $reserve) {
            // A reserve is a supply pool when its protocol reports depositors earning something, which
            // means its deposits are being lent; reserves that only hold collateral earn nothing. Jupiter
            // Lend vaults are borrowing positions, whose lenders are the Earn pools.
            if ('jupiter-lend' === $reserve->getProtocol() || ($reserve->getSupplyApy() ?? 0.0) < self::MIN_SUPPLY_APY) {
                continue;
            }
            $others = array_values(array_filter(
                $byMarket[$reserve->getProtocol().':'.$reserve->getMarket()] ?? [],
                static fn (LendingReserve $r) => $r->getAddress() !== $reserve->getAddress() && 0.0 !== $r->getMaxLtv(),
            ));
            $pools[] = $this->fromReserve($reserve, self::lentAgainst('market', $others));
        }

        foreach ($this->entityManager->getRepository(LendingEarnPool::class)->findAll() as $earn) {
            $pools[] = $this->fromEarnPool($earn, self::lentAgainst('vaults', $vaultsByBorrowMint[$earn->getMint()] ?? []));
        }

        usort($pools, static fn (LendingRate $a, LendingRate $b) => $b->totalSupplyUsd <=> $a->totalSupplyUsd ?: strcmp($a->address, $b->address));

        return $pools;
    }

    private function fromReserve(LendingReserve $reserve, LentAgainst $lentAgainst): LendingRate
    {
        $checks = Reserve::toChecks($reserve->getChecks());
        $severity = Reserve::toSeverity($reserve->getChecks());

        return new LendingRate(
            $reserve->getAddress(),
            $reserve->getProtocol(),
            'reserve',
            new MarketRef($reserve->getMarket(), $reserve->getMarketName()),
            $reserve->getAsset(),
            $reserve->getMint(),
            $reserve->getSupplyApy(),
            $reserve->getBorrowApy(),
            null,
            $reserve->getRateSource(),
            self::utc($reserve->getRateAt()),
            $reserve->getTotalSupplyUsd(),
            $reserve->getScore(),
            $severity,
            self::healthState($checks, $severity),
            array_values(array_filter($reserve->getProviders(), 'is_string')),
            array_values(array_unique(array_map(static fn (HealthCheck $c) => $c->code, $checks))),
            $lentAgainst,
            self::utc($reserve->getCheckedAt()),
        );
    }

    private function fromEarnPool(LendingEarnPool $earn, LentAgainst $lentAgainst): LendingRate
    {
        return new LendingRate(
            $earn->getAddress(),
            'jupiter-lend',
            'earn',
            new MarketRef(self::JUPITER_LEND_MARKET, 'Jupiter Lend Earn'),
            $earn->getAsset(),
            $earn->getMint(),
            $earn->getSupplyApy(),
            null,
            $earn->getRewardsApy(),
            $earn->getRateSource(),
            self::utc($earn->getRateAt()),
            $earn->getTotalSupplyUsd(),
            null,
            null,
            null,
            [],
            [],
            $lentAgainst,
            self::utc($earn->getCheckedAt()),
        );
    }

    /** @param list<LendingReserve> $collateral */
    private static function lentAgainst(string $basis, array $collateral): LentAgainst
    {
        $total = $withFallback = $singleFeed = $fixed = $marketHours = $windingDown = $criticalUsd = 0.0;
        $critical = [];
        foreach ($collateral as $reserve) {
            $usd = max(0.0, $reserve->getTotalSupplyUsd());
            $checks = Reserve::toChecks($reserve->getChecks());
            $codes = array_map(static fn (HealthCheck $c) => $c->code, $checks);
            $total += $usd;
            if (\in_array('FIXED_PRICE', $codes, true)) {
                $fixed += $usd;
            } elseif (\in_array('NO_FALLBACK', $codes, true)) {
                $singleFeed += $usd;
            }
            if (!array_intersect(self::NO_FALLBACK_CODES, $codes)) {
                $withFallback += $usd;
            }
            if ($reserve->isMarketHours()) {
                $marketHours += $usd;
            }
            if (\in_array('WINDING_DOWN', $codes, true)) {
                $windingDown += $usd;
            }
            $severity = Reserve::toSeverity($reserve->getChecks());
            if ($usd >= self::MIN_CRITICAL_USD && 'critical' === self::healthState($checks, $severity)) {
                $criticalUsd += $usd;
                $critical[] = ['usd' => $usd, 'asset' => $reserve->getAsset() ?: $reserve->getAddress()];
            }
        }
        usort($critical, static fn (array $a, array $b) => $b['usd'] <=> $a['usd']);
        $share = static fn (float $part) => $total > 0 ? $part / $total : 0.0;

        return new LentAgainst(
            $basis,
            $total,
            \count($collateral),
            $share($withFallback),
            $share($singleFeed),
            $share($fixed),
            $share($marketHours),
            $share($windingDown),
            \count($critical),
            $criticalUsd,
            array_values(array_unique(array_column(\array_slice($critical, 0, self::MAX_CRITICAL_ASSETS), 'asset'))),
        );
    }

    /**
     * The reserve's severity, or "paused" when its price is only refused because a stock's market is
     * closed: the same rule as the app's healthState() (ui/src/lib/priceState.ts).
     *
     * @param list<HealthCheck> $checks
     */
    private static function healthState(array $checks, Severity $severity): string
    {
        if (Severity::Critical !== $severity || !array_any($checks, static fn (HealthCheck $c) => 'MARKET_CLOSED' === $c->code)) {
            return $severity->value;
        }
        $blocking = array_filter($checks, static fn (HealthCheck $c) => Severity::Critical === $c->severity && \in_array($c->code, self::BLOCKING, true));

        return $blocking && array_all($blocking, static fn (HealthCheck $c) => 'STALE' === $c->code) ? 'paused' : $severity->value;
    }

    /** Stored times are UTC without a zone. */
    private static function utc(?\DateTimeImmutable $value): ?\DateTimeImmutable
    {
        return $value ? new \DateTimeImmutable($value->format('Y-m-d H:i:s'), new \DateTimeZone('UTC')) : null;
    }
}
