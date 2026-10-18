"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  finanzasNav,
  groupLabels,
  herramientasNav,
  navMain,
  navSecondary,
  profileNav,
} from "@/components/dashboard/nav-config"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

type Crumb = {
  href: string
  label: string
  link: boolean
}

const navRouteLabels = new Map<string, string>()

for (const item of [...navMain, ...navSecondary]) {
  if (item.href) {
    navRouteLabels.set(item.href, item.title)
  }
}

navRouteLabels.set("/", groupLabels.main)
navRouteLabels.set("/herramientas", herramientasNav.group)
navRouteLabels.set(herramientasNav.href, herramientasNav.title)
navRouteLabels.set("/finanzas", finanzasNav.group)
for (const child of finanzasNav.children) {
  navRouteLabels.set(child.href, child.title)
}
navRouteLabels.set(profileNav.href, profileNav.title)

const pageTitles: Record<string, string> = {
  "/entities/new": "New entity",
}

const groupHrefs = new Set(["/herramientas", "/finanzas"])

function humanize(segment: string) {
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean)
  const crumbs: Crumb[] = [
    { href: "/", label: groupLabels.main, link: false },
  ]

  let current = ""
  let parent = ""

  for (const segment of segments) {
    parent = current
    current += `/${segment}`
    crumbs.push({
      href: current,
      label:
        navRouteLabels.get(current) ??
        pageTitles[current] ??
        (parent === "/entities" ? "Detalle" : humanize(segment)),
      link: !groupHrefs.has(current),
    })
  }

  return crumbs
}

export function AppBreadcrumb() {
  const pathname = usePathname()
  const crumbs = buildCrumbs(pathname)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <React.Fragment key={crumb.href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : crumb.link ? (
                  <BreadcrumbLink render={<Link href={crumb.href} />}>
                    {crumb.label}
                  </BreadcrumbLink>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator>/</BreadcrumbSeparator>}
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
