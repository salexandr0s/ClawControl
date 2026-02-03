'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react'

export type Theme = 'dark' | 'dim'
export type Density = 'compact' | 'default'

interface SettingsContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  density: Density
  setDensity: (density: Density) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const THEME_STORAGE_KEY = 'savorg-theme'
const DENSITY_STORAGE_KEY = 'savorg-density'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [density, setDensityState] = useState<Density>('compact')

  // Load saved preferences
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
      if (savedTheme && ['dark', 'dim'].includes(savedTheme)) {
        setThemeState(savedTheme)
      }

      const savedDensity = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null
      if (savedDensity && ['compact', 'default'].includes(savedDensity)) {
        setDensityState(savedDensity)
      }
    }
  }, [])

  // Apply theme class to document
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const html = document.documentElement
      // Remove old theme class
      html.classList.remove('theme-dim')
      // Add new theme class if dim
      if (theme === 'dim') {
        html.classList.add('theme-dim')
      }
    }
  }, [theme])

  // Apply density class to document
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const html = document.documentElement
      // Remove old density class
      html.classList.remove('density-compact')
      // Add compact class if compact
      if (density === 'compact') {
        html.classList.add('density-compact')
      }
    }
  }, [density])

  // Save theme preference
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme)
    }
  }, [])

  // Save density preference
  const setDensity = useCallback((newDensity: Density) => {
    setDensityState(newDensity)
    if (typeof window !== 'undefined') {
      localStorage.setItem(DENSITY_STORAGE_KEY, newDensity)
    }
  }, [])

  return (
    <SettingsContext.Provider value={{ theme, setTheme, density, setDensity }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
