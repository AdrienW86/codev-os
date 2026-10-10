import Link from "next/link";

export type FilterField = { name: string; label: string; value: string; options: { value: string; label: string }[] };
export type DateFilterField = { name: string; label: string; value: string };

const selectClass = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";

/** Barre de filtres GET : fonctionne sans JavaScript, état dans l’URL. */
export function FilterBar({ fields, dates = [], hidden = {}, resetHref, label = "Filtres" }: { fields: FilterField[]; dates?: DateFilterField[]; hidden?: Record<string, string>; resetHref: string; label?: string }) {
  const active = fields.some((field) => field.value) || dates.some((field) => field.value);
  return (
    <form method="get" aria-label={label} className="mb-6 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {fields.map((field) => (
        <label key={field.name} className="min-w-0 text-xs text-muted sm:w-44">
          {field.label}
          <select name={field.name} defaultValue={field.value} className={selectClass}>
            <option value="">Tous</option>
            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ))}
      {dates.map((field) => (
        <label key={field.name} className="min-w-0 text-xs text-muted sm:w-44">
          {field.label}
          <input type="date" name={field.name} defaultValue={field.value} className={selectClass} />
        </label>
      ))}
      <div className="col-span-2 flex gap-2">
        <button type="submit" className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:border-accent/50">Filtrer</button>
        {active && <Link href={resetHref} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:text-foreground">Réinitialiser</Link>}
      </div>
    </form>
  );
}
