// Liens publics vers un post publié, construits à partir de son identifiant (aucun appel réseau).
// Seul Facebook le permet de façon fiable (identifiant « page_post ») ; les autres réseaux exigent un permalien.
export function socialPostUrl(platform:string,remoteId:string|null):string|null{
 if(!remoteId)return null;
 if(platform==='facebook'&&/^\d{5,30}(_\d{5,30})?$/.test(remoteId))return `https://www.facebook.com/${remoteId}`;
 return null;
}
