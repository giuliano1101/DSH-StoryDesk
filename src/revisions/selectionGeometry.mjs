const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));
// Rects are viewport coordinates; popups are positioned inside the plugin root.
export function placeSelectionPopup(anchor,root,{width,height},nativeInset=0){
  const gap=8,leftEdge=Math.max(gap,-root.left+gap),topEdge=Math.max(nativeInset+gap,-root.top+gap),right=Math.min(root.width-gap,(globalThis.innerWidth||Infinity)-root.left-gap),bottom=Math.min(root.height-gap,(globalThis.innerHeight||Infinity)-root.top-gap);
  const actualWidth=Math.max(0,Math.min(width,right-leftEdge)),actualHeight=Math.max(0,Math.min(height,bottom-topEdge));
  const below=anchor.bottom-root.top+gap,above=anchor.top-root.top-actualHeight-gap;
  const top=clamp(below+actualHeight<=bottom?below:above,topEdge,bottom-actualHeight);
  return {left:clamp(anchor.right-root.left-actualWidth/2,leftEdge,right-actualWidth),top,width:actualWidth,maxHeight:Math.max(0,bottom-top)};
}
export function textareaSelectionRect(textarea,selection){
  if(!textarea||!selection||textarea.value.slice(selection.start,selection.end)!==selection.text)return null;
  const document=textarea.ownerDocument,style=document.defaultView.getComputedStyle(textarea),rect=textarea.getBoundingClientRect(),mirror=document.createElement('div');
  const properties=['boxSizing','fontFamily','fontSize','fontStyle','fontWeight','fontStretch','fontVariant','lineHeight','letterSpacing','wordSpacing','textTransform','textIndent','textAlign','direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','wordBreak','overflowWrap'];
  for(const key of properties)mirror.style[key]=style[key];
  Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',left:`${rect.left}px`,top:`${rect.top-textarea.scrollTop}px`,width:`${rect.width-(textarea.offsetWidth-textarea.clientWidth-parseFloat(style.borderLeftWidth||0)-parseFloat(style.borderRightWidth||0))}px`,height:'auto',whiteSpace:textarea.wrap==='off'?'pre':'pre-wrap',overflowWrap:style.overflowWrap||'break-word'});
  mirror.append(document.createTextNode(textarea.value.slice(0,selection.start)));
  const span=document.createElement('span');span.textContent=selection.text;mirror.append(span,document.createTextNode(textarea.value.slice(selection.end)||'\u200b'));document.body.append(mirror);
  try{const range=document.createRange();range.selectNodeContents(span);const visible=[...range.getClientRects()].filter(r=>r.bottom>rect.top&&r.top<rect.bottom&&r.right>rect.left&&r.left<rect.right);const selected=visible.at(-1);return selected?{left:Math.max(rect.left,selected.left-textarea.scrollLeft),right:Math.min(rect.right,selected.right-textarea.scrollLeft),top:Math.max(rect.top,selected.top),bottom:Math.min(rect.bottom,selected.bottom)}:null;}finally{mirror.remove();}
}
