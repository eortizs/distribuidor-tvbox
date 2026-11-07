import { SectionTabsLayout } from "@/components/dashboard/section-tabs-layout"

export default function HerramientasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SectionTabsLayout>{children}</SectionTabsLayout>
}
