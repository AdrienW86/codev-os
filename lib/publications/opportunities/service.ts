import {scoreOpportunity} from './scoring';
import {historyProvider} from './history';
import {seasonalityProvider} from './seasonality';
import {candidate,type OpportunityContext,type OpportunityProvider} from './types';
export async function collectOpportunities(context:OpportunityContext,providers:OpportunityProvider[]=[historyProvider,seasonalityProvider]){if(!context.services.length)return [];const results=(await Promise.all(providers.map(p=>p.collect(context)))).flat().filter(o=>context.services.includes(o.service));results.push(...context.services.map(s=>candidate(s,'editorial_rules','Prestation explicitement confirmée dans les règles du projet.')));return results.map(o=>scoreOpportunity({...o,dimensions:{...o.dimensions,history_penalty:context.recentSubjects.some(s=>s.toLocaleLowerCase('fr').includes(o.service.toLocaleLowerCase('fr')))?1:o.dimensions.history_penalty}})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));}
