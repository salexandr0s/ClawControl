'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageSection, EmptyState } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { StationIcon } from '@/components/station-icon'
import { useStations } from '@/lib/stations-context'
import { stationsApi, HttpError } from '@/lib/http'
import type { StationDTO } from '@/lib/repo'
import { STATION_ICON_COMPONENTS, STATION_ICON_KEYS, type StationIconKey } from '@/lib/stations/icon-map'
import { cn } from '@/lib/utils'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'

export function StationsTab() {
  const stationMutationsEnabled = process.env.NEXT_PUBLIC_ENABLE_STATION_MUTATIONS === '1'
  const { stations, refreshStations, loading, error } = useStations()
  const triggerProtectedAction = useProtectedActionTrigger()

  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [editing, setEditing] = useState<StationDTO | null>(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => [...stations].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name)), [stations])

  const columns: Column<StationDTO>[] = [
    {
      key: 'name',
      header: 'Station',
      width: '220px',
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <StationIcon stationId={row.id} />
          <div className="min-w-0">
            <div className="text-sm text-fg-0 truncate">{row.name}</div>
            <div className="text-xs text-fg-3 font-mono truncate">{row.id}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'icon',
      header: 'Icon',
      width: '120px',
      mono: true,
      render: (row) => <span className="text-xs text-fg-2">{row.icon}</span>,
    },
    {
      key: 'sortOrder',
      header: 'Sort',
      width: '70px',
      align: 'right',
      mono: true,
      render: (row) => <span className="text-xs text-fg-2">{row.sortOrder}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="text-xs text-fg-2 line-clamp-1">
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      align: 'right',
      render: (row) => (
        stationMutationsEnabled ? (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(row)}
              className="p-1.5 rounded border border-bd-0 bg-bg-3 hover:bg-bg-2 text-fg-2 hover:text-fg-0 transition-colors"
              title="Edit station"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                triggerProtectedAction({
                  actionKind: 'station.delete',
                  actionTitle: 'Delete Station',
                  actionDescription: `Delete station "${row.name}". This cannot be undone.`,
                  entityName: row.name,
                  onConfirm: async (typedConfirmText) => {
                    try {
                      await stationsApi.delete(row.id, { typedConfirmText })
                      await refreshStations()
                      setResult({ ok: true, message: `Deleted station "${row.name}"` })
                    } catch (err) {
                      if (err instanceof HttpError && err.message === 'STATION_IN_USE') {
                        setResult({ ok: false, message: `Station is in use by ${err.details?.agentCount ?? 'some'} agent(s)` })
                      } else {
                        setResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to delete station' })
                      }
                      throw err
                    }
                  },
                  onError: (err) => setResult({ ok: false, message: err.message }),
                })
              }}
              className="p-1.5 rounded border border-bd-0 bg-bg-3 hover:bg-bg-2 text-fg-2 hover:text-fg-0 transition-colors"
              title="Delete station"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-fg-3">Locked</span>
        )
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {result && (
        <div
          className={cn(
            'flex items-center justify-between p-3 rounded-[var(--radius-md)] border',
            result.ok
              ? 'bg-status-success/10 border-status-success/30 text-status-success'
              : 'bg-status-danger/10 border-status-danger/30 text-status-danger'
          )}
        >
          <div className="flex items-center gap-2">
            {result.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span className="text-sm">{result.message}</span>
          </div>
          <button onClick={() => setResult(null)} className="p-1 hover:bg-bg-3/50 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <PageSection
        title="Stations"
        description={stationMutationsEnabled
          ? 'Categories for agents (icons, ordering, display names)'
          : 'Canonical station set is locked for v1 defaults (read-only).'}
        actions={stationMutationsEnabled
          ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-progress text-white hover:bg-status-progress/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Station
            </button>
          )
          : undefined}
      >
        {loading ? (
          <div className="text-xs text-fg-3">Loading…</div>
        ) : error ? (
          <EmptyState title="Failed to load stations" description={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No stations" description="Create a station to get started" />
        ) : (
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
            <CanonicalTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              density="compact"
            />
          </div>
        )}
      </PageSection>

      {stationMutationsEnabled && (
        <StationUpsertModal
          open={creating}
          mode="create"
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false)
            setResult({ ok: true, message: 'Created station' })
          }}
        />
      )}

      {stationMutationsEnabled && (
        <StationUpsertModal
          open={!!editing}
          mode="edit"
          station={editing ?? undefined}
          onClose={() => setEditing(null)}
          onSuccess={(s) => {
            setEditing(null)
            setResult({ ok: true, message: `Updated station "${s.name}"` })
          }}
        />
      )}
    </div>
  )
}

