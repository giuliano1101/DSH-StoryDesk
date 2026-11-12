export function assistantLayout(width,requested){
  return {open:requested===true,dedicated:false,hideContent:false,compactSidebar:width<1280};
}
export function shouldSubmitAssistant(event,ready,platform=globalThis.navigator?.platform||''){
  const mac=/Mac|iPhone|iPad/.test(platform);
  return Boolean(ready&&event.key==='Enter'&&!event.isComposing&&!event.nativeEvent?.isComposing&&event.keyCode!==229&&!event.repeat&&!event.altKey&&!event.shiftKey&&(mac?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey));
}
