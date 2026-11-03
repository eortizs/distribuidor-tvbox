import { SectionTabsLayout } from "@/components/dashboard/section-tabs-layout"

export default function FinanzasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SectionTabsLayout>{children}</SectionTabsLayout>
}
