import { notFound } from "next/navigation"

import {
  EntityPropertiesEditor,
} from "@/components/entities/entity-properties-editor"
import { EntityStateControl } from "@/components/entities/entity-state-control"
import { Badge } from "@/components/reui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { requireUser } from "@/server/auth/guards"
import { getEntity, getEntityEvents } from "@/server/umejson/repository"
import { AppError } from "@/server/umejson/types"
import type { EntityEventRow, EntityRow } from "@/server/umejson/types"

export const instant = false

const eventBadgeVariant: Record<
  string,
  "success-light" | "info-light" | "primary-light" | "outline" | "secondary"
> = {
  created: "success-light",
  "property.updated": "info-light",
  "state.changed": "primary-light",
  "imported.from": "outline",
}

function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date))
}

function EventItem({ event }: { event: EntityEventRow }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={eventBadgeVariant[event.eventType] ?? "secondary"}
          size="sm"
        >
          {event.eventType}
        </Badge>
        <span className="text-muted-foreground text-xs">
          seq {event.seq} · {event.actor}
        </span>
        <span className="text-muted-foreground ml-auto text-xs">
          {formatDateTime(event.occurredAt)}
        </span>
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md p-2 font-mono text-xs">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
      {event.reason ? (
        <p className="text-muted-foreground text-xs">Reason: {event.reason}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        recorded {formatDateTime(event.recordedAt)}
      </p>
    </li>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium break-all">{children}</span>
    </div>
  )
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const scope =
    user.role === "distribuidor"
      ? { ownedByDistribuidorId: user.id }
      : undefined

  let entity: EntityRow
  let events: EntityEventRow[]
  try {
    ;[entity, events] = await Promise.all([
      getEntity(id, scope),
      getEntityEvents(id, scope),
    ])
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") {
      notFound()
    }
    throw error
  }

  const doc = entity.doc

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              {entity.entityName}
            </h1>
            <Badge
              variant={
                doc.state.current === "active"
                  ? "success-light"
                  : doc.state.current === "draft"
                    ? "warning-light"
                    : "info-light"
              }
              size="sm"
            >
              {doc.state.current}
            </Badge>
          </div>
          <p className="text-muted-foreground font-mono text-xs">{entity.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>dynamicProperties</CardTitle>
              <CardDescription>
                Edits emit a property.updated event with the diff.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EntityPropertiesEditor
                key={`${entity.id}:${entity.version}`}
                entityId={entity.id}
                version={entity.version}
                dynamicProperties={doc.dynamicProperties}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>State</CardTitle>
              <CardDescription>
                Transitions emit a state.changed event and rebuild statusLog.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EntityStateControl
                entityId={entity.id}
                version={entity.version}
                currentState={doc.state.current}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>markdownDocumentation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">
                {doc.markdownDocumentation}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Facts</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Fact label="Version">{entity.version}</Fact>
              <Fact label="Created">{formatDateTime(entity.createdAt)}</Fact>
              <Fact label="Updated">{formatDateTime(entity.updatedAt)}</Fact>
              <Separator />
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs">
                  statusLog
                </span>
                <ol className="flex flex-col gap-2">
                  {doc.state.statusLog.map((entry, index) => (
                    <li key={index} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {entry.status}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(entry.timestamp)}
                        {entry.reason ? ` · ${entry.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Events</CardTitle>
              <CardDescription>
                Append-only journal ({events.length} events).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4">
                {events.map((event) => (
                  <EventItem key={event.seq} event={event} />
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
