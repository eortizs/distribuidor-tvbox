"use client"

import { Accordion } from "@base-ui/react/accordion"
import { ChevronDownIcon } from "lucide-react"
import type { ReactNode } from "react"

export interface FaqAccordionItem {
  id: string
  question: ReactNode
  answer: ReactNode
}

export function FaqAccordion({ items }: { items: FaqAccordionItem[] }) {
  return (
    <Accordion.Root defaultValue={[]} multiple={false} hiddenUntilFound className="flex w-full flex-col gap-3">
      {items.map((item) => (
        <Accordion.Item
          key={item.id}
          value={item.id}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-colors data-open:border-emerald-200 data-open:shadow-sm motion-reduce:transition-none"
        >
          <Accordion.Header className="flex">
            <Accordion.Trigger className="group flex min-h-14 flex-1 cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left text-base font-semibold text-[#0F172A] transition-colors hover:text-[#059669] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#059669] motion-reduce:transition-none">
              <span>{item.question}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-5 shrink-0 text-slate-400 transition-transform duration-200 group-aria-expanded:rotate-180 group-aria-expanded:text-[#059669] motion-reduce:transition-none"
              />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:h-0 data-[ending-style]:h-0 motion-reduce:transition-none">
            <div className="border-t border-slate-100 px-5 pt-3.5 pb-5 text-sm leading-relaxed text-slate-600 sm:text-base">
              {item.answer}
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}
