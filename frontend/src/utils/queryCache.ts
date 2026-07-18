import { QueryClient, QueryKey } from '@tanstack/react-query'

interface Identifiable {
  id: number
}

interface PageData<T> {
  items: T[]
  [key: string]: unknown
}

/**
 * Replace a row in every cached page under a list key using the authoritative
 * object returned by the API. A background invalidation can then reconcile
 * filters, totals and related aggregates without showing the stale row first.
 */
export function replaceCachedPageItem<T extends Identifiable>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updated: T
) {
  queryClient.setQueriesData<PageData<T>>({ queryKey }, (current) => {
    // Prefix matches can include detail/aggregate queries that share the same
    // root key. Only paginated list caches have an items array.
    if (!Array.isArray(current?.items) || !current.items.some((item) => item.id === updated.id)) return current
    return {
      ...current,
      items: current.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
    }
  })
}
