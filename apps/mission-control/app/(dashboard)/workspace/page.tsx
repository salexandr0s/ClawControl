import { getWorkspaceFiles } from '@/lib/data'
import { WorkspaceClient } from './workspace-client'

export default async function WorkspacePage() {
  // Server-render a first pass (root listing) for fast load.
  const initialFiles = await getWorkspaceFiles('/')
  return <WorkspaceClient initialFiles={initialFiles} />
}
