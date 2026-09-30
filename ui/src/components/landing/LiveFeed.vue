<script setup lang="ts">
/* The latest incidents and configuration changes, straight from the API. */
import { RouterLink } from 'vue-router'
import type { ConfigChange, ReserveIncident } from '@/api/client'
import { checkLabel, fmtAgo, fmtInt, fmtSeconds, fmtUsd, protocolName } from '@/composables/useLanding'

defineProps<{
  incidents: ReserveIncident[] | null
  openCount: number | null
  changes: ConfigChange[] | null
  now: number
}>()

function critical(i: ReserveIncident): string {
  const codes = i.checks.filter((c) => c.severity === 'critical').map((c) => checkLabel(c.code))
  const closed = i.checks.some((c) => c.code === 'MARKET_CLOSED')
  return [...new Set(codes)].join(', ') + (closed ? ' · market closed' : '')
}
</script>

<template>
  <section class="lp-section" aria-labelledby="feed-title">
    <div class="lp-wrap">
      <div class="lp-head lp-head--row">
        <div>
          <span class="lp-kicker">Live from the log</span>
          <h2 id="feed-title" class="lp-h2">What broke lately.</h2>
        </div>
        <p class="lp-lede">
          <b class="lp-num open">{{ fmtInt(openCount) }}</b>
          {{ openCount === 1 ? 'incident is' : 'incidents are' }} open right now.
        </p>
      </div>

      <div class="feed">
        <div class="panel">
          <div class="panel__head">
            <h3>Incidents</h3>
            <RouterLink :to="{ name: 'incidents' }" class="lp-link">All incidents →</RouterLink>
          </div>
          <ul v-if="incidents?.length" class="rows">
            <li v-for="i in incidents" :key="i.id">
              <RouterLink :to="{ name: 'reserve', params: { address: i.reserve } }" class="row">
                <span class="state" :class="i.endedAt ? 'is-ended' : 'is-open'" :title="i.endedAt ? 'Ended' : 'Ongoing'" />
                <span class="row__main">
                  <b>{{ i.asset }}</b>
                  <span class="row__meta">{{ protocolName(i.protocol) }}<template v-if="i.marketName"> · {{ i.marketName }}</template></span>
                  <span class="row__why">{{ critical(i) }}</span>
                </span>
                <span class="row__side lp-num">
                  <span :class="{ 'is-live': !i.endedAt }">{{ i.endedAt ? fmtSeconds(i.durationSeconds) : 'ongoing' }}</span>
                  <small>{{ fmtAgo(Date.parse(i.startedAt), now) }} · {{ fmtUsd(i.totalSupplyUsd) }}</small>
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-else-if="incidents" class="empty">No incidents recorded yet.</p>
          <p v-else class="empty lp-num">—</p>
        </div>

        <div class="panel">
          <div class="panel__head">
            <h3>Configuration changes</h3>
            <RouterLink :to="{ name: 'incidents' }" class="lp-link">In the log →</RouterLink>
          </div>
          <ul v-if="changes?.length" class="rows">
            <li v-for="c in changes" :key="c.id">
              <RouterLink :to="{ name: 'reserve', params: { address: c.reserve } }" class="row">
                <span class="state is-change" />
                <span class="row__main">
                  <b>{{ c.asset }}</b>
                  <span class="row__meta">{{ protocolName(c.protocol) }}<template v-if="c.marketName"> · {{ c.marketName }}</template></span>
                  <span class="row__why">{{ c.detail }}</span>
                </span>
                <span class="row__side lp-num">
                  <span>{{ fmtAgo(Date.parse(c.occurredAt), now) }}</span>
                  <small>{{ fmtUsd(c.totalSupplyUsd) }}</small>
                </span>
              </RouterLink>
            </li>
          </ul>
          <div v-else-if="changes" class="empty empty--quiet">
            <svg viewBox="0 0 120 24" width="120" height="24" fill="none" aria-hidden="true">
              <path d="M0 12 H120" stroke="currentColor" stroke-dasharray="2 5" />
            </svg>
            <p>No change to how a listed reserve is priced has been recorded yet. When a protocol swaps an oracle, adds a fallback or changes the maximum price age, it shows up here.</p>
          </div>
          <p v-else class="empty lp-num">—</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.open {
  color: var(--lp-crit);
  font-weight: 600;
}
.feed {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 20px;
}
.panel {
  border: 1px solid var(--lp-line);
  border-radius: 18px;
  background: var(--lp-panel);
  overflow: hidden;
}
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--lp-line);
}
.panel__head h3 {
  margin: 0;
  font-family: var(--lp-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--lp-ink);
}
.panel__head .lp-link {
  font-size: 13px;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rows li + li {
  border-top: 1px solid var(--lp-line);
}
.row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding: 14px 20px;
  color: inherit;
  text-decoration: none;
  transition: background-color 0.15s;
}
.row:hover {
  background: var(--lp-fill);
}
.state {
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--lp-ink-3);
}
.state.is-open {
  background: var(--lp-crit);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--lp-crit) 22%, transparent);
  animation: lp-live 1.6s ease-in-out infinite;
}
.state.is-change {
  background: var(--lp-accent);
}
.row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row__main b {
  color: var(--lp-ink);
  font-weight: 600;
  font-size: 15px;
}
.row__meta,
.row__why {
  font-size: 13px;
  color: var(--lp-ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__why {
  color: var(--lp-ink-2);
  white-space: normal;
}
.row__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 13px;
  color: var(--lp-ink);
  white-space: nowrap;
}
.row__side .is-live {
  color: var(--lp-crit);
}
.row__side small {
  font-size: 11.5px;
  color: var(--lp-ink-3);
}
.empty {
  margin: 0;
  padding: 20px;
  color: var(--lp-ink-3);
  font-size: 14px;
}
.empty--quiet {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 28px 20px;
}
.empty--quiet p {
  margin: 0;
  max-width: 44ch;
  line-height: 1.6;
}
@keyframes lp-live {
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--lp-crit) 0%, transparent);
  }
}
@media (max-width: 900px) {
  .feed {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .row {
    padding: 14px 16px;
    gap: 10px;
  }
  .panel__head {
    padding: 14px 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .state.is-open {
    animation: none;
  }
}
</style>
