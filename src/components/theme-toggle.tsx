"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { mobileNavClass } from "@/components/dashboard/nav-layout"

const themeOptions = [
  { value: "light", label: "Claro", icon: SunIcon },
  { value: "dark", label: "Oscuro", icon: MoonIcon },
  { value: "system", label: "Sistema", icon: MonitorIcon },
] as const

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={mobileNavClass.dropdownSubTrigger}>
        <SunIcon className="dark:hidden" aria-hidden="true" />
        <MoonIcon className="hidden dark:block" aria-hidden="true" />
        <span>Tema</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={mobileNavClass.dropdownSubContent}>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className={mobileNavClass.dropdownRadioItem}
            >
              <option.icon aria-hidden="true" />
              <span>{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export { ThemeToggle }
