import { PageHeader } from '@clawcontrol/ui'
import { Loader2 } from 'lucide-react'

export default function CronLoading() {
  return (
    <div className="p-3 sm:p-4">
      <PageHeader title="Cron Jobs" subtitle="Loading cron jobs…" />
      <div className="flex items-center gap-2 text-fg-3 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading crons...</span>
      </div>
    </div>
  )
}

