import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers/ts-load.mjs';

const {workflowSucceeded}=load('lib/publications/workflow-result.ts');
test('only the three confirmed manual workflow outcomes are successful',()=>{
 for(const message of ['Révision soumise à validation.','Révision approuvée.','Révision refusée. Créez une nouvelle révision pour la retravailler.'])assert.equal(workflowSucceeded(message),true,message);
 for(const message of ['','Révision refusée.','Révision approuvée. Erreur ultérieure.','Cette publication cible un canal désactivé.','Publication archivée : lecture seule.','Vérification des canaux impossible : lecture seule par sécurité.','Opération non confirmée. Rechargez.','Média requis avant validation : ajoutez une photo.','Un nouveau refus métier.'])assert.equal(workflowSucceeded(message),false,message);
});
