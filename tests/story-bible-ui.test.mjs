import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
let render;
async function rendered(props){
 if(!render){const {build}=await import('esbuild'),output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {DoctorModal} from './src/doctor/DoctorModal.jsx';export const render=props=>renderToStaticMarkup(React.createElement(DoctorModal,props));",resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,platform:'node',format:'cjs',external:['react','react-dom/server'],write:false});const unit={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),unit,unit.exports);render=unit.exports.render;}
 const previous=globalThis.document;globalThis.document={activeElement:null};try{return render(props);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}
function props(){
 const bible={fingerprint:'a'.repeat(64),markdown:'# 故事档案\n<script>不能执行</script>',filename:'测试-故事档案.md',coverage:{outlineScenes:2,characters:1,worldMaterials:1,missing:['outlineDetails']}};
 const issue={id:'i',title:'钥匙状态冲突',reviewer:'连续性编辑',priority:'high',certainty:'conflict',impact:'与已采用规则冲突',suggestion:'先向作者确认',evidence:{sceneId:'s',selection:{start:0,end:4,text:'无钥匙开门'}},basis:[{referenceId:'material:m',kind:'world',title:'铁门规则',quote:'铁门必须使用钥匙。'}]};
 const report={id:'r',mode:'continuity',scope:'scene',status:'current',source:{project:{title:'测试'},scenes:[{id:'s',title:'门口',body:'无钥匙开门'}]},options:{rhythm:'自动判断'},createdAt:'2026-11-13T00:00:00Z',summary:'诊断',limitations:[],disagreement:'有待确认',nextStep:'核对',issues:[issue],bibleDocument:bible};
 return {doctor:{controller:{},snapshot:{open:{projectId:'p',sceneId:'s'},options:{p:{mode:'general',scope:'scene',platform:'',rhythm:'自动判断',targetDuration:''}},pending:{},startedAt:{},errors:{},loading:{},capabilities:{storyBible:true,continuity:true},bibles:{p:bible},reports:{p:[report]}},models:{catalog:{mode:'adapter',connected:true,label:'验收模型'}}},w:{state:{projects:[{id:'p',title:'测试',format:'screenplay',status:'active',scenes:[]}]}}};
}
test('doctor exposes the derived Markdown and paired conflict evidence as safe readable text',async()=>{
 const html=await rendered(props());assert.match(html,/故事一致性/);assert.match(html,/故事档案/);assert.match(html,/下载 Markdown/);assert.match(html,/铁门必须使用钥匙/);assert.match(html,/对照依据/);assert.match(html,/无钥匙开门/);assert.match(html,/部分大纲/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('old backend shows reload guidance instead of claiming the story bible is linked',async()=>{
 const input=props();input.doctor.snapshot.capabilities=null;input.doctor.snapshot.bibles={};
 const html=await rendered(input);assert.match(html,/完整退出并重新打开 Harness/);assert.doesNotMatch(html,/已关联故事档案/);
});
