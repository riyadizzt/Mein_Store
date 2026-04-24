'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeleteCategoryModal } from '@/components/admin/delete-category-modal'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Loader2, ChevronDown, ChevronRight,
  FolderPlus, Trash2, FolderTree, Package, GripVertical, Save, Image as ImageIcon, ArrowUp, ArrowDown, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { CategoryIconPicker } from '@/components/admin/category-icon-picker'
import { GoogleTaxonomyPicker } from '@/components/admin/google-taxonomy-picker'

interface Translation { language: string; name: string; description?: string }
interface Category {
  id: string; slug: string; imageUrl: string | null; iconKey: string | null; sortOrder: number
  parentId: string | null; translations: Translation[]
  // Commit 3: isActive lets the tree render archived cats as greyscale
  // + "Archiviert" badge. Only populated when useAdminCategories is
  // called with includeArchived=true (default omits the field, not
  // false — filtered on the server side).
  isActive?: boolean
  // C6 — Google Product Taxonomy mapping. Null = falls back to
  // category name in the Google Shopping feed (sub-optimal listing).
  googleCategoryId?: string | null
  ebayCategoryId?: string | null
  googleCategoryLabel?: string | null
  _count?: { products: number }; children?: Category[]
}

export default function AdminCategoriesPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  // Commit 3: old productCount > 0 pre-check + useConfirm dialog
  // removed — DeleteCategoryModal now handles all archive flows
  // (clean / blocked / reactivate) via the /impact endpoint.
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [isNew, setIsNew] = useState(false)
  const [langTab, setLangTab] = useState<'de' | 'en' | 'ar'>('de')
  const [dragId, setDragId] = useState<string | null>(null)

  // Form
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [iconKey, setIconKey] = useState<string | null>(null)
  const [googleCategoryId, setGoogleCategoryId] = useState<string | null>(null)
  const [ebayCategoryId, setEbayCategoryId] = useState<string | null>(null)
  const [googleCategoryLabel, setGoogleCategoryLabel] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState(0)
  const [nameDe, setNameDe] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [descDe, setDescDe] = useState('')
  const [descEn, setDescEn] = useState('')
  const [descAr, setDescAr] = useState('')

  const { data: categories, isLoading } = useQuery<Category[]>({
    queryKey: ['admin-categories', showArchived],
    queryFn: async () => {
      const { data } = await api.get('/admin/categories', {
        params: showArchived ? { includeArchived: 'true' } : {},
      })
      return data
    },
  })

  const saveMutation = useMutation({
    mutationFn: (p: { id?: string; payload: Record<string, unknown> }) =>
      p.id ? api.put(`/categories/${p.id}`, p.payload) : api.post('/categories', p.payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-categories'] }); if (isNew) setIsNew(false) },
  })
  // Commit 3: old deleteMutation removed — DeleteCategoryModal fires the
  // DELETE request itself and notifies via onArchived which invalidates
  // the query + clears selection. Kept as comment anchor for reviewers.
  const reorderMutation = useMutation({
    mutationFn: (p: { id: string; sortOrder: number; parentId?: string }) =>
      api.put(`/categories/${p.id}`, { sortOrder: p.sortOrder, ...(p.parentId !== undefined ? { parentId: p.parentId || null } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-categories'] }),
  })

  // Flat helpers
  const allFlat: Category[] = []
  for (const c of categories ?? []) { allFlat.push(c); for (const ch of c.children ?? []) allFlat.push(ch) }

  const getName = useCallback((cat: Category) => {
    const tr = cat.translations.find((t) => t.language === locale) ?? cat.translations[0]
    return tr?.name ?? cat.slug
  }, [locale])

  const selected = selectedId ? allFlat.find((c) => c.id === selectedId) ?? null : null

  // Populate form
  useEffect(() => {
    if (!selected || isNew) return
    const g = (lang: string) => selected.translations.find((t) => t.language === lang)
    setSlug(selected.slug); setParentId(selected.parentId ?? ''); setImageUrl(selected.imageUrl ?? '')
    setIconKey(selected.iconKey ?? null)
    setGoogleCategoryId(selected.googleCategoryId ?? null)
    setEbayCategoryId(selected.ebayCategoryId ?? null)
    setGoogleCategoryLabel(selected.googleCategoryLabel ?? null)
    setSortOrder(selected.sortOrder); setNameDe(g('de')?.name ?? ''); setNameEn(g('en')?.name ?? '')
    setNameAr(g('ar')?.name ?? ''); setDescDe(g('de')?.description ?? '')
    setDescEn(g('en')?.description ?? ''); setDescAr(g('ar')?.description ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearForm = () => { setSlug(''); setParentId(''); setImageUrl(''); setIconKey(null); setGoogleCategoryId(null); setGoogleCategoryLabel(null); setEbayCategoryId(null); setSortOrder(0); setNameDe(''); setNameEn(''); setNameAr(''); setDescDe(''); setDescEn(''); setDescAr('') }
  const startNewRoot = () => { clearForm(); setSelectedId(null); setIsNew(true); setParentId('') }
  const startNewChild = (pid: string) => { clearForm(); setSelectedId(null); setIsNew(true); setParentId(pid) }

  const handleSave = () => {
    const translations = [
      { language: 'de', name: nameDe, description: descDe || undefined },
      { language: 'en', name: nameEn, description: descEn || undefined },
      { language: 'ar', name: nameAr, description: descAr || undefined },
    ].filter((tr) => tr.name.trim())
    saveMutation.mutate({ id: isNew ? undefined : selectedId ?? undefined, payload: { slug, parentId: parentId || undefined, imageUrl: imageUrl || undefined, iconKey: iconKey ?? null, googleCategoryId: googleCategoryId ?? null, googleCategoryLabel: googleCategoryLabel ?? null, ebayCategoryId: ebayCategoryId ?? null, sortOrder, translations } })
  }

  // Commit 3: click "Delete" opens the modal. The modal handles the full
  // archive flow (impact query, sample rendering, conditional move-picker,
  // reactivate) and calls back via onArchived / onReactivated to refetch.
  // The old productCount > 0 preemption + useConfirm dialog are gone.
  const handleDelete = () => {
    if (!selected) return
    setDeleteModalOpen(true)
  }

  const autoSlug = () => {
    if (!nameDe) return
    setSlug(nameDe.toLowerCase().replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }

  const toggle = (id: string) => { const s = new Set(collapsed); s.has(id) ? s.delete(id) : s.add(id); setCollapsed(s) }

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragStart = (e: DragStartEvent) => setDragId(String(e.active.id))
  const handleDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const activeItem = allFlat.find((c) => c.id === active.id)
    const overItem = allFlat.find((c) => c.id === over.id)
    if (!activeItem || !overItem) return

    // Find siblings (same parent) and calculate new sortOrder based on position
    const siblings = allFlat.filter((c) => c.parentId === overItem.parentId)
    const overIndex = siblings.findIndex((c) => c.id === over.id)
    const newSortOrder = overIndex >= 0 ? overIndex : overItem.sortOrder

    if (activeItem.parentId === overItem.parentId) {
      // Same parent: just reorder
      reorderMutation.mutate({ id: activeItem.id, sortOrder: newSortOrder })
    } else {
      // Move to new parent
      const newParentId = overItem.parentId === null ? overItem.id : overItem.parentId
      reorderMutation.mutate({ id: activeItem.id, sortOrder: newSortOrder, parentId: newParentId })
    }

    // Also update all siblings to have sequential sortOrders (fix all-zero problem)
    const updatedSiblings = siblings.filter((c) => c.id !== active.id)
    updatedSiblings.splice(overIndex, 0, activeItem)
    updatedSiblings.forEach((sib, idx) => {
      if (sib.id !== active.id && sib.sortOrder !== idx) {
        reorderMutation.mutate({ id: sib.id, sortOrder: idx })
      }
    })
  }

  const dragItem = dragId ? allFlat.find((c) => c.id === dragId) : null

  const parentLabel = parentId ? getName(allFlat.find((c) => c.id === parentId) ?? { slug: '?', translations: [], id: '', imageUrl: null, iconKey: null, sortOrder: 0, parentId: null }) : null
  const totalSubs = (categories ?? []).reduce((s, c) => s + (c.children?.length ?? 0), 0)
  const totalProds = allFlat.reduce((s, c) => s + (c._count?.products ?? 0), 0)

  const emptyCount = allFlat.filter((c) => (c._count?.products ?? 0) === 0).length

  // Move category up/down by swapping sortOrder with sibling
  const moveCategory = (catId: string, direction: 'up' | 'down') => {
    const cat = allFlat.find((c) => c.id === catId)
    if (!cat) return
    const siblings = allFlat
      .filter((c) => c.parentId === cat.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = siblings.findIndex((c) => c.id === catId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const other = siblings[swapIdx]
    // Swap sortOrders
    reorderMutation.mutate({ id: cat.id, sortOrder: other.sortOrder })
    reorderMutation.mutate({ id: other.id, sortOrder: cat.sortOrder })
  }
  const [treeSearch, setTreeSearch] = useState('')
  const filteredCategories = treeSearch.trim()
    ? (categories ?? []).filter((c) => {
        const match = (cat: Category) => getName(cat).toLowerCase().includes(treeSearch.toLowerCase())
        return match(c) || (c.children ?? []).some(match)
      })
    : (categories ?? [])

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('categories.title') }]} />

      <div className="flex items-start gap-5" style={{ minHeight: 'calc(100vh - 140px)' }}>
        {/* ═══ LEFT: Tree (30%) ═══ */}
        <div className="w-[280px] flex-shrink-0 flex flex-col bg-[#1a1a2e] border border-white/[0.06] rounded-2xl overflow-hidden">
          {/* Tree Header */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-[#d4a853]" />
                <span className="text-sm font-semibold text-white">{t('categories.title')}</span>
              </div>
              <span className="text-[10px] text-white/25 tabular-nums">{(categories ?? []).length + totalSubs}</span>
            </div>
            {/* Search */}
            <input
              type="text"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              placeholder={locale === 'ar' ? 'بحث في الأقسام...' : 'Kategorie suchen...'}
              className="w-full h-8 px-3 rounded-lg bg-white/[0.05] border border-white/[0.06] text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-[#d4a853]/30 transition-colors"
            />
            {/* Commit 3: Archive toggle — lets admin see/reactivate archived cats */}
            <label className="flex items-center gap-2 mt-2 text-[11px] text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.05]"
              />
              <span>
                {locale === 'ar' ? 'إظهار المؤرشفة' : locale === 'en' ? 'Show archived' : 'Archivierte anzeigen'}
              </span>
            </label>
          </div>

          {/* Tree Body */}
          <div className="flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
            {isLoading ? (
              <div className="p-3 space-y-1.5">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-8 bg-white/[0.03] rounded animate-pulse" />)}</div>
            ) : filteredCategories.length === 0 ? (
              <div className="p-6 text-xs text-white/25 text-center">{t('categories.noCategories')}</div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="py-1">
                  <SortableContext items={allFlat.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    {filteredCategories.map((dept) => (
                      <div key={dept.id}>
                        <TreeItem cat={dept} depth={0} isSelected={selectedId === dept.id && !isNew}
                          onSelect={() => { setSelectedId(dept.id); setIsNew(false) }}
                          onToggle={() => toggle(dept.id)}
                          isCollapsed={collapsed.has(dept.id)}
                          hasChildren={(dept.children?.length ?? 0) > 0}
                          getName={getName}
                          onAddChild={() => startNewChild(dept.id)}
                          onMoveUp={() => moveCategory(dept.id, 'up')}
                          onMoveDown={() => moveCategory(dept.id, 'down')}
                        />
                        {!collapsed.has(dept.id) && (dept.children ?? []).map((child) => {
                          if (treeSearch.trim() && !getName(child).toLowerCase().includes(treeSearch.toLowerCase()) && !getName(dept).toLowerCase().includes(treeSearch.toLowerCase())) return null
                          return (
                            <TreeItem key={child.id} cat={child} depth={1}
                              isSelected={selectedId === child.id && !isNew}
                              onSelect={() => { setSelectedId(child.id); setIsNew(false) }}
                              getName={getName}
                              onMoveUp={() => moveCategory(child.id, 'up')}
                              onMoveDown={() => moveCategory(child.id, 'down')}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </SortableContext>
                </div>
                <DragOverlay>
                  {dragItem && (
                    <div className="bg-[#d4a853]/20 border border-[#d4a853]/40 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
                      {getName(dragItem)}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </div>

          {/* Tree Footer — New Category */}
          <div className="p-3 border-t border-white/[0.06]">
            <button onClick={startNewRoot} className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-white/[0.04] hover:bg-[#d4a853]/10 text-white/50 hover:text-[#d4a853] text-xs font-medium transition-colors">
              <Plus className="h-3.5 w-3.5" />
              {t('categories.newMainCategory')}
            </button>
          </div>
        </div>

        {/* ═══ RIGHT: Detail (70%) ═══ */}
        <div className="flex-1 min-w-0">
          {!selected && !isNew ? (
            /* ── Welcome State ── */
            <div className="bg-[#1a1a2e] border border-white/[0.06] rounded-2xl p-8">
              <div className="text-center mb-8">
                <FolderTree className="h-10 w-10 text-[#d4a853]/30 mx-auto mb-3" />
                <h2 className="text-lg font-semibold text-white">{t('categories.noCategorySelected')}</h2>
                <p className="text-xs text-white/30 mt-1">
                  {locale === 'ar' ? 'اختر قسماً من القائمة أو أنشئ قسماً جديداً' : 'Wähle eine Kategorie oder erstelle eine neue'}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <StatCard value={(categories ?? []).length} label={locale === 'ar' ? 'أقسام' : 'Kategorien'} />
                <StatCard value={totalSubs} label={locale === 'ar' ? 'فرعي' : 'Unter-Kat.'} />
                <StatCard value={totalProds} label={locale === 'ar' ? 'منتجات' : 'Produkte'} />
                <StatCard value={emptyCount} label={locale === 'ar' ? 'فارغة' : 'Leer'} color={emptyCount > 0 ? 'orange' : undefined} />
              </div>
            </div>
          ) : (
            <div className="bg-[#1a1a2e] border border-white/[0.06] rounded-2xl p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">
                    {isNew ? (parentLabel ? `${t('categories.addSubcategory')} → ${parentLabel}` : t('categories.newMainCategory')) : getName(selected!)}
                  </h2>
                  {!isNew && selected && (
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{selected.slug}</span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        <strong>{selected._count?.products ?? 0}</strong> {t('categories.products')}
                      </span>
                    </div>
                  )}
                </div>
                {!isNew && selected && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-primary border-primary/30" onClick={() => startNewChild(selected.id)}>
                    <FolderPlus className="h-3.5 w-3.5" />{t('categories.addSubcategory')}
                  </Button>
                )}
              </div>

              {/* Language Tabs — Large */}
              <div className="flex gap-2 mb-5">
                {(['de', 'en', 'ar'] as const).map((lang) => (
                  <button key={lang} onClick={() => setLangTab(lang)}
                    className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
                      langTab === lang ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {lang === 'de' ? '🇩🇪 Deutsch' : lang === 'en' ? '🇬🇧 English' : '🇸🇦 العربية'}
                  </button>
                ))}
              </div>

              {/* Name + Description */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-sm font-medium text-white/70 mb-1.5 block">{t('categories.name')}</label>
                  {langTab === 'de' && <Input value={nameDe} onChange={(e) => setNameDe(e.target.value)} placeholder="z.B. Herren" onBlur={() => { if (isNew && !slug) autoSlug() }} />}
                  {langTab === 'en' && <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Men" />}
                  {langTab === 'ar' && <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: رجال" dir="rtl" />}
                </div>
                <div>
                  <label className="text-sm font-medium text-white/70 mb-1.5 block">{t('categories.description')}</label>
                  {langTab === 'de' && <textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                  {langTab === 'en' && <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                  {langTab === 'ar' && <textarea value={descAr} onChange={(e) => setDescAr(e.target.value)} rows={2} dir="rtl" className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                </div>
              </div>

              {/* Slug + Parent + Sort + Image */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium text-white/70 mb-1.5 block">{t('categories.slug')}</label>
                  <div className="flex gap-2">
                    <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="flex-1 font-mono text-xs" />
                    <Button type="button" size="sm" variant="outline" onClick={autoSlug}>Auto</Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-white/70 mb-1.5 block">{t('categories.parent')}</label>
                  <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm">
                    <option value="">{t('categories.noParent')}</option>
                    {allFlat.filter((c) => c.id !== selectedId).map((c) => (
                      <option key={c.id} value={c.id}>{c.parentId ? '  └ ' : ''}{getName(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-white/70 mb-1.5 block">{t('categories.sortOrder')}</label>
                  <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(+e.target.value)} min={0} />
                </div>
              </div>

              {/* Category Image — Upload or URL */}
              <div className="mb-6">
                <label className="text-sm font-medium text-white/70 mb-2 block">{t('categories.imageUrl')}</label>
                {imageUrl ? (
                  <div className="relative group rounded-xl overflow-hidden border border-white/[0.06] bg-[#1a1a2e]">
                    <img src={imageUrl} alt="" className="w-full h-48 object-cover" onError={(e) => { (e.target as HTMLImageElement).src = '' }} />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <label className="px-4 py-2 rounded-lg bg-white/20 text-white text-sm font-medium cursor-pointer hover:bg-white/30 transition-colors">
                        {locale === 'ar' ? 'تغيير' : 'Ändern'}
                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const formData = new FormData()
                          formData.append('file', file)
                          formData.append('folder', 'categories')
                          try {
                            const { data } = await api.post('/uploads/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
                            setImageUrl(data.url ?? data.path ?? '')
                          } catch { /* fallback: keep URL input */ }
                        }} />
                      </label>
                      <button onClick={() => setImageUrl('')} className="px-4 py-2 rounded-lg bg-red-500/80 text-white text-sm font-medium hover:bg-red-500 transition-colors">
                        {locale === 'ar' ? 'حذف' : 'Entfernen'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-40 rounded-xl border-2 border-dashed border-white/10 hover:border-[#d4a853]/30 bg-[#1a1a2e] cursor-pointer transition-colors group">
                    <ImageIcon className="h-8 w-8 text-white/20 group-hover:text-[#d4a853]/50 transition-colors mb-2" />
                    <span className="text-xs text-white/30 group-hover:text-white/50">{locale === 'ar' ? 'اسحب صورة أو انقر للتحميل' : 'Bild hierher ziehen oder klicken'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const formData = new FormData()
                      formData.append('file', file)
                      formData.append('folder', 'categories')
                      try {
                        const { data } = await api.post('/uploads/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
                        setImageUrl(data.url ?? data.path ?? '')
                      } catch { /* fallback below */ }
                    }} />
                    <span className="text-[10px] text-white/20 mt-2">{locale === 'ar' ? 'أو أدخل رابط URL' : 'Oder URL eingeben'}</span>
                  </label>
                )}
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-2 bg-white/[0.05] border-white/[0.08] text-sm"
                />
              </div>

              {/* Icon Picker — canonical icon set for header dropdown */}
              <CategoryIconPicker
                value={iconKey}
                onChange={setIconKey}
                slug={slug}
                locale={locale}
              />

              {/* C6 — Google Product Taxonomy picker. Required by Google
                   Shopping Merchant Center for best listing quality;
                   falls back to the category name if null. */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {locale === 'ar' ? 'تصنيف جوجل شوبينج' : locale === 'en' ? 'Google Shopping Category' : 'Google-Shopping-Kategorie'}
                </label>
                <GoogleTaxonomyPicker
                  locale={locale}
                  value={googleCategoryId}
                  valueLabel={googleCategoryLabel}
                  onChange={(id, label) => {
                    setGoogleCategoryId(id)
                    setGoogleCategoryLabel(label)
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {locale === 'ar'
                    ? 'مطلوب من Google Shopping Merchant Center لأفضل جودة قائمة.'
                    : locale === 'en'
                      ? 'Required by Google Shopping Merchant Center for best listing quality.'
                      : 'Von Google Shopping Merchant Center für beste Listing-Qualität benötigt.'}
                </p>
              </div>

              {/* eBay Category-Tree ID (C11a) */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  {locale === 'ar' ? 'معرف فئة eBay' : locale === 'en' ? 'eBay Category ID' : 'eBay-Kategorie-ID'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ebayCategoryId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '').trim()
                    setEbayCategoryId(v.length > 0 ? v : null)
                  }}
                  placeholder={locale === 'ar' ? 'مثال: 11483' : 'z.B. 11483'}
                  className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                  maxLength={12}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {locale === 'ar'
                    ? 'رقم فئة من شجرة eBay (غير مرتبط بـ Google). مطلوب قبل نشر المنتجات على eBay.'
                    : locale === 'en'
                      ? 'Leaf category ID from eBay’s own tree (distinct from Google). Required before publishing products to eBay.'
                      : 'Blatt-Kategorie-ID aus eBay’s eigenem Kategoriebaum (unabhängig von Google). Pflicht vor dem Publish auf eBay.'}
                </p>
              </div>

              {/* Delete error toast — removed in Commit 3 (replaced
                  by DeleteCategoryModal). Kept comment as anchor for
                  any late reviewer wondering where the 4s flash went. */}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-4 border-t">
                <Button onClick={handleSave} disabled={!slug || !nameDe || saveMutation.isPending} className="gap-1.5 bg-green-600 hover:bg-green-700">
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('categories.save')}
                </Button>
                {isNew && (
                  <Button variant="outline" onClick={() => { setIsNew(false); clearForm() }}>{t('categories.cancel')}</Button>
                )}
                {!isNew && selected && (
                  selected.isActive === false ? (
                    // Context-adaptive: archived categories show a green
                    // "Reactivate" button instead of the destructive "Delete".
                    // Same handleDelete → same DeleteCategoryModal, which
                    // detects isActive=false and renders State C. No new
                    // click-handler needed — the modal routing already
                    // handles the branch (delete-category-modal.tsx:75).
                    <Button
                      size="sm"
                      onClick={handleDelete}
                      className="ml-auto gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {locale === 'ar' ? 'إعادة تفعيل' : locale === 'en' ? 'Reactivate' : 'Reaktivieren'}
                    </Button>
                  ) : (
                    <Button variant="destructive" size="sm" onClick={handleDelete} className="ml-auto gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" />{t('categories.delete')}
                    </Button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Commit 3: delete / archive / reactivate modal */}
      <DeleteCategoryModal
        open={deleteModalOpen}
        category={selected as any}
        allCategories={(categories ?? []) as any}
        onClose={() => setDeleteModalOpen(false)}
        onArchived={() => {
          setDeleteModalOpen(false)
          qc.invalidateQueries({ queryKey: ['admin-categories'] })
          setSelectedId(null)
        }}
        onReactivated={() => {
          setDeleteModalOpen(false)
          qc.invalidateQueries({ queryKey: ['admin-categories'] })
        }}
      />
    </div>
  )
}

/* ─── Sortable Tree Item ─── */
function TreeItem({ cat, depth, isSelected, onSelect, onToggle, isCollapsed, hasChildren, getName, onAddChild, onMoveUp, onMoveDown }: {
  cat: Category; depth: number; isSelected: boolean
  onSelect: () => void; onToggle?: () => void; isCollapsed?: boolean
  hasChildren?: boolean; getName: (c: Category) => string; onAddChild?: () => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const productCount = cat._count?.products ?? 0
  const isParent = depth === 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center group transition-colors ${
        isSelected
          ? 'bg-[#d4a853]/10 border-r-2 rtl:border-r-0 rtl:border-l-2 border-[#d4a853]'
          : 'hover:bg-white/[0.03]'
      } ${isParent ? 'py-1' : ''}`}
    >
      {/* Move up/down + Drag handle */}
      <div className="flex items-center ltr:ml-0.5 rtl:mr-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onMoveUp && (
          <button onClick={(e) => { e.stopPropagation(); onMoveUp() }} className="p-0.5 text-white/20 hover:text-[#d4a853] transition-colors" title="Move up">
            <ArrowUp className="h-3 w-3" />
          </button>
        )}
        {onMoveDown && (
          <button onClick={(e) => { e.stopPropagation(); onMoveDown() }} className="p-0.5 text-white/20 hover:text-[#d4a853] transition-colors" title="Move down">
            <ArrowDown className="h-3 w-3" />
          </button>
        )}
      </div>
      <button {...attributes} {...listeners} className="p-1 cursor-grab active:cursor-grabbing text-white/10 hover:text-white/30 transition-colors">
        <GripVertical className="h-3 w-3" />
      </button>

      {/* Indent for children */}
      {depth > 0 && (
        <div className="flex items-center ltr:ml-3 rtl:mr-3">
          <div className="w-4 h-px bg-white/[0.08]" />
        </div>
      )}

      {/* Toggle arrow (parents only) */}
      {onToggle && hasChildren ? (
        <button onClick={onToggle} className="p-1 flex-shrink-0 text-white/30 hover:text-white/60 transition-colors">
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : isParent ? <span className="w-7" /> : null}

      {/* Name */}
      <button
        onClick={onSelect}
        className={`flex-1 text-start px-2 py-2 truncate transition-colors ${
          cat.isActive === false ? 'grayscale opacity-60' : ''
        } ${
          isSelected
            ? 'text-[#d4a853] font-semibold'
            : isParent
              ? 'text-white/90 font-semibold text-sm'
              : 'text-white/50 text-[13px] hover:text-white/70'
        }`}
      >
        {getName(cat)}
      </button>

      {/* Commit 3: Archived badge — shown only when isActive=false.
          TreeItem doesn't receive locale explicitly, and adding a param
          would churn every call-site; since the admin UI is language-
          tabbed but the badge is purely status-metadata, the 3-lang
          word fits inline via a tiny inline map. */}
      {cat.isActive === false && (
        <ArchivedBadge />
      )}

      {/* Product count badge */}
      <span className={`text-[10px] tabular-nums px-2 py-0.5 rounded-full ltr:mr-1 rtl:ml-1 ${
        productCount > 0
          ? 'bg-[#d4a853]/15 text-[#d4a853]'
          : 'bg-white/[0.04] text-white/20'
      }`}>
        {productCount}
      </span>

      {/* Add child button (parents only, on hover) */}
      {onAddChild && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddChild() }}
          className="p-1 ltr:mr-1 rtl:ml-1 opacity-0 group-hover:opacity-100 hover:bg-[#d4a853]/10 rounded text-[#d4a853] transition-all"
          title="Unterkategorie hinzufügen"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function ArchivedBadge() {
  const locale = useLocale()
  const label = locale === 'ar' ? 'مؤرشفة' : locale === 'en' ? 'Archived' : 'Archiviert'
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full ltr:mr-1 rtl:ml-1 bg-white/[0.04] text-white/40 border border-white/[0.08]">
      {label}
    </span>
  )
}

function StatCard({ value, label, color }: { value: number; label: string; color?: string }) {
  const colorClass = color === 'orange' ? 'text-orange-400' : color === 'green' ? 'text-green-400' : 'text-white'
  return (
    <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04] text-center">
      <p className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      <p className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  )
}
