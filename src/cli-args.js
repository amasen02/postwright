'use strict';
const {AgentUsageError}=require('./core/errors');
const grammar={draft:{gif:0,'no-gif':0,brain:1,'gif-brain':1,visual:1,out:1},lint:{all:0,out:1,'x-evidence':1,replies:1,bookmarks:1,force:1},status:{out:1},release:{channel:1,confirm:0,out:1},run:{brain:1,visual:1,channels:1,release:0,confirm:0,out:1},auth:{},doctor:{}};
function parseArgs(args){
 if(!args.length||args.length===1&&['--help','-h'].includes(args[0]))return {command:'help',options:{}};
 if(args.length===1&&args[0]==='--version')return {command:'version',options:{}};
 const command=args[0],spec=grammar[command],options={},pos=[];
 const bad=()=>{throw new AgentUsageError('Invalid command or option; run postwright --help');};
 if(!spec)bad();
 for(let i=1;i<args.length;i++){const a=args[i];if(!a.startsWith('-')){pos.push(a);continue;}const key=a.slice(2);if(!a.startsWith('--')||!Object.hasOwn(spec,key))bad();const camel=key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(Object.hasOwn(options,camel))bad();if(spec[key]){if(!args[i+1]||args[i+1].startsWith('--'))bad();options[camel]=args[++i];}else options[camel]=true;}
 if(pos.length!==(['draft','release','run'].includes(command)||command==='lint'&&!options.all?1:0))bad();
 if(options.gif&&options.noGif)bad();
 if(command==='release'&&!['x','linkedin','devto'].includes(options.channel))bad();
 if(options.visual&&!['mindmap','diagram'].includes(options.visual))bad();
 if(options.channels){const list=options.channels.split(',');if(!list.length||!list.every(c=>['x','linkedin','devto'].includes(c))||new Set(list).size!==list.length)bad();}
 for(const key of ['replies','bookmarks'])if(options[key]!==undefined){if(!/^\d+$/.test(options[key])||!Number.isSafeInteger(Number(options[key])))bad();options[key]=Number(options[key]);}
 if((options.replies!==undefined||options.bookmarks!==undefined)&&!options.xEvidence)bad();
 if(options.all&&(options.xEvidence||options.force))bad();
 return {command,...(pos.length?{input:pos[0]}:{}),options};
}
module.exports={parseArgs};
