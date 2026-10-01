<script setup lang="ts">
/* The latest incidents (the Telegram bar: $10K or more at stake), and configuration changes. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { ConfigChange, ReserveIncident } from '@/api/client'
import { checkLabel, fmtAgo, fmtInt, fmtUsd, protocolName } from '@/composables/useLanding'
import { duration } from '@/lib/format'

const props = defineProps<{
  incidents: ReserveIncident[] | null
  open: { count: number; atStake: number; paused: number } | null
  changes: ConfigChange[] | null
  now: number
}>()

const MAX_ROWS = 6

interface Group {
  first: ReserveIncident
  count: number
  ongoing: boolean
  paused: boolean
  why: string
  /** Start of the oldest incident in the group. */
  oldest: number
}

/** Incidents of the same reserve collapse into one row ("FWDI ×4"), at its most recent one. */
const groups = computed<Group[] | null>(() => {
  if (!props.incidents) return null
  const out: Group[] = []
  const byReserve = new Map<string, Group>()
  for (const i of props.incidents) {
    const seen = byReserve.get(i.reserve)
    if (seen) {
      seen.count++
      if (!i.endedAt) seen.ongoing = true
      seen.oldest = Math.min(seen.oldest, Date.parse(i.startedAt))
      continue
    }
    const codes = [...new Set(i.checks.filter((c) => c.severity === 'critical').map((c) => checkLabel(c.code)))]
    out.push({
      first: i,
      count: 1,
      ongoing: !i.endedAt,
      paused: i.checks.some((c) => c.code === 'MARKET_CLOSED'),
      why: codes.join(', '),
      oldest: Date.parse(i.startedAt),
    })
    byReserve.set(i.reserve, out[out.length - 1]!)
  }
  return out.slice(0, MAX_ROWS)
})

const hasChanges = computed(() => !!props.changes?.length)

/** "4 times in 3 days": how often this reserve broke within the incidents shown. */
function timesLabel(g: Group): string {
  const days = Math.max(1, Math.ceil((props.now - g.oldest) / 86_400_000))
  return `${g.count} times in ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Measured from the incident's start, as the app's incident log does. */
function timing(i: ReserveIncident): string {
  const start = Date.parse(i.startedAt)
  if (!i.endedAt) return `ongoing · ${duration(Math.max(0, Math.round((props.now - start) / 1000)))} so far`
  const seconds = i.durationSeconds ?? Math.round((Date.parse(i.endedAt) - start) / 1000)
  return `lasted ${duration(seconds)}`
}
</script>

<template>
  <section class="lp-section" aria-labelledby="feed-title">
    <div class="lp-wrap">
      <div class="lp-head lp-head--row">
        <div>
          <span class="lp-kicker">Live from the log</span>
          <h2 id="feed-title" class="lp-h2">Latest incidents</h2>
        </div>
        <p class="summary">
          <template v-if="open">
            <b class="lp-num" :class="{ hot: open.count > 0 }">{{ fmtInt(open.count) }}</b> open
            <template v-if="open.count > 0">· <b class="lp-num">{{ fmtInt(open.atStake) }}</b> with $10K+ at stake</template>
            <template v-if="open.paused > 0">· <b class="lp-num">{{ fmtInt(open.paused) }}</b> paused, market closed</template>
          </template>
          <template v-else>—</template>
        </p>
      </div>

      <div class="feed" :class="{ 'feed--solo': !hasChanges }">
        <div class="panel">
          <div class="panel__head">
            <h3>Reserves holding $10K or more</h3>
            <RouterLink :to="{ name: 'incidents' }" class="lp-link">All incidents →</RouterLink>
          </div>
          <ul v-if="groups?.length" class="rows">
            <li v-for="g in groups" :key="g.first.id">
              <RouterLink :to="{ name: 'reserve', params: { address: g.first.reserve } }" class="row">
                <span v-if="g.first.endedAt" class="state is-ended" title="Resolved">
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3 5 8.6 9.5 3.6" /></svg>
                </span>
                <span v-else class="state" :class="g.paused ? 'is-paused' : 'is-open'" :title="g.paused ? 'Paused' : 'Ongoing'" />
                <span class="row__main">
                  <span class="row__title">
                    <b>{{ g.first.asset }}</b>
                    <span v-if="g.count > 1" class="times" :title="timesLabel(g)">{{ timesLabel(g) }}</span>
                    <span v-if="g.paused" class="chip">paused · market closed</span>
                  </span>
                  <span class="row__meta">{{ protocolName(g.first.protocol) }}<template v-if="g.first.marketName"> · {{ g.first.marketName }}</template></span>
                  <span v-if="g.why && !g.paused" class="row__why">{{ g.why }}</span>
                </span>
                <span class="row__side lp-num">
                  <span :class="{ 'is-live': !g.first.endedAt && !g.paused, 'is-done': !!g.first.endedAt }">{{ timing(g.first) }}</span>
                  <small>started {{ fmtAgo(Date.parse(g.first.startedAt), now) }} · {{ fmtUsd(g.first.totalSupplyUsd) }}</small>
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-else-if="groups" class="empty">No incident on a reserve holding $10K or more yet.</p>
          <p v-else class="empty lp-num">—</p>
          <p v-if="changes && !hasChanges" class="note">No oracle configuration change recorded yet.</p>
        </div>

        <div v-if="hasChanges" class="panel">
          <div class="panel__head">
            <h3>Configuration changes</h3>
            <RouterLink :to="{ name: 'incidents' }" class="lp-link">In the log →</RouterLink>
          </div>
          <ul class="rows">
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
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.summary {
  margin: 0;
  font-size: 16px;
  color: var(--lp-ink-2);
}
.summary b {
  color: var(--lp-ink);
  font-weight: 600;
}
.summary b.hot {
  color: var(--lp-warn-text);
}
.feed {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 20px;
}
.feed--solo {
  grid-template-columns: minmax(0, 1fr);
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
  font-size: 15px;
  font-weight: 600;
  color: var(--lp-ink);
}
.panel__head .lp-link {
  font-size: 13px;
  white-space: nowrap;
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
  grid-template-columns: 12px minmax(0, 1fr) auto;
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
.state.is-ended {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  margin: 3px 0 0 -3px;
  background: none;
  color: var(--lp-ink-3);
}
.state.is-paused {
  background: var(--lp-info);
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
.row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.row__main b {
  color: var(--lp-ink);
  font-weight: 600;
  font-size: 15px;
}
.times {
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--lp-ink-2);
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--lp-fill-strong);
}
.chip {
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lp-ink-2);
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--lp-line-strong);
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
.row__side .is-done {
  color: var(--lp-ink-2);
}
.row__side .is-live {
  color: var(--lp-crit-text);
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
.note {
  margin: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--lp-line);
  font-size: 13px;
  color: var(--lp-ink-3);
}
@keyframes lp-live {
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--lp-crit) 0%, transparent);
  }
}
@media (max-width: 900px) {
  .feed {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .row {
    grid-template-columns: 12px minmax(0, 1fr);
    padding: 14px 16px;
    gap: 6px 10px;
  }
  .row__side {
    grid-column: 2;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    white-space: normal;
  }
  .panel__head {
    padding: 14px 16px;
    align-items: flex-start;
  }
  .note {
    padding: 12px 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .state.is-open {
    animation: none;
  }
}
</style>
