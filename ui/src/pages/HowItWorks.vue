<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * What OracleCanary reads, how it judges a price, and what it does with the result. Written for
 * someone checking whether to trust the numbers; every figure here matches the code (health.ts,
 * run.ts, notify.ts, onchain/).
 */

const REPO = 'https://github.com/joseneves-dev/oraclecanary'
const GUARD = '444eBJsPgQGT6QfKtESvd21vZQa4YFsuKTodCokTasTT'
const DEMO_VAULT = 'HGjvgPmovhBCeXVUrtNkrdQn1LadW6dyKo52A6MnhMi4'
const explorer = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`

type Level = 'Critical' | 'Warning' | 'Info' | 'Context'
/** What each level costs the 0–100 score (PENALTY and NO_PENALTY in health.ts). */
const COST: Record<Level, string> = { Critical: '−50', Warning: '−15', Info: '−5', Context: '0' }

const CHECKS: { label: string; severity: Level; trigger: string; meaning: string }[] = [
  { label: 'Stale price', severity: 'Critical', trigger: 'The price is older than the protocol’s own age limit.', meaning: 'The protocol rejects it: borrowing, withdrawals and liquidations that need it fail.' },
  { label: 'No oracle', severity: 'Critical', trigger: 'No price source is configured, or the price chain reads none.', meaning: 'Nothing can price the reserve.' },
  { label: 'Empty price entry', severity: 'Critical', trigger: 'The price depends on a Scope entry that is not configured.', meaning: 'The price cannot be worked out.' },
  { label: 'Shut-down oracle', severity: 'Critical', trigger: 'The only source is a provider that has shut down (Switchboard, 25 Sep 2026). A warning when a live source backs it up.', meaning: 'The price no longer follows the market.' },
  {
    label: 'Price far from the market',
    severity: 'Critical',
    trigger:
      'The oracle price is 10% or more above a liquid market price on Jupiter, or 50% above a thinner one with $25K of liquidity. From 3% above or 3% below it is a warning; a fixed price below the market, or any gap on a bank being wound down, is information. Reserves under $1K are skipped.',
    meaning: 'Above the market, collateral is overvalued; below it, borrowers can be liquidated early. Published from October 2026.',
  },
  { label: 'Sources disagree', severity: 'Critical', trigger: 'A reserve’s price sources differ by more than the protocol allows. A warning from half of that limit.', meaning: 'Sources that should agree do not, so at least one is off.' },
  { label: 'No fallback oracle', severity: 'Warning', trigger: 'A single feed with no backup.', meaning: 'If it stops, the price stops.' },
  { label: 'Close to stale', severity: 'Warning', trigger: 'The price is past 80% of the protocol’s age limit.', meaning: 'A little more delay and the protocol rejects it.' },
  { label: 'Oracle not readable', severity: 'Warning', trigger: 'OracleCanary could not read this oracle, or does not analyse its kind yet.', meaning: 'OracleCanary cannot vouch for the price.' },
  { label: 'Pyth unsure of the price', severity: 'Warning', trigger: 'Pyth’s confidence interval is wider than 2% of the price (usually far below 0.1%).', meaning: 'Pyth itself is unsure what the price is.' },
  { label: 'Fixed price', severity: 'Info', trigger: 'A fixed value set by the protocol.', meaning: 'It never goes stale but does not follow the market, so it is checked against the market instead.' },
  { label: 'Market hours', severity: 'Context', trigger: 'A tokenized stock whose feed follows US market hours, stale while the market is closed.', meaning: 'Expected, but the protocol still rejects the price until the market reopens.' },
  { label: 'Winding down', severity: 'Context', trigger: 'A marginfi bank that takes no new deposits or borrows and counts for no collateral.', meaning: 'Its price backs no borrowing.' },
]
</script>

<template>
  <!-- One root: the layout pads every top-level block, which would stack the spacing. -->
  <div class="page">
    <div class="ax-page-head">
      <div class="ax-page-head__row">
        <div>
          <h1 class="ax-page-head__title">How it works</h1>
          <p class="ax-page-head__subtitle">The methodology: what OracleCanary reads, the rules it judges a price by, and what it does when one breaks.</p>
        </div>
      </div>
    </div>

    <div class="ax-dash-grid">
      <section class="ax-card ax-col--12" aria-labelledby="reads">
        <div class="ax-card__header">
          <div class="ax-card__titles"><h2 id="reads" class="ax-card__title">1. It reads the chain, not a dashboard</h2></div>
        </div>
        <div class="ax-card__body prose">
          <p>
            Every 5 minutes OracleCanary reads, straight from Solana mainnet, the configuration and the oracle accounts behind every reserve of
            Kamino, every bank of marginfi and every vault of Jupiter Lend. For each one it follows the price back to the oracles it really depends
            on (Pyth, Chainlink, Switchboard, Scope chains and their fallbacks) and compares what it finds with the protocol's own rules, such as
            how old a price may be.
          </p>
          <p>
            Headline numbers count only <b>listed markets</b>: those shown in each protocol's own app (Kamino's listed markets, marginfi's main
            group, every Jupiter Lend vault). Anyone can create an unlisted market with arbitrary tokens and prices, so those are tracked but kept
            apart.
          </p>
        </div>
      </section>

      <section class="ax-card ax-col--12" aria-labelledby="checks">
        <div class="ax-card__header">
          <div class="ax-card__titles">
            <h2 id="checks" class="ax-card__title">2. The checks and the score</h2>
            <p class="ax-card__subtitle">
              Each reserve starts at 100 and loses points for every check it fails, down to 0; its level is its worst check. Both are worked
              out every 5 minutes, and for listed markets the worst of each hour is kept as history. The rules are in
              <a :href="`${REPO}/blob/main/indexer/src/health.ts`" target="_blank" rel="noopener">health.ts</a>.
            </p>
          </div>
        </div>
        <div class="ax-table-wrap">
          <table class="ax-table">
            <thead class="ax-table__head">
              <tr>
                <th scope="col" class="ax-table__th">Check</th>
                <th scope="col" class="ax-table__th">Level</th>
                <th scope="col" class="ax-table__th">Triggers when</th>
                <th scope="col" class="ax-table__th">What it means</th>
                <th scope="col" class="ax-table__th ax-table__th--num">Score</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in CHECKS" :key="c.label" class="ax-table__row">
                <td class="ax-table__td name">{{ c.label }}</td>
                <td class="ax-table__td">
                  <span
                    class="ax-badge ax-badge--soft ax-badge--pill"
                    :class="{
                      'ax-badge--danger': c.severity === 'Critical',
                      'ax-badge--warning': c.severity === 'Warning',
                      'ax-badge--neutral': c.severity === 'Info',
                      'ax-badge--outline': c.severity === 'Context',
                    }"
                    >{{ c.severity }}</span
                  >
                </td>
                <td class="ax-table__td meaning">{{ c.trigger }}</td>
                <td class="ax-table__td meaning">{{ c.meaning }}</td>
                <td class="ax-table__td ax-table__td--num nowrap">{{ COST[c.severity] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="ax-card ax-col--6" aria-labelledby="acts">
        <div class="ax-card__header">
          <div class="ax-card__titles"><h2 id="acts" class="ax-card__title">3. When a price breaks</h2></div>
        </div>
        <div class="ax-card__body prose">
          <p>
            A critical issue that lasts a few minutes opens an <RouterLink :to="{ name: 'incidents' }">incident</RouterLink>, with its start, end
            and the money exposed. Reserves holding $10K or more also get an alert on
            <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Telegram</a>, and a daily summary is posted there at 14:00 UTC.
          </p>
          <p>
            A new listing, or a change to how a listed reserve is priced (another feed, Scope chain or provider, another age limit), is
            recorded under <RouterLink :to="{ name: 'incidents' }">Configuration changes</RouterLink>. New listings, and changes to reserves
            holding $10K or more, are posted on Telegram.
          </p>
          <p>
            <RouterLink :to="{ name: 'positions' }">My positions</RouterLink> applies the same checks to one wallet: a price the protocol cannot use
            holds up the whole loan account, so it cannot borrow, withdraw or be liquidated.
          </p>
          <p>Findings about specific reserves are shared privately with the protocol's team before they are published.</p>
        </div>
      </section>

      <section class="ax-card ax-col--6" aria-labelledby="guard">
        <div class="ax-card__header">
          <div class="ax-card__titles"><h2 id="guard" class="ax-card__title">4. An on-chain guard (devnet)</h2></div>
        </div>
        <div class="ax-card__body prose">
          <p>
            OracleCanary signs each reserve's latest health as a small attestation. A Solana program can include it in a transaction and call
            <code>oracle_guard</code>, which checks the signature, the reserve and how recent it is, and refuses to go on when the health is worse
            than the program allows. That turns a warning into a circuit breaker.
          </p>
          <p>For a client, adding it to any transaction is one call:</p>
          <pre class="snippet"><code>const ixs = await withOracleGuard([borrowIx], {
    reserves: [collateralReserve, debtReserve],
    maxSeverity: 'warning', // refuse any price with a critical issue; single-source prices pass
  })</code></pre>
          <ul class="links">
            <li>
              <a :href="explorer(GUARD)" target="_blank" rel="noopener">oracle_guard on Solana Explorer (devnet)</a>
            </li>
            <li>
              <a :href="explorer(DEMO_VAULT)" target="_blank" rel="noopener">demo_vault</a>, a mock vault that calls the guard before a deposit
            </li>
            <li><a :href="`${REPO}/tree/main/onchain`" target="_blank" rel="noopener">Source, the withOracleGuard helper and the attestation format</a></li>
          </ul>
          <p class="muted">Live on devnet only; nothing is on mainnet.</p>
        </div>
      </section>

      <section class="ax-card ax-col--12" aria-labelledby="open">
        <div class="ax-card__body prose open">
          <h2 id="open" class="ax-card__title">Open source and free</h2>
          <p>
            The indexer, the API and the guard are open source under the MIT license, and the
            <a href="/api/docs" target="_blank" rel="noopener">public API</a> (JSON, with CSV for reserves and incidents) is free to use.
            <a :href="REPO" target="_blank" rel="noopener">Code on GitHub</a> ·
            <a href="https://x.com/OracleCanary_" target="_blank" rel="noopener">@OracleCanary_ on X</a> ·
            <a href="mailto:hello@oraclecanary.com">hello@oraclecanary.com</a>
          </p>
        </div>
      </section>

      <section class="ax-card ax-col--12 cta" aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title" class="cta__title">See it live</h2>
          <p class="cta__text">Health scores, open incidents and oracle exposure for every listed reserve, checked every 5 minutes.</p>
        </div>
        <div class="cta__actions">
          <RouterLink class="ax-btn ax-btn--secondary" :to="{ name: 'positions' }">Check a wallet</RouterLink>
          <RouterLink class="ax-btn ax-btn--primary" :to="{ name: 'overview' }">Open the dashboard</RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Card subtitles stay at a readable line length. */
.ax-card__subtitle {
  max-width: 72ch;
}
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ax-space-6);
}
.page > .ax-page-head {
  margin-block-end: 0;
}
.prose {
  display: grid;
  /* A bounded track, so the code snippet scrolls inside the card instead of widening it. */
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  gap: var(--ax-space-3);
  color: var(--ax-text);
  max-width: 90ch;
}
.prose a {
  color: var(--ax-link);
  text-decoration: underline;
}
.prose code {
  font-family: var(--ax-font-mono);
  font-size: 0.9em;
}
.snippet {
  padding: var(--ax-space-3) var(--ax-space-4);
  border-radius: var(--ax-radius-md);
  background: var(--ax-surface-subtle);
  border: 1px solid var(--ax-border);
  font-family: var(--ax-font-mono);
  font-size: var(--ax-text-xs);
  overflow-x: auto;
  white-space: pre;
}
.links {
  display: grid;
  gap: var(--ax-space-2);
  padding-inline-start: var(--ax-space-5);
  list-style: disc;
}
.open {
  padding: var(--ax-space-5);
}
.name {
  font-weight: 600;
  color: var(--ax-text-strong);
  white-space: nowrap;
}
.meaning {
  font-size: var(--ax-text-sm);
  max-width: 60ch;
}
.nowrap {
  white-space: nowrap;
}
.cta {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ax-space-4);
  padding: var(--ax-space-5) var(--ax-space-6);
}
.cta__title {
  margin: 0;
  font-family: var(--ax-font-display);
  font-size: var(--ax-text-lg);
  font-weight: var(--ax-weight-semibold);
  color: var(--ax-text-strong);
}
.cta__text {
  margin: var(--ax-space-1) 0 0;
  max-width: 64ch;
  font-size: var(--ax-text-sm);
  color: var(--ax-text-muted);
}
.cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ax-space-2);
}
.ax-card__subtitle a {
  color: var(--ax-link);
  text-decoration: underline;
}
.muted {
  color: var(--ax-text-muted);
  font-size: var(--ax-text-sm);
}
</style>
