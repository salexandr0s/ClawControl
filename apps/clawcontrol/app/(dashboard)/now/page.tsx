import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default function LegacyNowPage() {
  redirect('/dashboard' as Route)
}
