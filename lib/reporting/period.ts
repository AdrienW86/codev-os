export type SummaryPeriod = {month:string;timezone:"Europe/Paris";start:string;endExclusive:string;firstDay:string;lastDay:string};
function parisMidnight(year:number,month:number):string {
  const utc=Date.UTC(year,month,1);
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(utc));
  const offset=Number(parts.find(p=>p.type==="hour")?.value);
  return new Date(utc-offset*3600000).toISOString();
}
export function summaryPeriod(month:string):SummaryPeriod {
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Période invalide : utilisez YYYY-MM (2000–2199).");
  const [year,m]=month.split("-").map(Number);
  return {month,timezone:"Europe/Paris",start:parisMidnight(year,m-1),endExclusive:parisMidnight(year,m),firstDay:`${month}-01`,lastDay:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)};
}
export function previousSummaryMonth(now=new Date()):string {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(now);
  const year=Number(parts.find(p=>p.type==="year")?.value),month=Number(parts.find(p=>p.type==="month")?.value);
  return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
}
