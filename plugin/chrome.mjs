/** Reserve host-owned chrome in a native macOS window; never draw replacement controls. */
export function nativeTopInset({isHarness=false,platform='',fullScreen=false,hostClearance=''}={}){
  if(!isHarness||platform!=='darwin'||fullScreen)return 0;
  const parsed=Number.parseFloat(hostClearance);
  return Math.max(48,Number.isFinite(parsed)?Math.min(parsed,120):48);
}
export function readNativeTopInset(doc=globalThis.document,win=globalThis.window){
  if(!doc?.documentElement||!win)return 0;
  const html=doc.documentElement;
  return nativeTopInset({isHarness:true,platform:html.dataset.platform,fullScreen:html.hasAttribute('data-fullscreen')||Boolean(doc.fullscreenElement),hostClearance:win.getComputedStyle(html).getPropertyValue('--dsh-frame-top-clearance')});
}