export function StationUpsertModal({
  open,
  mode,
  station,
  onClose,
  onSuccess,
}: {
  open: boolean
  mode: 'create' | 'edit'
  station?: StationDTO
  onClose: () => void
  onSuccess?: (station: StationDTO) => void
}) {
  const triggerProtectedAction = useProtectedActionTrigger()
  const { refreshStations } = useStations()

  const [name, setName] = useState(station?.name ?? '')
  const [description, setDescription] = useState(station?.description ?? '')
  const [color, setColor] = useState(station?.color ?? '')
  const [sortOrder, setSortOrder] = useState<number>(station?.sortOrder ?? 0)
  const [icon, setIcon] = useState<StationIconKey>(() => {
    const candidate = station?.icon
    return (STATION_ICON_KEYS as readonly string[]).includes(candidate ?? '') ? (candidate as StationIconKey) : 'tag'
  })
  const [localError, setLocalError] = useState<string | null>(null)

  // Reset form when station changes / open toggles
  useEffect(() => {
    if (!open) return
    setLocalError(null)
    setName(station?.name ?? '')
    setDescription(station?.description ?? '')
    setColor(station?.color ?? '')
    setSortOrder(station?.sortOrder ?? 0)
    const candidate = station?.icon
    setIcon((STATION_ICON_KEYS as readonly string[]).includes(candidate ?? '') ? (candidate as StationIconKey) : 'tag')
  }, [open, station?.id])

  if (!open) return null

  const title = mode === 'create' ? 'Create Station' : `Edit Station (${station?.id})`

  const handleSubmit = () => {
    setLocalError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setLocalError('Name is required')
      return
    }

    const payload = {
      name: trimmedName,
      icon,
      description: description.trim().length ? description.trim() : null,
      color: color.trim().length ? color.trim() : null,
      sortOrder,
    }

    triggerProtectedAction({
      actionKind: mode === 'create' ? 'station.create' : 'station.update',
      actionTitle: title,
      actionDescription: mode === 'create'
        ? `Create new station "${trimmedName}"`
        : `Update station "${station?.name ?? ''}"`,
      entityName: trimmedName,
      onConfirm: async (typedConfirmText) => {
        try {
          let saved: StationDTO
          if (mode === 'create') {
            const res = await stationsApi.create({ ...payload, typedConfirmText })
            saved = res.data
          } else {
            if (!station) throw new Error('Missing station')
            const res = await stationsApi.update(station.id, { ...payload, typedConfirmText })
            saved = res.data
          }
          await refreshStations()
          onSuccess?.(saved)
        } catch (err) {
          if (err instanceof HttpError && err.message === 'STATION_NAME_TAKEN') {
            setLocalError('A station with that name already exists')
          } else if (err instanceof HttpError && err.message === 'STATION_ID_TAKEN') {
            setLocalError('Could not allocate an id for this station (too many collisions)')
          } else {
            setLocalError(err instanceof Error ? err.message : 'Save failed')
          }
          throw err
        }
      },
      onError: (err) => setLocalError(err.message),
    })
  }

  const Icon = STATION_ICON_COMPONENTS[icon]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-0/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-bg-1 rounded-[var(--radius-lg)] border border-bd-0 shadow-xl">
        <div className="p-4 border-b border-bd-0 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-fg-0">{title}</div>
            <div className="text-xs text-fg-3">Requires typed confirmation</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-3/50 rounded">
            <X className="w-4 h-4 text-fg-2" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {localError && (
            <div className="p-2 rounded border border-status-danger/30 bg-status-danger/10 text-status-danger text-xs">
              {localError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0"
                placeholder="e.g. Build"
              />
              {mode === 'edit' && station?.id && (
                <div className="text-[10px] text-fg-3 font-mono">id: {station.id}</div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-fg-2">Sort Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value || '0', 10))}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-fg-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 min-h-[64px]"
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Color (hex)</label>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 font-mono"
                placeholder="#94A3B8"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Selected Icon</label>
              <div className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 inline-flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-xs text-fg-2 font-mono">{icon}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-fg-2">Icon</label>
            <div className="grid grid-cols-8 gap-2">
              {STATION_ICON_KEYS.map((key) => {
                const I = STATION_ICON_COMPONENTS[key]
                const selected = key === icon
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIcon(key)}
                    className={cn(
                      'p-2 rounded border transition-colors',
                      selected
                        ? 'bg-status-progress/10 text-status-progress border-status-progress/30'
                        : 'bg-bg-2 text-fg-2 border-bd-0 hover:border-bd-1 hover:text-fg-0'
                    )}
                    title={key}
                  >
                    <I className="w-4 h-4 mx-auto" />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-bd-0 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-progress text-white hover:bg-status-progress/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
