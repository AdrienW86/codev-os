import 'server-only';

// Stable ordering belongs to the caller. A later page error never returns a partial list.
export async function readAllRows<T>(query:()=>{range:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:unknown}>}):Promise<T[]>{
 const rows:T[]=[];
 for(let offset=0;;offset+=100){const {data,error}=await query().range(offset,offset+99);if(error)throw Error('Lecture paginée indisponible.');rows.push(...data??[]);if(!data||data.length<100)return rows;}
}
