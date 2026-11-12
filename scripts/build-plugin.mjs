import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await build({entryPoints:['plugin/client.jsx'],outfile:'dist/plugin.js',bundle:true,format:'cjs',platform:'browser',target:'chrome120',external:['react'],loader:{'.css':'text'},minify:true,legalComments:'none',banner:{js:'window.__ModuleLoader__.load({id:"dsh-screenwriter-desk",factory:(require)=>{const module={exports:{}};const exports=module.exports;'},footer:{js:'return module.exports}})'}});
console.log('编剧工作台 DSH 插件界面已构建');
