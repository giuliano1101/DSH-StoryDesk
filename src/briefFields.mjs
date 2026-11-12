// Authoritative saves may land while this input still has focus. Only unsaved
// author edits and in-flight generations should prevent the visible refresh.
export function syncBriefFields(form,values,dirty,inflight){
  for(const [name,value] of Object.entries(values)){
    const input=form?.elements.namedItem(name);
    if(input&&!dirty.has(name)&&!inflight.has(name))input.value=value??'';
  }
}
