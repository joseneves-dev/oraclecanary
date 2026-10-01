<script setup lang="ts">
/* For builders: the on-chain guard (devnet) and the public API, each as a code card. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Reserve } from '@/api/client'
import { healthState } from '@/lib/priceState'

const props = defineProps<{ sample: Reserve | null }>()

const REPO = 'https://github.com/joseneves-dev/oraclecanary'

/** The live lowest-scoring reserve, trimmed to a few fields, in the API's own shape. */
const sample = computed(() => {
  const r = props.sample
  if (!r) return null
  return {
    address: r.address.length > 14 ? `${r.address.slice(0, 6)}…${r.address.slice(-4)}` : r.address,
    protocol: r.protocol,
    asset: r.asset,
    score: r.score,
    severity: r.severity,
    age: r.price?.ageSeconds ?? null,
    paused: healthState(r) === 'paused',
    small: (r.totalSupplyUsd ?? 0) < 1000,
    checks: [...new Set(r.checks.map((c) => c.code))].slice(0, 2),
  }
})
</script>

<template>
  <section id="build" class="lp-section" aria-labelledby="build-title">
    <div class="lp-wrap">
      <div class="lp-head">
        <span class="lp-kicker">For builders</span>
        <h2 id="build-title" class="lp-h2">Read it, or let a transaction refuse to run on a broken price.</h2>
      </div>

      <div class="build">
        <article class="code-card">
          <header class="code-card__head">
            <span class="dots" aria-hidden="true"><i /><i /><i /></span>
            <span class="code-card__file">borrow.ts</span>
            <span class="tag">Devnet only</span>
          </header>
          <div class="code-body">
          <pre class="code"><code><span class="c">// Throws if a price is already broken;</span>
<span class="c">// on-chain, oracle_guard then rejects</span>
<span class="c">// the transaction before borrowIx runs.</span>
<span class="k">const</span> ixs = <span class="k">await</span> <span class="f">withOracleGuard</span>([borrowIx], {
  reserves: [collateral, debt],
  maxSeverity: <span class="s">'warning'</span>,
})</code></pre>
            <ol class="tx" aria-label="The transaction, in order">
              <li><span class="tx__n">1</span><b>Ed25519 verify</b><small>OracleCanary's signed attestations</small></li>
              <li><span class="tx__n">2</span><b>oracle_guard</b><small>rejects the transaction if one fails</small></li>
              <li><span class="tx__n">3</span><b>borrowIx</b><small>runs only if every price passes</small></li>
            </ol>
          </div>
          <div class="code-card__text">
            <h3>oracle_guard</h3>
            <p>
              OracleCanary signs each reserve's latest health as an attestation. <code class="inline">withOracleGuard</code> adds them to your
              transaction and throws before it is built if one is already too unhealthy or too old; on-chain, the Anchor program rejects any
              transaction carrying a failing attestation. Nothing is on mainnet.
            </p>
            <div class="links">
              <RouterLink to="/how-it-works#guard" class="lp-link">How the guard works →</RouterLink>
              <a :href="`${REPO}/tree/main/onchain`" target="_blank" rel="noopener" class="lp-link">Source on GitHub →</a>
            </div>
          </div>
        </article>

        <article class="code-card">
          <header class="code-card__head">
            <span class="dots" aria-hidden="true"><i /><i /><i /></span>
            <span class="code-card__file">terminal</span>
            <span class="tag tag--ok">Free · public</span>
          </header>
          <div class="code code--api">
            <pre class="cmd"><code><span class="p">$</span> curl -G https://oraclecanary.com/api/reserves \
    -H <span class="s">"Accept: application/json"</span> \
    -d listed=true -d itemsPerPage=1 \
    -d <span class="s">"order[score]=asc"</span></code></pre>
            <pre class="out"><code><span class="c">{{ sample && !sample.paused && !sample.small ? '// lowest score among reserves holding $1K+, outside market-hours pauses (live, trimmed)' : '// lowest score right now (live, trimmed)' }}</span>
<template v-if="sample"><template v-if="sample.paused"><span class="c">// paused: market closed, expected</span>
</template>[{
  <span class="a">"address"</span>: <span class="s">"{{ sample.address }}"</span>,
  <span class="a">"protocol"</span>: <span class="s">"{{ sample.protocol }}"</span>,
  <span class="a">"asset"</span>: <span class="s">"{{ sample.asset }}"</span>,
  <span class="a">"score"</span>: <span class="n">{{ sample.score }}</span>,
  <span class="a">"severity"</span>: <span :class="sample.severity === 'critical' ? 'x' : 's'">"{{ sample.severity }}"</span>,
  <span class="a">"price"</span>: { <span class="a">"ageSeconds"</span>: <span class="n">{{ sample.age ?? 'null' }}</span>, … },
  <span class="a">"checks"</span>: [<template v-for="(code, k) in sample.checks" :key="code">{{ k ? ', ' : '' }}{ <span class="a">"code"</span>: <span class="s">"{{ code }}"</span>, … }</template>],
  …
}]</template><template v-else>—</template></code></pre>
          </div>
          <div class="code-card__text">
            <h3>Public API</h3>
            <p>
              Every reserve, incident and configuration change in JSON; reserves and incidents also as CSV (<code class="inline">Accept: text/csv</code>).
              Each reserve has a signed attestation of its health at
            </p>
            <code class="path">/api/reserves/{address}/attestation</code>
            <div class="links">
              <a href="/api/docs" class="lp-link">API docs →</a>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.build {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}
