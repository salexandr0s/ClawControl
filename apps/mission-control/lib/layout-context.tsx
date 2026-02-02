'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react'

export type LayoutMode = 'auto' | 'horizontal' | 'vertical'
export type ResolvedLayout = 'horizontal' | 'vertical'

interface LayoutContextValue {
  mode: LayoutMode
  setMode: (mode: LayoutMode) => void
  resolved: ResolvedLayout
  isNarrow: boolean
  isMobile: boolean
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

const STORAGE_KEY = 'savorg-layout-mode'
const VERTICAL_THRESHOLD = 1.2 // aspect ratio threshold (height/width)
const NARROW_THRESHOLD = 1024 // px
const MOBILE_THRESHOLD = 640 // px

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>('auto')
  const [resolved, setResolved] = useState<ResolvedLayout>('horizontal')
  const [isNarrow, setIsNarrow] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Load saved preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY) as LayoutMode | null
      if (saved && ['auto', 'horizontal', 'vertical'].includes(saved)) {
        setModeState(saved)
      }
    }
  }, [])

  // Save preference
  const setMode = useCallback((newMode: LayoutMode) => {
    setModeState(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newMode)
    }
  }, [])

  // Detect viewport and resolve layout
  useEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const aspectRatio = height / width

      setIsNarrow(width < NARROW_THRESHOLD)
      setIsMobile(width < MOBILE_THRESHOLD)

      if (mode === 'auto') {
        // Use aspect ratio heuristics
        setResolved(aspectRatio > VERTICAL_THRESHOLD ? 'vertical' : 'horizontal')
      } else {
        setResolved(mode)
      }
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [mode])

  return (
    <LayoutContext.Provider value={{ mode, setMode, resolved, isNarrow, isMobile }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}
