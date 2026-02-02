import { getPlugins } from '@/lib/data'
import { PluginsClient } from './plugins-client'

export default async function PluginsPage() {
  const plugins = await getPlugins()
  return <PluginsClient plugins={plugins} />
}
