import { getCronJobs } from '@/lib/data'
import { CronClient } from './cron-client'

export default async function CronPage() {
  const cronJobs = await getCronJobs()
  return <CronClient cronJobs={cronJobs} />
}
