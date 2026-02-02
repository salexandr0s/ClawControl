import { getWorkspaceFiles } from '@/lib/data'
import { WorkspaceClient } from './workspace-client'

export default async function WorkspacePage() {
  // Fetch root-level files for initial render
  const initialFiles = await getWorkspaceFiles('/')
  return <WorkspaceClient initialFiles={initialFiles} />
}
