'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {release}=require('../../src/commands/release');

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'postwright-release-')),draftsRoot=path.join(root,'drafts'),privateRoot=path.join(root,'private'),dir=path.join(draftsRoot,'demo');
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'post-x.md'),'Which retry prevents a duplicate charge?\n\nUse an idempotency key.\n');
 fs.writeFileSync(path.join(dir,'post-linkedin.md'),'An idempotency key prevents a duplicate charge.\n');
 fs.writeFileSync(path.join(dir,'article-devto.md'),'---\ntitle: Idempotency keys\ntags: [api, rest]\npublished: false\n---\n\nUse an idempotency key.\n');
 const {payloadHash}=require('../../src/core/store');
 const channels={};for(const channel of ['x','linkedin','devto'])channels[channel]={state:'linted',payload_hash:payloadHash(dir,channel)};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({slug:'demo',topic:'idempotency keys',channels},null,2));
 return {root,draftsRoot,privateRoot,dir,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const passLint=async()=>({pass:false,channels:{x:true,linkedin:true,devto:false},rules:[]});

test('release refuses before touching lint or publisher when --confirm is absent',async t=>{
 const f=fixture();t.after(f.cleanup);let touched=false;
 await assert.rejects(release('demo',{channel:'x',draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:async()=>{touched=true;},publisher:async()=>{touched=true;}}),/--confirm/);
 assert.equal(touched,false);assert.equal(fs.existsSync(path.join(f.privateRoot,'receipts')),false);
});

test('release gates only the selected channel and records verified readback',async t=>{
 const f=fixture();t.after(f.cleanup);
 const result=await release('demo',{channel:'x',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async(payload,context)=>{
  const reservation=JSON.parse(fs.readFileSync(context.receiptFile,'utf8'));assert.equal(reservation.status,'inflight');
  return {owner:'amasen02',texts:payload.posts,id:'123',url:'https://x.com/amasen02/status/123'};
 }});
 assert.equal(result.status,'released');assert.equal(result.account,'amasen02');assert.equal(result.id,'123');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.privateRoot,'receipts','demo-x.json'),'utf8'));
 assert.deepEqual(Object.keys(receipt),['account','channel','payload_hash','status','id','url']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'manifest.json'),'utf8')).channels.x.state,'released');
});

test('release refuses changed content after lint',async t=>{
 const f=fixture();t.after(f.cleanup);fs.appendFileSync(path.join(f.dir,'post-x.md'),'changed');
 await assert.rejects(release('demo',{channel:'x',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>assert.fail('publisher must not run')}),/changed since lint/);
});

test('release refuses a selected-channel lint failure',async t=>{
 const f=fixture();t.after(f.cleanup);
 await assert.rejects(release('demo',{channel:'devto',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>assert.fail('publisher must not run')}),/devto.*lint/i);
});

test('release refuses durable duplicate receipts including inflight reservations',async t=>{
 const f=fixture();t.after(f.cleanup);const receipts=path.join(f.privateRoot,'receipts');fs.mkdirSync(receipts,{recursive:true});
 fs.writeFileSync(path.join(receipts,'demo-x.json'),JSON.stringify({account:'amasen02',channel:'x',payload_hash:'a',status:'inflight'}));
 await assert.rejects(release('demo',{channel:'x',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>assert.fail('publisher must not run')}),/already has a durable release reservation/);
});

test('release cadence counts recent released and inflight receipts across draft roots',async t=>{
 const f=fixture();t.after(f.cleanup);const receipts=path.join(f.privateRoot,'receipts');fs.mkdirSync(receipts,{recursive:true});
 for(const [name,status] of [['other-x.json','released'],['pending-linkedin.json','inflight']])fs.writeFileSync(path.join(receipts,name),JSON.stringify({account:'a',channel:'x',payload_hash:'h',status}));
 await assert.rejects(release('demo',{channel:'x',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>assert.fail('publisher must not run')}),/two other releases.*60 minutes/i);
});

test('ambiguous provider failure keeps the inflight reservation and leaves manifest unreleased',async t=>{
 const f=fixture();t.after(f.cleanup);
 await assert.rejects(release('demo',{channel:'x',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>{throw new Error('provider detail must stay private')}}),/Release outcome is uncertain/);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.privateRoot,'receipts','demo-x.json'),'utf8'));assert.equal(receipt.status,'inflight');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'manifest.json'),'utf8')).channels.x.state,'linted');
});

test('readback owner or full-text mismatch never becomes success',async t=>{
 const f=fixture();t.after(f.cleanup);
 await assert.rejects(release('demo',{channel:'linkedin',confirm:true,draftsRoot:f.draftsRoot,privateRoot:f.privateRoot,lintDraft:passLint,publisher:async()=>({owner:'/in/someone-else/',text:'different',id:'1',url:'https://linkedin.com/feed/update/1'})}),/readback verification failed/i);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.privateRoot,'receipts','demo-linkedin.json'),'utf8'));assert.equal(receipt.status,'inflight');
});
