export function assistantLayout(width,requested){
  const dedicated=width<960,open=requested??!dedicated;
  return {open,dedicated,hideContent:open&&dedicated,compactSidebar:width<1280};
}
