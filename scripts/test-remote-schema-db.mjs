import {spawnSync} from "node:child_process";
if (!process.env.REMOTE_SCHEMA_TEST_DATABASE_URL) {
  console.error("Remote schema replay requires a dedicated local PostgreSQL database; no test was executed.");
  process.exit(1);
}
const result=spawnSync(process.execPath,["--test","tests/remote-schema-db.test.mjs"],{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error)throw result.error;
process.exit(result.status??1);
