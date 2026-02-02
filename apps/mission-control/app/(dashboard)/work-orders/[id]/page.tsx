import { WorkOrderDetail } from './work-order-detail'

/**
 * Work Order Detail Page (Traveler Packet)
 *
 * Client-rendered page that fetches work order details from the API.
 * Provides tabbed view: Overview, Pipeline, Operations, Messages, Artifacts, Receipts, Activity
 */
export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <WorkOrderDetail workOrderId={id} />
}
