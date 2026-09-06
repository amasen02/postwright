'use strict';
const fs=require('node:fs'),path=require('node:path');
const {roots,readJson,draftDir}=require('../core/store');
function status(options={}){const {draftsRoot}=roots(options);if(!fs.existsSync(draftsRoot))return [];return fs.readdirSync(draftsRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{const m=readJson(path.join(draftDir(e.name,options),'manifest.json'));return {slug:e.name,channels:Object.fromEntries(Object.entries(m.channels).map(([c,v])=>[c,v.state])),gifFailures:m.gif?.failures||[]};});}
module.exports={status};
