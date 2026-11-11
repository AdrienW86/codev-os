// Chef d'orchestre : la semaine d'un client, jour par jour, à partir des seules échéances enregistrées
// (diffusions programmées, articles prévus, exécutions planifiées). Fonction pure : rien d'estimé ni d'inventé.
import { harnessCharters, type HarnessAgentId } from "./charter";

export type WeekEvent = { at: string; agent: HarnessAgentId; text: string };
export type WeekItem = { agent: HarnessAgentId; name: string; text: string; time: string; count: number };
export type WeekDay = { date: string; label: string; items: WeekItem[] };
export type WeekPlan = { days: WeekDay[]; cadence: { agent: HarnessAgentId; name: string; text: string }[]; total: number };

const TZ = "Europe/Paris";
const DAY = 86_400_000;
const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const timeOf = (date: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(date);
const labelOf = (date: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }).format(date);
const nameOf = (id: HarnessAgentId) => harnessCharters.find((c) => c.id === id)?.name ?? id;

/** 7 jours à partir d'aujourd'hui (heure de Paris). Les échéances identiques d'un même jour sont regroupées. */
export function buildWeekPlan(input: { now: Date; events: readonly WeekEvent[]; cadence?: readonly { agent: HarnessAgentId; text: string }[] }): WeekPlan {
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(input.now.getTime() + i * DAY);
    days.push({ date: dayOf(date), label: labelOf(date), items: [] });
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  const end = input.now.getTime() + 7 * DAY;
  const sorted = [...input.events].filter((event) => {
    const at = Date.parse(event.at);
    return Number.isFinite(at) && at >= input.now.getTime() - 60_000 && at < end;
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let total = 0;
  for (const event of sorted) {
    const at = new Date(event.at);
    const day = byDate.get(dayOf(at));
    if (!day) continue;
    total++;
    const same = day.items.find((item) => item.agent === event.agent && item.text === event.text);
    if (same) { same.count++; continue; }
    day.items.push({ agent: event.agent, name: nameOf(event.agent), text: event.text, time: timeOf(at), count: 1 });
  }
  return { days, cadence: (input.cadence ?? []).map((item) => ({ ...item, name: nameOf(item.agent) })), total };
}
