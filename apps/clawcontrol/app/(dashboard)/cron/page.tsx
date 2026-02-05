import { CronClient } from './cron-client'

export const metadata = {
  title: 'Cron | clawcontrol',
  description: 'Manage OpenClaw cron jobs',
}

export default function CronPage() {
  return <CronClient />
}

