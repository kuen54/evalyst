"use client"

import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { FilterDef } from "@/lib/schema/types"

export function FilterRenderer({ filter, value, onChange }: {
  filter: FilterDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  switch (filter.kind) {
    case "multiselect": {
      const arr = (Array.isArray(value) ? value : []) as Array<string | number>
      return (
        <div className="space-y-1.5">
          <Label>{filter.label}</Label>
          <div className="flex flex-wrap gap-2">
            {filter.options.map(o => {
              const on = arr.includes(o.value)
              return (
                <label key={String(o.value)} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => onChange(on ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                  />
                  {o.label}
                </label>
              )
            })}
          </div>
        </div>
      )
    }

    case "literal_set": {
      const arr = (Array.isArray(value) ? value : []) as unknown[]
      return (
        <div className="space-y-1.5">
          <Label>{filter.label}</Label>
          <div className="flex flex-wrap gap-2">
            {filter.options.map(o => {
              const on = arr.includes(o.value)
              return (
                <label key={String(o.value)} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => onChange(on ? arr.filter(x => x !== o.value) : [...arr, o.value])}
                  />
                  {o.label}
                </label>
              )
            })}
          </div>
        </div>
      )
    }

    case "checkbox": {
      const on = !!value
      return (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={on} onCheckedChange={v => onChange(!!v)} />
          {filter.label}
        </label>
      )
    }

    case "number":
      return (
        <div className="space-y-1.5">
          <Label>{filter.label}</Label>
          <Input
            type="number"
            value={value == null ? "" : String(value)}
            onChange={e => {
              const v = e.target.value
              onChange(v === "" ? undefined : parseInt(v))
            }}
            className="w-32"
          />
        </div>
      )

    case "text_in":
      return (
        <div className="space-y-1.5">
          <Label>{filter.label}</Label>
          <Input
            value={value == null ? "" : String(value)}
            onChange={e => onChange(e.target.value)}
          />
        </div>
      )
  }
}
