import type {MediaCandidate,PhotoAnalysis} from '../media/types';
import type {Opportunity} from '../opportunities/types';
import type {PublicationPlatform} from '../types';
export type Usage={input_tokens:number;output_tokens:number;estimated_cost_eur:number;model:string};
export type GenerationContext={client_name:string;services:string[];zone:string|null;website:string|null;rules:string;subject:string;opportunity:Opportunity;photo:MediaCandidate;platforms:PublicationPlatform[];approved_sentences:string[];rejection:string|null;previous_texts:string[];client_activity?:string|null;client_notes?:string|null;project_name?:string;cadence?:unknown;history?:unknown};
export type GeneratedContent={internal_title:string;subject:string;source_content:string;selected_opportunity:string;selected_asset_id:string;facebook:{text:string;title:string|null;cta:string|null}|null;instagram:{text:string;title:string|null;cta:string|null}|null;google_business_profile:{text:string;title:string|null;cta:string|null}|null;factual_basis:string[];generation_summary:string};
export interface PublicationsAIProvider{analyze(photos:{id:string;bytes:Uint8Array}[]):Promise<{analyses:{id:string;analysis:PhotoAnalysis}[];usage:Usage}>;generate(context:GenerationContext):Promise<{content:unknown;usage:Usage}>;}
export const MANUAL_RUN_RESERVE_EUR=.1;
