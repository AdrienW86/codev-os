import {spawnSync} from "node:child_process";
if (!process.env.HISTORICAL_PERMISSIONS_TEST_DATABASE_URL) {
 console.error("Historical hardening requires a dedicated local PostgreSQL database; no SQL was executed.");
 process.exit(1);
}
const result=spawnSync(process.execPath,["--test","tests/historical-permissions-db.test.mjs"],{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error)throw result.error;
process.exit(result.status??1);
