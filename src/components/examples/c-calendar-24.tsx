"use client"

import { useState } from "react"
import { format } from "date-fns"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"

export function Pattern() {
  const [date, setDate] = useState<Date | undefined>()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            className="group/pick-date w-60 justify-between"
            variant="outline"
          >
            <span className={cn("truncate", !date && "text-muted-foreground")}>
              {date ? format(date, "PPP") : "Pick a date"}
            </span>
            <CalendarIcon aria-hidden="true" className="opacity-60 transition-opacity group-hover/pick-date:opacity-100" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" onSelect={setDate} selected={date} />
      </PopoverContent>
    </Popover>
  )
}