.code-card {
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: #100e0a;
  color: #e9e4d6;
  border: 1px solid rgba(255, 240, 200, 0.1);
  box-shadow: var(--lp-panel-shadow);
  overflow: hidden;
  min-width: 0;
}
.code-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 240, 200, 0.08);
  font-family: var(--lp-mono);
  font-size: 12px;
  color: rgba(233, 228, 214, 0.62);
}
.dots {
  display: inline-flex;
  gap: 6px;
}
.dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 240, 200, 0.14);
}
.tag {
  margin-inline-start: auto;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(251, 146, 60, 0.5);
  color: #fdba74;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.tag--ok {
  border-color: rgba(250, 204, 21, 0.45);
  color: #fde047;
}
.code {
  margin: 0;
  padding: 20px 20px 22px;
  font-family: var(--lp-mono);
  font-size: 13px;
  line-height: 1.75;
  overflow-x: auto;
  white-space: pre;
  flex: 1;
  background: radial-gradient(ellipse 60% 80% at 0% 0%, rgba(250, 204, 21, 0.07), transparent 70%);
}
.code-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse 60% 80% at 0% 0%, rgba(250, 204, 21, 0.07), transparent 70%);
}
.code-body .code {
  flex: none;
  background: none;
}
.tx {
  list-style: none;
  margin: auto 20px 20px;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.tx li {
  display: grid;
  grid-template-columns: 22px auto minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 240, 200, 0.1);
  background: rgba(255, 240, 200, 0.03);
}
.tx li:nth-child(2) {
  border-color: rgba(250, 204, 21, 0.4);
}
.tx__n {
  font-family: var(--lp-mono);
  font-size: 11px;
  color: rgba(233, 228, 214, 0.6);
}
.tx b {
  font-family: var(--lp-mono);
  font-weight: 600;
  color: #e9e4d6;
}
.tx li:nth-child(2) b {
  color: #fde047;
}
.tx small {
  font-size: 12.5px;
  color: rgba(233, 228, 214, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.code--api {
  white-space: normal;
  overflow: hidden;
}
.code--api pre {
  margin: 0;
  font: inherit;
  white-space: pre;
}
.code--api .cmd {
  overflow-x: auto;
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px dashed rgba(255, 240, 200, 0.1);
}
.code code {
  font: inherit;
}
.k {
  color: #fb923c;
}
.f {
  color: #fde047;
}
.s {
  color: #bef264;
}
.n {
  color: #93c5fd;
}
.a {
  color: #e9e4d6;
}
.c {
  color: rgba(233, 228, 214, 0.6);
}
.x {
  color: #fca5a5;
}
.p {
  color: rgba(233, 228, 214, 0.6);
}
.code-card__text {
  padding: 18px 20px 20px;
  border-top: 1px solid rgba(255, 240, 200, 0.08);
}
.code-card__text h3 {
  margin: 0 0 6px;
  font-family: var(--lp-mono);
  font-size: 15px;
  font-weight: 600;
  color: #fde047;
}
.code-card__text p {
  margin: 0 0 12px;
  color: rgba(233, 228, 214, 0.78);
  font-size: 14px;
  line-height: 1.6;
}
.inline,
.path {
  font-family: var(--lp-mono);
  font-size: 12.5px;
  color: #e9e4d6;
  background: rgba(255, 240, 200, 0.08);
  border-radius: 5px;
  white-space: nowrap;
}
.inline {
  padding: 1px 5px;
}
.path {
  display: block;
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
  padding: 6px 10px;
  margin: -4px 0 14px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.code-card .lp-link {
  color: #fde047;
}
@media (max-width: 960px) {
  .build {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .tx {
    margin: 0 16px 16px;
  }
  .tx li {
    grid-template-columns: 18px minmax(0, 1fr);
  }
  .tx small {
    grid-column: 2;
    white-space: normal;
  }
  .code {
    font-size: 11px;
    padding: 16px;
    white-space: pre-wrap;
  }
  .code--api .out {
    white-space: pre-wrap;
  }
  .code--api .cmd {
    font-size: 11px;
  }
  .code-card__text {
    padding: 16px;
  }
}
</style>
