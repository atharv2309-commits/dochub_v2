import type { LucideIcon } from 'lucide-react'

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  hint?: string
}) {
  return (
    <div className="card-elevated rounded-xl p-5 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="font-bold text-3xl mt-2 leading-none tracking-tight">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    </div>
  )
}
