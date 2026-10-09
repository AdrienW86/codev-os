import {spawnSync} from "node:child_process";
// An explicitly requested DB validation must fail, never silently skip.
if (!process.env.PUBLICATIONS_TEST_DATABASE_URL) {
 console.error("SQL validation not executed: configure an isolated local publications_lot1_test database. Remote URLs and .env credentials are prohibited.");
 process.exit(1);
}
const result=spawnSync(process.execPath,["--test","tests/publications-db.test.mjs"],{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error){console.error("Unable to start local SQL tests.");process.exit(1);}
process.exit(result.status??1);
