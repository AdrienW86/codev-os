const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
});

export function formatDate(date: string | null | undefined) {
  if (!date) return "—";

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/i.test(date);
  if (!dateOnly && !timestamp) return "—";

  const day = date.slice(0, 10);
  const calendarDate = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) return "—";

  const value = dateOnly ? calendarDate : new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(date) ? date : `${date}Z`);
  return Number.isNaN(value.getTime()) ? "—" : dateFormatter.format(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** Instant affiché en heure de Paris (« 12 oct., 08:00 »). */
export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}
