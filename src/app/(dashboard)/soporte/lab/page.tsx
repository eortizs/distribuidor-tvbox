import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Lab",
}

export const instant = false

export default function LabPage() {
  return <div className="flex flex-1 flex-col p-4 md:p-6" />
}
