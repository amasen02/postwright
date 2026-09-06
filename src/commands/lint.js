'use strict';
const fs=require('node:fs'),path=require('node:path');
const {roots,draftDir,readJson,atomicJson,payloadHash}=require('../core/store');
const {AgentUsageError}=require('../core/errors');
async function lint(slug,options={}){
 const r=roots(options),slugs=options.all?fs.readdirSync(r.draftsRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort():[slug];
 let pass=true;const results=[];
 for(const name of slugs){const dir=draftDir(name,options),file=path.join(dir,'manifest.json'),m=readJson(file);
 if(options.xEvidence){let u;try{u=new URL(options.xEvidence);}catch{throw new AgentUsageError('X evidence must be an X status URL with positive replies or bookmarks');}if(u.protocol!=='https:'||!['x.com','twitter.com'].includes(u.hostname)||!/^\/amasen02\/status\/\d+$/.test(u.pathname)||u.search||u.hash||!((options.replies||0)+(options.bookmarks||0)>0))throw new AgentUsageError('X evidence requires the account status URL and positive --replies or --bookmarks');m.xEvidence={url:u.href,topic:m.topic,replies:options.replies||0,bookmarks:options.bookmarks||0,recordedAt:new Date().toISOString(),source:'operator-supplied'};}
 if(options.force){if(options.force.trim().length<12)throw new AgentUsageError('Override reason must contain at least 12 characters');m.forceReason=options.force.trim();}
 if(options.xEvidence||options.force)atomicJson(file,m);
 const result=await require('../core/lint').lintDraft(dir,{...options,...r});
 for(const channel of ['x','linkedin','devto']){m.channels[channel]||={};if(m.channels[channel].state!=='released'){m.channels[channel].state=result.channels[channel]?'linted':'draft';m.channels[channel].payload_hash=payloadHash(dir,channel);}}
 atomicJson(file,m);console.log('\n'+name+' '+(result.pass?'PASS':'FAIL'));console.log('Rule | Channel | Result | Evidence / requirement');for(const rule of result.rules)console.log(`${rule.id} | ${rule.channel} | ${rule.pass?'PASS':'FAIL'} | ${rule.message}`);
 pass&&=result.pass;results.push({slug:name,...result});
 }
 if(!pass)process.exitCode=1;return {pass,results};
}
module.exports={lint};
