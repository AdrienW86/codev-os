import type {AgentRunRow,RecommendationRow,InternalActionRow,TaskRow,ProjectRow} from "@/lib/supabase/database.types";
import type {Client} from "@/lib/clients/types";
import type {Publication,PublicationDelivery,PublicationJob,PublicationRevision,PublicationVariant,PublicationAttempt} from "@/lib/publications/types";
import type {SummaryPeriod} from "./period";
export type SummaryInput = {client:Client;projects:ProjectRow[];runs:AgentRunRow[];recommendations:RecommendationRow[];actions:InternalActionRow[];tasks:TaskRow[];publications:Publication[];deliveries:PublicationDelivery[];jobs:PublicationJob[];revisions:PublicationRevision[];variants:PublicationVariant[];attempts:PublicationAttempt[]};
export type SummaryIncident = {id:string;source:"run"|"action"|"publication_job"|"publication_attempt";project_id:string|null;status:string;occurred_at:string};
export type SummaryMetric = {source:"google_ads_read_only";recommendation_id:string;project_id:string|null;account_id:string;currency:string|null;period:{start:string;end:string};coverage:"full_month"|"partial_period";values:Record<string,number>};
export type SummaryActivity = {
  runs:AgentRunRow[];recommendations:RecommendationRow[];openRecommendations:RecommendationRow[];
  executedActions:InternalActionRow[];completedTasks:TaskRow[];upcomingTasks:TaskRow[];
  publications:Publication[];scheduled:PublicationDelivery[];published:PublicationDelivery[];failed:PublicationDelivery[];
  incidents:SummaryIncident[];metrics:SummaryMetric[];
};
export type ClientMonthlySummaryContext = {
  period:SummaryPeriod;client:Pick<Client,"id"|"name"|"notes">;
  projects:Array<{project:ProjectRow;activity:SummaryActivity}>;clientActivity:SummaryActivity;
  totals:{runs:number;recommendations:number;executedActions:number;completedTasks:number;scheduled:number;published:number;failed:number;incidents:number};
  dataQuality:{undatedCompletedTasks:string[];undatedPublishedDeliveries:string[];unassignedHistoricalRecords:number;missingProjectRecords:string[]};
  limitations:string[];
};
