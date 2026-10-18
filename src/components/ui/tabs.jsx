import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

// Tabs on Base UI, which supplies the roles, aria-selected, aria-controls, the
// roving tab order and the keys. The Left and Right arrows move focus and selection
// together, and Home and End go to the first and the last tab.
//
//   <Tabs value={tab} onChange={setTab}>
//     <TabList aria-label="Portal sections">
//       <Tab value="jobs">Jobs</Tab>
//       <Tab value="changes" count={3}>Change orders</Tab>
//     </TabList>
//     <TabPanel value="jobs">…</TabPanel>
//     <TabPanel value="changes">…</TabPanel>
//   </Tabs>
//
// Only the selected panel is in the page, so a tab's aria-controls always names an
// element that exists.
function Tabs({ value, onChange, className, ...props }) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      value={value}
      onValueChange={(next) => onChange?.(next)}
      className={className}
      {...props} />
  );
}

// aria-label is the name of the strip. A list of tabs needs one.
function TabList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      data-slot="tab-list"
      activateOnFocus
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-white/10",
        className
      )}
      {...props} />
  );
}

// count is a number shown beside the name. Zero shows nothing, because a count
// is there to say something is waiting.
function Tab({ count, className, children, ...props }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tab"
      className={cn(
        "-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-4 text-sm font-semibold whitespace-nowrap text-neutral outline-none transition-colors hover:text-foreground focus-visible:-outline-offset-2 data-[active]:border-brand data-[active]:text-foreground md:min-h-9",
        className
      )}
      {...props}>
      {children}
      {count > 0 && (
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] leading-none font-bold tabular-nums text-foreground">
          {count}
        </span>
      )}
    </TabsPrimitive.Tab>
  );
}

function TabPanel({ className, ...props }) {
  return (
    <TabsPrimitive.Panel
      data-slot="tab-panel"
      className={className}
      {...props} />
  );
}

export { Tabs, TabList, Tab, TabPanel }
