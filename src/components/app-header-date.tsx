"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { es } from "@/lib/date-locale"
import { mxToday } from "@/lib/finanzas"

const Calendar = dynamic(
  () => import("@/components/ui/calendar").then((mod) => mod.Calendar),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[16.125rem] w-[13.25rem] rounded-lg" />,
  }
)

function fromIsoDay(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** "Vie 23 Oct" */
function formatLabel(date: Date) {
  const weekday = capitalize(format(date, "EEE", { locale: es }))
  const month = capitalize(format(date, "MMM", { locale: es }))
  return `${weekday} ${format(date, "d")} ${month}`
}

export function AppHeaderDate({ initialDate }: { initialDate: string }) {
  const [today, setToday] = useState(initialDate)
  const [picked, setPicked] = useState<string | null>(null)
  const [month, setMonth] = useState(() => fromIsoDay(initialDate))
  const [open, setOpen] = useState(false)

  const iso = picked ?? today
  const date = fromIsoDay(iso)
  const label = formatLabel(date)

  useEffect(() => {
    const sync = () => {
      const current = mxToday()
      setToday((prev) => (prev === current ? prev : current))
    }
    const id = setInterval(sync, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        const currentToday = mxToday()
        setToday(currentToday)
        setMonth(fromIsoDay(picked ?? currentToday))
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="tabular-nums"
            aria-label={`Fecha ${label}. Abrir calendario`}
          >
            {label}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <PopoverTitle className="sr-only">Calendario</PopoverTitle>
        <Calendar
          mode="single"
          locale={es}
          month={month}
          onMonthChange={setMonth}
          today={fromIsoDay(today)}
          selected={date}
          onSelect={(next) => {
            if (!next) return
            setPicked(format(next, "yyyy-MM-dd"))
            setMonth(next)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
