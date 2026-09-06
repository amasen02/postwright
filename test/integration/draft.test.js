'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const test=require('node:test'),assert=require('node:assert/strict');
const {draft}=require('../../src/commands/draft');

function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'postwright-draft-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('draft without a GIF writes complete channel drafts and hashes',async t=>{
  const out=workspace(t),result=await draft('idempotency keys in REST APIs',{out,noGif:true,now:()=>new Date('2026-09-06T10:00:00.000Z')});
  assert.deepEqual(fs.readdirSync(result.dir).sort(),['article-devto.md','first-comment.md','manifest.json','post-linkedin.md','post-x.md']);
  assert.equal(result.manifest.noGif,true);assert.deepEqual(result.manifest.gif.failures,[]);
  assert.equal(result.manifest.createdAt,'2026-09-06T10:00:00.000Z');
  for(const channel of ['x','linkedin','devto']){assert.equal(result.manifest.channels[channel].state,'draft');assert.match(result.manifest.channels[channel].payload_hash,/^[a-f0-9]{64}$/);}
});

test('draft copies a proven branded GIF and records its original path and report failures',async t=>{
  const out=workspace(t),source=path.join(out,'source.gif'),bytes=Buffer.from('GIF89a-safe-test-artifact');fs.writeFileSync(source,bytes);
  const result=await draft('GraphRAG vs vector RAG',{out,makeGif:async()=>({sourcePath:source,outputPath:source,failures:[],footer:'https://www.linkedin.com/in/ama-sen'})});
  assert.deepEqual(fs.readFileSync(path.join(result.dir,'asset.gif')),bytes);
  assert.equal(result.manifest.gif.path,source);assert.equal(result.manifest.gif.footer,'https://www.linkedin.com/in/ama-sen');
  assert.equal(result.manifest.gif.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('diagif failure still leaves text drafts and a durable generic failure',async t=>{
  const out=workspace(t),result=await draft('GraphRAG vs vector RAG',{out,makeGif:async()=>{throw new Error('provider included private detail');}});
  assert.equal(fs.existsSync(path.join(result.dir,'asset.gif')),false);assert.equal(fs.existsSync(path.join(result.dir,'post-x.md')),true);
  assert.deepEqual(result.manifest.gif.failures,['diagif did not produce a verified GIF']);
  assert.doesNotMatch(fs.readFileSync(path.join(result.dir,'manifest.json'),'utf8'),/private detail/);
});
