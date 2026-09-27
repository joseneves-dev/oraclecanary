/*
 * nav manifest loader + index (Vue edition).
 * TS port of src/js/core/manifest.js. The manifest JSON is imported (bundled),
 * not fetched, since it ships inside the SPA. Drives sidebar + breadcrumb +
 * command palette + topnav from one ordered 219-node tree.
 */

import raw from '@/data/nav-manifest.json'

export interface NavBadge {
  type: string
  value?: number | string
}
export interface NavNode {
  id: string
  title: string
  slug: string
  icon: string
  parent: string | null
  section: string | null
  order: number
  badge: NavBadge | null
  keywords?: string[]
  inMenu: boolean
  alias: string | null
  external?: boolean
}

export interface ManifestIndex {
  meta: Record<string, unknown>
  nodes: NavNode[]
  byId: Map<string, NavNode>
  bySlug: Map<string, NavNode>
  childrenOf: (id: string | null) => NavNode[]
  resolve: (node: NavNode | undefined) => NavNode | undefined
  trail: (node: NavNode | undefined) => NavNode[]
}

function index(data: { nodes?: NavNode[]; meta?: Record<string, unknown> }): ManifestIndex {
  const nodes = Array.isArray(data.nodes) ? data.nodes : []
  const byId = new Map<string, NavNode>()
  const bySlug = new Map<string, NavNode>()
  const children = new Map<string, NavNode[]>()

  for (const n of nodes) {
    byId.set(n.id, n)
    if (!bySlug.has(n.slug) || !n.alias) bySlug.set(n.slug, n)
    const p = n.parent || '__root__'
    if (!children.has(p)) children.set(p, [])
    children.get(p)!.push(n)
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.order || 0) - (b.order || 0))
  }

  return {
    meta: data.meta || {},
    nodes,
    byId,
    bySlug,
    childrenOf: (id) => children.get(id || '__root__') || [],
    resolve: (node) => (node && node.alias ? byId.get(node.alias) : node) || node,
    trail(node) {
      const out: NavNode[] = []
      let cur = node
      const seen = new Set<string>()
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id)
        out.unshift(cur)
        cur = cur.parent ? byId.get(cur.parent) : undefined
      }
      return out
    },
  }
}

let _cache: ManifestIndex | null = null
export function getManifest(): ManifestIndex {
  if (!_cache) _cache = index(raw as { nodes: NavNode[]; meta: Record<string, unknown> })
  return _cache
}

/** Resolve the current route slug from <html data-ax-route> or location path. */
export function currentSlug(route?: string): string {
  const attr = route || document.documentElement.dataset.axRoute
  if (attr) return attr.replace(/^\/+/, '').replace(/\.html$/, '')
  let p = (location.pathname || '/').replace(/\/+$/, '')
  p = p.replace(/^\//, '').replace(/\.html$/, '')
  if (!p || p === 'index') return 'overview'
  return p
}
