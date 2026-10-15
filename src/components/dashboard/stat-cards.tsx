import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PinIcon,
  SettingsIcon,
  Share2Icon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"

type Stat = {
  title: string
  value: string
  delta: string
  direction: "up" | "down"
  trend: "positive" | "negative"
  last: string
}

const stats: Stat[] = [
  {
    title: "Revenue",
    value: "$12.4k",
    delta: "12.5%",
    direction: "up",
    trend: "positive",
    last: "$11.0k",
  },
  {
    title: "Active users",
    value: "8,420",
    delta: "8.1%",
    direction: "up",
    trend: "positive",
    last: "7,780",
  },
  {
    title: "Orders",
    value: "1,893",
    delta: "4.3%",
    direction: "down",
    trend: "negative",
    last: "1,978",
  },
  {
    title: "Refund rate",
    value: "1.8%",
    delta: "0.5%",
    direction: "down",
    trend: "positive",
    last: "2.3%",
  },
]

export function StatCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const positive = stat.trend === "positive"
        const DeltaIcon = stat.direction === "up" ? ArrowUpIcon : ArrowDownIcon

        return (
          <Card key={stat.title} className="w-full">
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-muted-foreground text-sm font-medium">
                  {stat.title}
                </h3>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-me-1.5"
                        aria-label={`${stat.title} options`}
                      />
                    }
                  >
                    <MoreHorizontalIcon aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuItem>
                        <SettingsIcon aria-hidden="true" />
                        Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <TriangleAlertIcon aria-hidden="true" />
                        Add Alert
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <PinIcon aria-hidden="true" />
                        Pin to Dashboard
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Share2Icon aria-hidden="true" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">
                        <TrashIcon aria-hidden="true" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-foreground text-2xl font-medium tracking-tight tabular-nums">
                    {stat.value}
                  </span>
                  <Badge variant={positive ? "success-light" : "destructive-light"}>
                    <DeltaIcon aria-hidden="true" />
                    {stat.delta}
                  </Badge>
                </div>
                <Separator />
                <div className="text-muted-foreground text-xs">
                  Vs last month:{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {stat.last}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
