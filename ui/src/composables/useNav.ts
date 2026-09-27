/*
 * manifest → sidebar tree builder (Vue edition).
 *
 * Transforms the flat nav-manifest into the nested {section → group → children}
 * structure the Sidebar renders, honouring `inMenu`, `order`, alias resolution
 * and badges. Mirrors the static sidebar partial of the HTML reference but is
 * data-driven so all 186 pages stay consistent. Also derives the active trail +
 * breadcrumb for the current route slug.
 */

import { getManifest, type NavNode } from '@/lib/manifest'

export interface NavLeaf {
  id: string
  title: string
  slug: string
  href: string
  badge: NavNode['badge']
  external: boolean
  icon: string
}
export interface NavGroup {
  id: string
  title: string
  slug: string
  icon: string
  badge: NavNode['badge']
  children: NavItem[]
}
export type NavItem = NavLeaf | NavGroup
export interface NavSection {
  label: string
  groups: NavGroup[]
  // a few top-level items render as a single leaf link (e.g. Widgets)
  leaves: NavLeaf[]
}

export function isGroup(item: NavItem): item is NavGroup {
  return (item as NavGroup).children !== undefined
}

/** SPA href for a slug: the overview is the home page, every other slug maps to its path. */
export function slugToHref(slug: string): string {
  if (slug === 'overview') return '/'
  return '/' + slug
}

function buildItems(parentId: string): NavItem[] {
  const mf = getManifest()
  const out: NavItem[] = []
  for (const node of mf.childrenOf(parentId)) {
    if (!node.inMenu) continue
    const kids = mf.childrenOf(node.id).filter((n) => n.inMenu)
    if (kids.length) {
      out.push({
        id: node.id,
        title: node.title,
        slug: node.slug,
        icon: node.icon,
        badge: node.badge,
        children: buildItems(node.id),
      })
    } else {
      out.push({
        id: node.id,
        title: node.title,
        slug: node.slug,
        href: slugToHref(node.slug),
        badge: node.badge,
        external: !!node.external,
        icon: node.icon,
      })
    }
  }
  return out
}

export function buildSidebar(): NavSection[] {
  const mf = getManifest()
  const sections = (mf.meta.sections as string[]) || []
  const tops = mf.childrenOf(null).filter((n) => n.inMenu)
  const result: NavSection[] = []

  for (const label of sections) {
    const groupsInSection = tops.filter((n) => n.section === label)
    if (!groupsInSection.length) continue
    const sec: NavSection = { label, groups: [], leaves: [] }
    for (const top of groupsInSection) {
      const kids = mf.childrenOf(top.id).filter((n) => n.inMenu)
      if (kids.length) {
        sec.groups.push({
          id: top.id,
          title: top.title,
          slug: top.slug,
          icon: top.icon,
          badge: top.badge,
          children: buildItems(top.id),
        })
      } else {
        // a top-level leaf (e.g. Widgets) — render inline under the section.
        sec.leaves.push({
          id: top.id,
          title: top.title,
          slug: top.slug,
          href: slugToHref(top.slug),
          badge: top.badge,
          external: !!top.external,
          icon: top.icon,
        })
      }
    }
    result.push(sec)
  }
  return result
}

export interface Crumb {
  label: string
  href: string | null
  current: boolean
  home: boolean
}

/** Active leaf id + breadcrumb trail for a route slug. */
export function resolveActive(slug: string): { activeId: string | null; openGroups: Set<string>; crumbs: Crumb[] } {
  const mf = getManifest()
  const node = mf.resolve(mf.bySlug.get(slug))
  const trail = node ? mf.trail(node) : []
  const openGroups = new Set<string>()
  for (const n of trail) if (n.id !== node?.id) openGroups.add(n.id)

  const crumbs: Crumb[] = [{ label: 'Home', href: '/', current: false, home: true }]
  const middle = trail.slice(0, Math.max(0, trail.length - 1))
  for (const n of middle) {
    if (n.slug === 'overview') continue
    crumbs.push({ label: n.title, href: slugToHref(n.slug), current: false, home: false })
  }
  if (node) crumbs.push({ label: node.title, href: null, current: true, home: false })

  return { activeId: node?.id ?? null, openGroups, crumbs }
}
