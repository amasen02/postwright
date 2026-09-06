'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {publishDevto,parseDevtoArticle}=require('../../src/publish/devto');
const {loadSecrets}=require('../../src/publish/secrets');

test('dev.to release uses documented POST then reads the article back',async()=>{
 const calls=[];
 const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/users/me'))return new Response(JSON.stringify({username:'amasen',id:4036700}),{status:200});if(options.method==='POST')return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/idempotency-9'}),{status:201});return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/idempotency-9',title:'Idempotency keys',body_markdown:'Use an idempotency key.',user:{username:'amasen'},published_at:'2026-09-06T00:00:00Z'}),{status:200});};
 const result=await publishDevto({title:'Idempotency keys',tags:['api'],body:'Use an idempotency key.'},{apiKey:'secret-in-memory',fetch});
 assert.equal(result.owner,'amasen');assert.equal(result.id,'9');assert.equal(calls[1].options.method,'POST');
 assert.equal(calls[1].options.headers['api-key'],'secret-in-memory');assert.match(calls[1].options.headers['User-Agent'],/postwright/i);assert.equal(calls[2].options.method,'GET');
});

test('dev.to parser removes front matter and forces release publication independently',()=>{
 assert.deepEqual(parseDevtoArticle('---\ntitle: "REST keys"\ntags: [api, rest]\npublished: false\ncover_image: asset.gif\n---\n\nBody\n'),{title:'REST keys',tags:['api','rest'],body:'Body',coverImage:'asset.gif'});
});

test('secret loader allowlists names and never returns unrelated values',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'postwright-secret-')),file=path.join(root,'.env');
 try{fs.writeFileSync(file,'DEVTO_API_KEY=allowed\nPASSWORD=must-not-load\nTWITTER_AUTH_TOKEN=cookie\n');assert.deepEqual(loadSecrets({file,names:['DEVTO_API_KEY']}),{DEVTO_API_KEY:'allowed'});}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('provider error bodies are replaced with a safe generic error',async()=>{
 const fetch=async()=>new Response('api-key=leaked-provider-body',{status:500});
 await assert.rejects(publishDevto({title:'T',tags:[],body:'B'},{apiKey:'secret',fetch}),error=>error.safe===true&&!error.message.includes('leaked-provider-body')&&!error.message.includes('secret'));
});

test('a non-2xx from the identity check is also surfaced without echoing its body',async()=>{
 const fetch=async(url)=>url.endsWith('/users/me')?new Response('token=leaked',{status:401}):assert.fail('must not proceed past a failed identity check');
 await assert.rejects(publishDevto({title:'T',tags:[],body:'B'},{apiKey:'secret',fetch}),error=>error.safe===true&&!error.message.includes('leaked'));
});

test('the create request transmits the exact approved payload, including published:false, unchanged',async()=>{
 const calls=[];
 const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/users/me'))return new Response(JSON.stringify({username:'amasen',id:1}),{status:200});if(options.method==='POST')return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9'}),{status:201});return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9',title:'REST keys',body_markdown:'Body text.',user:{username:'amasen'}}),{status:200});};
 await publishDevto({title:'REST keys',tags:['api','rest'],body:'Body text.'},{apiKey:'k',fetch});
 assert.deepEqual(JSON.parse(calls[1].options.body),{article:{title:'REST keys',tags:['api','rest'],body_markdown:'Body text.',published:false}});
});

test('a cover image is included in the create payload only when the article supplies one, and never overrides published:false',async()=>{
 const calls=[];
 const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/users/me'))return new Response(JSON.stringify({username:'amasen',id:1}),{status:200});if(options.method==='POST')return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9'}),{status:201});return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9',title:'REST keys',body_markdown:'Body text.',user:{username:'amasen'}}),{status:200});};
 await publishDevto({title:'REST keys',tags:['api'],body:'Body text.',coverImage:'asset.gif'},{apiKey:'k',fetch});
 assert.deepEqual(JSON.parse(calls[1].options.body),{article:{title:'REST keys',tags:['api'],body_markdown:'Body text.',published:false,main_image:'asset.gif'}});
});

test('the returned title is read back from the live API response, not assumed from the request',async()=>{
 const article={title:'REST keys',tags:['api'],body:'Body text.'};
 const fetch=async(url,options)=>{if(url.endsWith('/users/me'))return new Response(JSON.stringify({username:'amasen',id:1}),{status:200});if(options.method==='POST')return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9'}),{status:201});return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9',title:'REST keys',body_markdown:'Body text.',user:{username:'amasen'}}),{status:200});};
 const result=await publishDevto(article,{apiKey:'k',fetch});
 assert.equal(result.title,article.title,'the happy-path readback title matches what was requested');

 // A readback that disagrees with the request must surface as a disagreeing value, not be
 // silently coerced to match: release.verifyReadback is what refuses on this mismatch, and
 // it can only do that if publishDevto reports the API's actual title.
 const mismatched=async(url,options)=>{if(url.endsWith('/users/me'))return new Response(JSON.stringify({username:'amasen',id:1}),{status:200});if(options.method==='POST')return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9'}),{status:201});return new Response(JSON.stringify({id:9,url:'https://dev.to/amasen/x-9',title:'A different title entirely',body_markdown:'Body text.',user:{username:'amasen'}}),{status:200});};
 const mismatchedResult=await publishDevto(article,{apiKey:'k',fetch:mismatched});
 assert.notEqual(mismatchedResult.title,article.title);
});

test('release refuses a dev.to publish whose readback title disagrees with the request',async()=>{
 const {release}=require('../../src/commands/release');
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'postwright-devto-readback-'));
 const draftsRoot=path.join(root,'drafts'),privateRoot=path.join(root,'private'),dir=path.join(draftsRoot,'demo');
 try{
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'post-x.md'),'Which retry prevents a duplicate charge?\n\nUse an idempotency key.\n');
  fs.writeFileSync(path.join(dir,'post-linkedin.md'),'An idempotency key prevents a duplicate charge.\n');
  fs.writeFileSync(path.join(dir,'article-devto.md'),'---\ntitle: Idempotency keys\ntags: [api, rest]\npublished: false\n---\n\nUse an idempotency key.\n');
  const {payloadHash}=require('../../src/core/store');
  const channels={};for(const channel of ['x','linkedin','devto'])channels[channel]={state:'linted',payload_hash:payloadHash(dir,channel)};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({slug:'demo',topic:'idempotency keys',channels},null,2));
  const passLint=async()=>({pass:true,channels:{x:true,linkedin:true,devto:true},rules:[]});
  await assert.rejects(release('demo',{channel:'devto',confirm:true,draftsRoot,privateRoot,lintDraft:passLint,
   publisher:async()=>({owner:'amasen',id:'9',url:'https://dev.to/amasen/x-9',title:'A completely different title'})
  }),/readback verification failed/i);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
