import {isEpisodic} from '../../shared/episodes.mjs';
export function availableOperations(catalog,context,project,mode='execute'){
  if(!catalog||typeof catalog!=='object')return null;
  if(['discuss','rewrite'].includes(mode))return [];
  const operations=catalog[context.page]?.[mode==='manage'?'manage':'execute'];if(!Array.isArray(operations))return [];
  return operations.filter(item=>!item.type.startsWith('episode.')||isEpisodic(project)).map(item=>({...item,...(context.creationMode==='novel'?{title:item.title.replaceAll('场景','章节').replaceAll('场序','章节顺序').replaceAll('分场','章节大纲'),description:item.description?.replaceAll('场景','章节').replaceAll('场序','章节顺序').replaceAll('分场','章节大纲')}: {})}));
}
