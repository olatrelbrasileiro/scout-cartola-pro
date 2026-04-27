import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/comparar')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/comparar"!</div>
}
