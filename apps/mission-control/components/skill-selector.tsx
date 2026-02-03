'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { X, Search, Loader2, Globe, Check, Copy } from 'lucide-react'
import { skillsApi, type SkillSummary } from '@/lib/http'

interface SkillSelectorProps {
  isOpen: boolean
  onClose: () => void
  agentId: string
  agentName: string
  onSelectSkills: (skillIds: string[]) => void
}

export function SkillSelector({
  isOpen,
  onClose,
  agentId,
  agentName,
  onSelectSkills,
}: SkillSelectorProps) {
  const [globalSkills, setGlobalSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Load global skills
  useEffect(() => {
    if (!isOpen) return

    async function loadSkills() {
      setLoading(true)
      setError(null)
      try {
        const result = await skillsApi.list({ scope: 'global' })
        setGlobalSkills(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load skills')
      } finally {
        setLoading(false)
      }
    }

    loadSkills()
  }, [isOpen])

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set())
      setSearch('')
    }
  }, [isOpen])

  // Filter skills by search
  const filteredSkills = globalSkills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase())
  )

  const toggleSkill = (skillId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }

  const handleConfirm = () => {
    if (selected.size === 0) return
    onSelectSkills(Array.from(selected))
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col bg-bg-1 rounded-[var(--radius-lg)] border border-white/[0.06] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div>
            <h2 className="text-sm font-semibold text-fg-0">Add Skills to {agentName}</h2>
            <p className="text-xs text-fg-2">Select global skills to duplicate to this agent</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg-3 rounded-[var(--radius-md)] text-fg-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-white/[0.06]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-progress/50"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-status-danger/10 text-status-danger text-sm">
            {error}
          </div>
        )}

        {/* Skills list */}
        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-fg-2" />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-8 text-fg-3 text-sm">
              {search ? 'No skills match your search' : 'No global skills available'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSkills.map((skill) => {
                const isSelected = selected.has(skill.id)
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={cn(
                      'w-full flex items-start gap-3 p-3 text-left rounded-[var(--radius-md)] transition-colors',
                      isSelected
                        ? 'bg-status-progress/10 border border-status-progress/30'
                        : 'hover:bg-bg-3 border border-transparent'
                    )}
                  >
                    <div
                      className={cn(
                        'flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                        isSelected
                          ? 'bg-status-progress border-status-progress'
                          : 'border-fg-3'
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-fg-3" />
                        <span className="text-sm font-medium text-fg-0">{skill.name}</span>
                        <span className="text-xs text-fg-3">v{skill.version}</span>
                      </div>
                      <p className="text-xs text-fg-2 mt-0.5 line-clamp-2">
                        {skill.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
          <span className="text-xs text-fg-3">
            {selected.size} skill{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-fg-2 hover:text-fg-0 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                selected.size > 0
                  ? 'bg-status-progress text-white hover:bg-status-progress/90'
                  : 'bg-bg-3 text-fg-3 cursor-not-allowed'
              )}
            >
              <Copy className="w-4 h-4" />
              Duplicate to Agent
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
