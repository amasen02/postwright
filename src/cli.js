'use strict';
const {parseArgs}=require('./cli-args');
const HELP=`postwright — topic drafts with evidence gates
postwright draft <topic> [--gif|--no-gif] [--brain NAME] [--visual mindmap|diagram] [--out DIR]
postwright lint <slug>|--all [--out DIR] [--x-evidence URL --replies N --bookmarks N] [--force REASON]
postwright status [--out DIR]
postwright release <slug> --channel x|devto|linkedin --confirm [--out DIR]
postwright run <topic> [--brain NAME] [--visual mindmap|diagram] [--channels x,devto,linkedin] [--release --confirm] [--out DIR]
postwright auth
postwright doctor
Drafts remain local until the operator explicitly runs release with --confirm, or run with --release --confirm.`;
async function main(args){const {command,input,options}=parseArgs(args);if(command==='help'){console.log(HELP);return;}if(command==='version'){console.log(require('../package.json').version);return;}const fn=require('./commands/'+command)[command];const result=await (['draft','lint','release','run'].includes(command)?fn(input,options):fn(options));if(command!=='lint')console.log(JSON.stringify(result,null,2));return result;}
module.exports={main,HELP};
