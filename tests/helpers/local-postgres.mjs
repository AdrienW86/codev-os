import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
export function executeLocalSql(command,env,sql) {
 if(!["127.0.0.1","::1"].includes(env.PGHOSTADDR))throw new Error("SQL helper requires loopback.");
 const directory=mkdtempSync(join(tmpdir(),"codev-local-sql-"));
 const path=join(directory,"validation.sql");
 try {
  writeFileSync(path,sql,"utf8");
  // A file preserves early PostgreSQL error messages; large stdin can fail with
  // Windows EOF before Node returns the actual SQL diagnostic.
  return spawnSync(command,["-X","--no-password","-v","ON_ERROR_STOP=1","-f",path],{env:{...env,PGCLIENTENCODING:"UTF8"},encoding:"utf8",timeout:60000,windowsHide:true,maxBuffer:4*1024*1024});
 } finally {unlinkSync(path);rmdirSync(directory);}
}
