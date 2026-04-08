const KEY = 'malak-search-history'
const MAX = 5

export function getSearchHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function addToSearchHistory(term: string) {
  if (typeof window === 'undefined' || !term.trim()) return
  const history = getSearchHistory().filter((h) => h !== term.trim())
  history.unshift(term.trim())
  localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX)))
}

export function clearSearchHistory() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}
