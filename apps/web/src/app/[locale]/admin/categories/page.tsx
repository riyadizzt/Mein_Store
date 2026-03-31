'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-modal'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Loader2, ChevronDown, ChevronRight,
  FolderPlus, Trash2, FolderTree, Package, GripVertical, Save, Image as ImageIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

interface Translation { language: string; name: string; description?: string }
interface Category {
  id: string; slug: string; imageUrl: string | null; sortOrder: number
  parentId: string | null; translations: Translation[]
  _count?: { products: number }; children?: Category[]
}

export default function AdminCategoriesPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const confirmDialog = useConfirm()

  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [isNew, setIsNew] = useState(false)
  const [langTab, setLangTab] = useState<'de' | 'en' | 'ar'>('de')
  const [dragId, setDragId] = useState<string | null>(null)

  // Form
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [nameDe, setNameDe] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [descDe, setDescDe] = useState('')
  const [descEn, setDescEn] = useState('')
  const [descAr, setDescAr] = useState('')

  const { data: categories, isLoading } = useQuery<Category[]>({
    queryKey: ['admin-categories'],
    queryFn: async () => { const { data } = await api.get('/admin/categories'); return data },
  })

  const saveMutation = useMutation({
    mutationFn: (p: { id?: string; payload: Record<string, unknown> }) =>
      p.id ? api.put(`/categories/${p.id}`, p.payload) : api.post('/categories', p.payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-categories'] }); if (isNew) setIsNew(false) },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-categories'] }); setSelectedId(null) },
  })
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
    setSortOrder(selected.sortOrder); setNameDe(g('de')?.name ?? ''); setNameEn(g('en')?.name ?? '')
    setNameAr(g('ar')?.name ?? ''); setDescDe(g('de')?.description ?? '')
    setDescEn(g('en')?.description ?? ''); setDescAr(g('ar')?.description ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearForm = () => { setSlug(''); setParentId(''); setImageUrl(''); setSortOrder(0); setNameDe(''); setNameEn(''); setNameAr(''); setDescDe(''); setDescEn(''); setDescAr('') }
  const startNewRoot = () => { clearForm(); setSelectedId(null); setIsNew(true); setParentId('') }
  const startNewChild = (pid: string) => { clearForm(); setSelectedId(null); setIsNew(true); setParentId(pid) }

  const handleSave = () => {
    const translations = [
      { language: 'de', name: nameDe, description: descDe || undefined },
      { language: 'en', name: nameEn, description: descEn || undefined },
      { language: 'ar', name: nameAr, description: descAr || undefined },
    ].filter((tr) => tr.name.trim())
    saveMutation.mutate({ id: isNew ? undefined : selectedId ?? undefined, payload: { slug, parentId: parentId || undefined, imageUrl: imageUrl || undefined, sortOrder, translations } })
  }

  const handleDelete = async () => {
    if (!selected) return
    const cnt = selected._count?.products ?? 0
    if (cnt > 0) {
      setDeleteError(t('categories.deleteHasProducts', { count: cnt }))
      setTimeout(() => setDeleteError(null), 4000)
      return
    }
    const ok = await confirmDialog({
      title: t('categories.delete'),
      description: t('categories.deleteConfirm'),
      variant: 'danger',
      confirmLabel: t('categories.delete'),
      cancelLabel: t('categories.cancel'),
    })
    if (ok) deleteMutation.mutate(selected.id)
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

    // Same parent: reorder
    if (activeItem.parentId === overItem.parentId) {
      reorderMutation.mutate({ id: activeItem.id, sortOrder: overItem.sortOrder })
    } else {
      // Move to new parent
      const newParentId = overItem.parentId === null ? overItem.id : overItem.parentId
      reorderMutation.mutate({ id: activeItem.id, sortOrder: overItem.sortOrder, parentId: newParentId })
    }
  }

  const dragItem = dragId ? allFlat.find((c) => c.id === dragId) : null

  const parentLabel = parentId ? getName(allFlat.find((c) => c.id === parentId) ?? { slug: '?', translations: [], id: '', imageUrl: null, sortOrder: 0, parentId: null }) : null
  const totalSubs = (categories ?? []).reduce((s, c) => s + (c.children?.length ?? 0), 0)
  const totalProds = allFlat.reduce((s, c) => s + (c._count?.products ?? 0), 0)

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('categories.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('categories.title')}</h1>
        <Button size="sm" className="gap-1.5" onClick={startNewRoot}>
          <Plus className="h-3.5 w-3.5" />{t('categories.newMainCategory')}
        </Button>
      </div>

      <div className="flex gap-6 items-start">
        {/* ─── LEFT: DnD Tree ─── */}
        <div className="w-80 flex-shrink-0 bg-background border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{t('categories.title')}</span>
            <span className="text-xs text-muted-foreground ml-auto">{(categories ?? []).length} + {totalSubs}</span>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}</div>
          ) : (categories ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('categories.noCategories')}</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="py-1 max-h-[72vh] overflow-y-auto">
                <SortableContext items={allFlat.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {(categories ?? []).map((dept) => (
                    <div key={dept.id}>
                      <TreeItem cat={dept} depth={0} isSelected={selectedId === dept.id && !isNew}
                        onSelect={() => { setSelectedId(dept.id); setIsNew(false) }}
                        onToggle={() => toggle(dept.id)}
                        isCollapsed={collapsed.has(dept.id)}
                        hasChildren={(dept.children?.length ?? 0) > 0}
                        getName={getName}
                        onAddChild={() => startNewChild(dept.id)}
                      />
                      {!collapsed.has(dept.id) && (dept.children ?? []).map((child) => (
                        <TreeItem key={child.id} cat={child} depth={1}
                          isSelected={selectedId === child.id && !isNew}
                          onSelect={() => { setSelectedId(child.id); setIsNew(false) }}
                          getName={getName}
                        />
                      ))}
                    </div>
                  ))}
                </SortableContext>
              </div>
              <DragOverlay>
                {dragItem && (
                  <div className="bg-primary/10 border border-primary rounded-lg px-3 py-2 text-sm font-medium shadow-lg">
                    {getName(dragItem)}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {/* ─── RIGHT: Detail ─── */}
        <div className="flex-1 bg-background border rounded-xl min-h-[400px]">
          {!selected && !isNew ? (
            /* Stats overview */
            <div className="p-6">
              <h2 className="text-lg font-bold mb-6">{t('categories.noCategorySelected')}</h2>
              <div className="grid grid-cols-2 gap-4">
                <StatCard value={(categories ?? []).length} label={t('categories.title')} />
                <StatCard value={totalSubs} label={t('categories.subcategories')} />
                <StatCard value={totalProds} label={t('categories.products')} />
                <StatCard value={0} label={`${t('categories.products')} (∅)`} color="green" />
              </div>
            </div>
          ) : (
            <div className="p-6">
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
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.name')}</label>
                  {langTab === 'de' && <Input value={nameDe} onChange={(e) => setNameDe(e.target.value)} placeholder="z.B. Herren" onBlur={() => { if (isNew && !slug) autoSlug() }} />}
                  {langTab === 'en' && <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Men" />}
                  {langTab === 'ar' && <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: رجال" dir="rtl" />}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.description')}</label>
                  {langTab === 'de' && <textarea value={descDe} onChange={(e) => setDescDe(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                  {langTab === 'en' && <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                  {langTab === 'ar' && <textarea value={descAr} onChange={(e) => setDescAr(e.target.value)} rows={2} dir="rtl" className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none" />}
                </div>
              </div>

              {/* Slug + Parent + Sort + Image */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.slug')}</label>
                  <div className="flex gap-2">
                    <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="flex-1 font-mono text-xs" />
                    <Button type="button" size="sm" variant="outline" onClick={autoSlug}>Auto</Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.parent')}</label>
                  <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm">
                    <option value="">{t('categories.noParent')}</option>
                    {allFlat.filter((c) => c.id !== selectedId).map((c) => (
                      <option key={c.id} value={c.id}>{c.parentId ? '  └ ' : ''}{getName(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.sortOrder')}</label>
                  <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(+e.target.value)} min={0} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('categories.imageUrl')}</label>
                  <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              {/* Image Preview */}
              {imageUrl && (
                <div className="mb-6 flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <ImageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <img src={imageUrl} alt="" className="h-16 w-16 rounded object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <span className="text-xs text-muted-foreground truncate flex-1">{imageUrl}</span>
                </div>
              )}

              {/* Delete error toast */}
              {deleteError && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium flex items-center gap-2">
                  <span>✕</span> {deleteError}
                </div>
              )}

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
                  <Button variant="destructive" size="sm" onClick={handleDelete} className="ml-auto gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />{t('categories.delete')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Sortable Tree Item ─── */
function TreeItem({ cat, depth, isSelected, onSelect, onToggle, isCollapsed, hasChildren, getName, onAddChild }: {
  cat: Category; depth: number; isSelected: boolean
  onSelect: () => void; onToggle?: () => void; isCollapsed?: boolean
  hasChildren?: boolean; getName: (c: Category) => string; onAddChild?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center group ${isSelected ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/50'}`}>
      {/* Drag handle */}
      <button {...attributes} {...listeners} className="p-1 ml-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground">
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Indent */}
      {depth > 0 && (
        <div className="flex items-center ml-2">
          <div className="w-3 h-px bg-border" />
        </div>
      )}

      {/* Toggle arrow (parents only) */}
      {onToggle && hasChildren ? (
        <button onClick={onToggle} className="p-1 flex-shrink-0">
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : depth === 0 ? <span className="w-7" /> : null}

      {/* Name */}
      <button onClick={onSelect} className={`flex-1 text-left px-2 py-2 text-sm truncate ${isSelected ? 'font-bold text-primary' : depth > 0 ? 'text-muted-foreground' : 'font-medium'}`}>
        {getName(cat)}
      </button>

      {/* Product count badge */}
      {(cat._count?.products ?? 0) > 0 && (
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full mr-1">{cat._count!.products}</span>
      )}

      {/* Add child button (parents only, on hover) */}
      {onAddChild && (
        <button onClick={(e) => { e.stopPropagation(); onAddChild() }} className="p-1 mr-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded text-primary transition-opacity">
          <FolderPlus className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function StatCard({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="bg-muted/30 rounded-xl p-5 text-center">
      <p className={`text-3xl font-bold ${color === 'green' ? 'text-green-600' : ''}`}>{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  )
}
