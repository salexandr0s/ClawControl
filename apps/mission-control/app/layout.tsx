import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { LayoutProvider } from '@/lib/layout-context'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mission Control | SAVORG',
  description: 'Local-first multi-agent orchestration platform',
}

export const viewport: Viewport = {
  themeColor: '#0B0F14',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased bg-bg-0 text-fg-0 min-h-screen">
        <LayoutProvider>
          {children}
        </LayoutProvider>
      </body>
    </html>
  )
}
