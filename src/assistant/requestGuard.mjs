// Normal chat and paragraph requests share a project reservation across contexts.
export function createProjectRequestGuard(){
  const active=new Map(),listeners=new Set();let revision=0;
  const emit=()=>{revision++;for(const listener of listeners)listener();};
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},snapshot:()=>revision,
    busy:id=>active.has(id),
    reserve(id){if(active.has(id))return null;const token=Symbol(id);active.set(id,token);emit();return token;},
    release(id,token){if(active.get(id)===token){active.delete(id);emit();}},
  };
}
export const assistantRequests=createProjectRequestGuard();
