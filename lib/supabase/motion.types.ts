// Types du socle Motion Studio D0 (migration 20261119000000).
export type MotionTables = {
 motion_projects: {
  Row: {
   id: string; client_id: string; source_folder_id: string; title: string; brief: string;
   brand_direction: string; duration_seconds: number; aspect_ratio: "9:16" | "16:9" | "1:1";
   engine: "remotion" | "freeform"; voice_mode: "none" | "elevenlabs"; status: "draft";
   created_by: string; created_at: string;
  };
  Insert: never;
  Update: never;
  Relationships: [{foreignKeyName:"motion_projects_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]}];
 };
 motion_events: {
  Row: {id:string;motion_project_id:string;actor_id:string;action:"motion.created";created_at:string};
  Insert: never;Update:never;
  Relationships: [{foreignKeyName:"motion_events_motion_project_id_fkey";columns:["motion_project_id"];isOneToOne:false;referencedRelation:"motion_projects";referencedColumns:["id"]}];
 };
};
export type MotionFunctions = {
 motion_project_create: {Args:{
  p_client_id:string;p_source_folder_id:string;p_title:string;p_brief:string;
  p_brand_direction:string;p_duration_seconds:number;p_aspect_ratio:string;
  p_engine:string;p_voice_mode:string;p_actor_id:string;
 };Returns:string};
};
