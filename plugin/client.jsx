import React from 'react';
import {PenNib} from '@phosphor-icons/react';
import App from '../src/App.jsx';
import css from '../src/styles.css';
import {readNativeTopInset} from './chrome.mjs';
const scoped=`@scope (.sw-plugin-root) {${css.replaceAll(':root',':scope').replace('html,body,#root',':scope')}} .sw-plugin-root {box-sizing:border-box;display:flex;flex-direction:column;height:100%;width:100%;min-width:0;min-height:0;padding-top:var(--sw-native-top-safe-area,0px);position:relative;isolation:isolate;contain:layout paint;overflow:hidden;background:var(--bg)}.sw-plugin-root>.app-shell{flex:1;min-height:0;width:100%;height:100%}.sw-plugin-root .modal-shade{inset-block-start:var(--sw-native-top-safe-area,0px)}.sw-plugin-root .modal{max-height:100%}`;
function Panel(){
  const [top,setTop]=React.useState(()=>readNativeTopInset());
  React.useEffect(()=>{
    const measure=()=>setTop(readNativeTopInset()),observer=new MutationObserver(measure);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-platform','data-fullscreen','style']});
    window.addEventListener('resize',measure);document.addEventListener('fullscreenchange',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);document.removeEventListener('fullscreenchange',measure);};
  },[]);
  return <div className="sw-plugin-root" style={{'--sw-native-top-safe-area':`${top}px`}}><style>{scoped}</style><App/></div>;}
function Icon({size=20}){return <PenNib size={size}/>;}
export const inject=['slots'];
export function apply(ctx){
  window.__SCREENWRITER_API_BASE__='/screenwriter-desk/api';
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'screenwriter-desk'},Panel));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'screenwriter-desk',order:6,label:()=> '创作工作台'},Icon));
}
