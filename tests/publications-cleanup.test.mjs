import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const rules=await loadTs('lib/publications/cleanup-rules.ts',{});
const base={status:'draft',targetDate:'2026-10-20',editorialWeek:'2026-10-19',deliveries:[]};
test('publiée, échouée, rejetée, passée',()=>{
 assert.equal(rules.cleanupCategory({...base,status:'approved',deliveries:['published']},'2026-10-26'),'published');
 assert.equal(rules.cleanupCategory({...base,status:'approved',deliveries:['published','failed']},'2026-10-26'),'failed');
 assert.equal(rules.cleanupCategory({...base,status:'rejected',targetDate:'2026-11-20'},'2026-10-26'),'rejected');
 assert.equal(rules.cleanupCategory(base,'2026-10-26'),'past');
});
test('jamais un envoi en cours ni une publication à venir',()=>{
 assert.equal(rules.cleanupCategory({...base,deliveries:['published','scheduled']},'2026-10-26'),null);
 assert.equal(rules.cleanupCategory({...base,targetDate:'2026-10-26'},'2026-10-26'),null);
 assert.equal(rules.cleanupCategory({...base,targetDate:null,editorialWeek:'2026-10-20'},'2026-10-26'),null);
 assert.equal(rules.cleanupCategory({...base,targetDate:null,editorialWeek:'2026-10-19'},'2026-10-26'),'past');
});
test('catégories filtrées',()=>{assert.deepEqual([...rules.parseCleanupCategories(['past','x','published'])],['published','past']);});
