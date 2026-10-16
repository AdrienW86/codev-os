// Retry-After carries either integer seconds or an HTTP date. Match the delivery engine's six-hour ceiling;
// reject malformed / unbounded input and expose only a number, never provider header text.
export function publicationRetryAfterSeconds(value:string|null,now=Date.now()):number|null{
 if(value===null||value.length>100)return null;
 const raw=value.trim();let seconds:number;
 if(/^\d{1,12}$/.test(raw))seconds=Number(raw);
 else{
  if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw))return null;
  seconds=Math.ceil((Date.parse(raw)-now)/1000);
 }
 return Number.isFinite(seconds)?Math.min(Math.max(seconds,0),21600):null;
}
