import type {Opportunity,OpportunityProvider} from './types';
export type BusinessSignal={service:string;leads:number;measuredAt:string};
export function applyBusinessSignals(opportunities:Opportunity[],signals:BusinessSignal[]):Opportunity[]{return opportunities.map(o=>{const s=signals.find(s=>s.service===o.service&&Number.isFinite(s.leads)&&s.leads>0);return s?{...o,dimensions:{...o.dimensions,business_relevance:.95},sources:[...o.sources,{id:`ads:${s.service}`,source:'google_ads',description:'Conversions mesurées ; pondération business uniquement.',measured_at:s.measuredAt,metrics:{leads:s.leads}}]}:o;});}
// Ads is deliberately not a source of fabricated SEO candidates.
export const googleAdsProvider:OpportunityProvider={source:'google_ads',async collect(){return [];}};
