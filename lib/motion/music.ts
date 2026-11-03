// Musiques de fond du Studio vidéo (pur) : bibliothèque embarquée (compositions originales, voir music/LICENCE.txt) et
// choix d'un morceau. « auto » : un morceau de l'ambiance du rythme, tiré de façon stable à partir de la vidéo.
import type {MotionPace} from './video/storyboard';

export type MotionTrack={id:string;file:string;title:string;mood:MotionPace;bpm:number};
export const MOTION_TRACKS:readonly MotionTrack[]=[
 {id:'elan',file:'dynamique-01-elan.mp3',title:'Élan',mood:'dynamic',bpm:124},
 {id:'impulsion',file:'dynamique-02-impulsion.mp3',title:'Impulsion',mood:'dynamic',bpm:128},
 {id:'tempo',file:'dynamique-03-tempo.mp3',title:'Tempo',mood:'dynamic',bpm:118},
 {id:'horizon',file:'standard-01-horizon.mp3',title:'Horizon',mood:'standard',bpm:104},
 {id:'clarte',file:'standard-02-clarte.mp3',title:'Clarté',mood:'standard',bpm:98},
 {id:'atelier',file:'standard-03-atelier.mp3',title:'Atelier',mood:'standard',bpm:110},
 {id:'calme',file:'pose-01-calme.mp3',title:'Calme',mood:'calm',bpm:80},
 {id:'lumiere',file:'pose-02-lumiere.mp3',title:'Lumière',mood:'calm',bpm:74},
];
export type MusicChoice='auto'|'none'|string;
export const MUSIC_MOOD_LABELS:Record<MotionPace,string>={dynamic:'Dynamique',standard:'Standard',calm:'Posé'};
export function isMusicChoice(v:unknown):v is MusicChoice{
 return v==='auto'||v==='none'||(typeof v==='string'&&MOTION_TRACKS.some(t=>t.id===v));
}
/** Morceau retenu : aucun, celui choisi, ou (auto) un morceau de l'ambiance du rythme, stable pour une même graine. */
export function pickTrack(choice:MusicChoice,pace:MotionPace,seed:string):MotionTrack|null{
 if(choice==='none')return null;
 const chosen=MOTION_TRACKS.find(t=>t.id===choice);if(chosen)return chosen;
 const pool=MOTION_TRACKS.filter(t=>t.mood===pace);
 let h=0;for(const c of seed)h=(h*31+c.charCodeAt(0))>>>0;
 return pool.length?pool[h%pool.length]:null;
}
