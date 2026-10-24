export const mobileNavClass = {
  item: "h-12 gap-3 px-3 text-base md:h-8 md:gap-2 md:px-2 md:text-sm [&_svg]:size-5 md:[&_svg]:size-4",
  menu: "gap-1 md:gap-0",
  groupLabel: "px-3 text-sm md:px-2 md:text-xs",
  dropdownContent: "w-64 md:w-56",
  dropdownItem:
    "gap-2 px-3 py-2.5 text-base md:gap-1.5 md:px-1.5 md:py-1 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownRadioItem:
    "py-2.5 pl-3 text-base md:py-1 md:pl-1.5 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownSubTrigger:
    "gap-2 px-3 py-2.5 text-base md:gap-1.5 md:px-1.5 md:py-1 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownSubContent: "w-40 md:w-32",
} as const
