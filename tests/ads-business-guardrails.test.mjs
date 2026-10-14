import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const { validateAdsAIOutput } = loadTs("lib/integrations/google-ads/ai-analysis.ts", {
  "./dashboard": { groupByType: () => [], typeLabel: () => "Search" },
});
const rows = [{id:"123",type:"SEARCH",localServices:false,hasActivity:true,metrics:{cost:124.25,conversions:0,clicks:14}}];
const evidence = [
  {id:"scope",campaignId:null,text:"Scope"},
  {id:"campaign:123:cost",campaignId:"123",text:"124.25 EUR"},
  {id:"campaign:123:conversions",campaignId:"123",text:"0 conversions"},
];
const rec = (action) => ({action,priority:"medium",campaignIds:["123"],evidenceIds:["campaign:123:cost","campaign:123:conversions"],rationale:"Examiner les preuves sans conclure trop vite"});
test("un budget sans preuve commerciale ne devient pas une recommandation", () => {
  const out=validateAdsAIOutput({factIds:["scope"],hypotheses:[],recommendations:[rec("review_budget"),rec("verify_tracking"),rec("review_services")]},rows,evidence);
  assert.equal(out.recommendations.length,1);
  assert.equal(out.recommendations[0].action,"verify_tracking");
});
test("une recommandation de suivi est refusée sans dépense observée", () => {
  const inactive=[{...rows[0],metrics:{...rows[0].metrics,cost:0}}];
  const out=validateAdsAIOutput({factIds:["scope"],hypotheses:[],recommendations:[rec("verify_tracking")]},inactive,evidence);
  assert.equal(out.recommendations.length,0);
});
test("preuve inconnue reste strictement rejetée", () => {
  assert.throws(()=>validateAdsAIOutput({factIds:["scope"],hypotheses:[],recommendations:[{...rec("verify_tracking"),evidenceIds:["invented"]}]},rows,evidence),/Justification hors périmètre/);
});
