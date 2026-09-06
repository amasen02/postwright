'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
function roots(options={}) { return {draftsRoot:path.resolve(options.draftsRoot||options.out||path.join(ROOT,'drafts')),privateRoot:path.resolve(options.privateRoot||path.join(ROOT,'../postwright-private'))}; }
function draftDir(slug,options={}) {
 if(typeof slug!=='string'||!/^_?[a-z0-9][a-z0-9-]{0,119}$/.test(slug)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug))throw Object.assign(new Error('Invalid draft slug'),{code:'USAGE'});
 const dir=path.join(roots(options).draftsRoot,slug);
 if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw new Error('Draft symlinks are refused');
 return dir;
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
const FILES={x:'post-x.md',linkedin:'post-linkedin.md',devto:'article-devto.md'};
function payloadHash(dir,channel){if(!FILES[channel])throw new Error('Invalid channel');const hash=crypto.createHash('sha256');for(const name of [FILES[channel],...(channel==='linkedin'?['first-comment.md']:[]),'asset.gif']){hash.update(name+'\0');const file=path.join(dir,name);if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink())throw new Error('Artifact symlinks are refused');hash.update(fs.readFileSync(file));}hash.update('\0');}return hash.digest('hex');}
module.exports={ROOT,roots,draftDir,readJson,atomicJson,payloadHash,FILES};
