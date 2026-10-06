export type PhotoScene='roof'|'pests'|'paint'|'facade'|'other';
export type PhotoAnalysis={scene:PhotoScene;description:string;confidence:number;usable:boolean;limitations:string[]};
export type MediaCandidate={id:string;client_id:string;project_id:string;drive_file_id:string;name:string;modified_at:string;mime_type:string;width:number|null;height:number|null;size:number;used:boolean;analysis:PhotoAnalysis|null};
export interface MediaProvider{list(folderId:string,clientId:string,projectId:string):Promise<MediaCandidate[]>;download(fileId:string,folderId:string):Promise<Uint8Array>;}
