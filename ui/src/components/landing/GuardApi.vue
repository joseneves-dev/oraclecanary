<script setup lang="ts">
/* For builders: the on-chain guard (devnet) and the public API, each as a code card. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Reserve } from '@/api/client'

const props = defineProps<{ sample: Reserve | null }>()

const REPO = 'https://github.com/joseneves-dev/oraclecanary'

const sampleLines = computed(() => {
  const r = props.sample
  if (!r) return null
  const short = r.address.length > 14 ? `${r.address.slice(0, 6)}…${r.address.slice(-4)}` : r.address
  return [
    ['address', `"${short}"`, 's'],
    ['protocol', `"${r.protocol}"`, 's'],
    ['asset', `"${r.asset}"`, 's'],
    ['score', String(r.score), 'n'],
    ['severity', `"${r.severity}"`, r.severity === 'critical' ? 'x' : 's'],
    ['price.ageSeconds', r.price?.ageSeconds == null ? 'null' : String(r.price.ageSeconds), 'n'],
    ['checks[0].code', r.checks[0] ? `"${r.checks[0].code}"` : 'null', 's'],
  ] as const
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
          <pre class="code"><code><span class="k">const</span> ixs = <span class="k">await</span> <span class="f">withOracleGuard</span>([borrowIx], {
  reserves: [collateral, debt], <span class="c">// what the borrow relies on</span>
  maxSeverity: <span class="s">'warning'</span>,    <span class="c">// single-source prices pass</span>
})

<span class="c">// A price with a critical issue makes the whole</span>
<span class="c">// transaction fail on-chain, before borrowIx runs.</span></code></pre>
          <div class="code-card__text">
            <h3>oracle_guard</h3>
            <p>
              OracleCanary signs each reserve's latest health as an attestation. The Anchor program checks the signature, the reserve and how
              recent it is, and stops the transaction when the health is worse than you allow. Nothing is on mainnet.
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
          <pre class="code"><code><span class="p">$</span> curl <span class="s">"https://oraclecanary.com/api/reserves?listed=true&amp;order[score]=asc"</span>
<template v-if="sampleLines"><span class="c">// lowest score right now (live)</span>
{
<template v-for="([k, v, t], i) in sampleLines" :key="k">  <span class="a">"{{ k }}"</span>: <span :class="t">{{ v }}</span>{{ i < sampleLines.length - 1 ? ',' : '' }}
</template>}</template><template v-else><span class="c">// —</span></template></code></pre>
          <div class="code-card__text">
            <h3>Public API</h3>
            <p>
              Every reserve, incident and configuration change, in JSON or CSV (<code>Accept: text/csv</code>). Each reserve also has a signed
              attestation of its health at <code>/api/reserves/{address}/attestation</code>.
            </p>
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
  color: rgba(233, 228, 214, 0.55);
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
  border: 1px solid rgba(251, 146, 60, 0.45);
  color: #fdba74;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.tag--ok {
  border-color: rgba(250, 204, 21, 0.4);
  color: #fde047;
}
.code {
  margin: 0;
  padding: 20px 20px 22px;
  font-family: var(--lp-mono);
  font-size: 13.5px;
  line-height: 1.75;
  overflow-x: auto;
  white-space: pre;
  flex: 1;
  min-height: 230px;
  background:
    radial-gradient(ellipse 60% 80% at 0% 0%, rgba(250, 204, 21, 0.07), transparent 70%),
    transparent;
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
  color: rgba(233, 228, 214, 0.42);
}
.x {
  color: #f87171;
}
.p {
  color: rgba(233, 228, 214, 0.42);
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
  color: rgba(233, 228, 214, 0.72);
  font-size: 14px;
  line-height: 1.6;
}
.code-card__text code {
  font-family: var(--lp-mono);
  font-size: 12.5px;
  color: #e9e4d6;
  background: rgba(255, 240, 200, 0.08);
  padding: 1px 5px;
  border-radius: 5px;
  word-break: break-all;
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
@media (max-width: 480px) {
  .code {
    font-size: 12px;
    padding: 16px;
    min-height: 0;
  }
}
</style>
