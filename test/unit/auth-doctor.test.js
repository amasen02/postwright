'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {auth}=require('../../src/commands/auth');
const {doctor}=require('../../src/commands/doctor');

test('auth reports canonical identities without returning credentials or provider errors',async()=>{
 const result=await auth({checkDevto:async()=>({authenticated:true,account:'amasen'}),inspectBrowser:async()=>({x:{authenticated:true,account:'amasen02'},linkedin:{authenticated:true,account:'/in/ama-sen/'}})});
 assert.deepEqual(result.accounts.map(x=>x.account),['amasen02','/in/ama-sen/','amasen']);assert.doesNotMatch(JSON.stringify(result),/api.key|token|cookie/i);
});

test('auth sanitizes failed checks',async()=>{
 const result=await auth({checkDevto:async()=>{throw new Error('secret provider response')},inspectBrowser:async()=>{throw new Error('cookie=secret')}});
 assert.doesNotMatch(JSON.stringify(result),/secret|cookie/i);assert.ok(result.accounts.every(x=>x.authenticated===false));
});

test('doctor is local-only and reports prerequisite presence by name',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'postwright-doctor-')),secretFile=path.join(root,'.env'),browserPath=path.join(root,'browser-harness.exe'),diagifPath=path.join(root,'diagif.js');
 try{fs.writeFileSync(secretFile,'DEVTO_API_KEY=value\n');fs.writeFileSync(browserPath,'');fs.writeFileSync(diagifPath,'');const result=await doctor({secretFile,browserPath,diagifPath});assert.equal(result.checks.find(x=>x.name==='node').ok,true);assert.equal(result.checks.find(x=>x.name==='browser-harness').ok,true);assert.equal(result.checks.find(x=>x.name==='credential source').ok,true);assert.doesNotMatch(JSON.stringify(result),/value/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
