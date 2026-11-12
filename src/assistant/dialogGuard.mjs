// Every dismissal and async continuation shares this live instance rather than
// the state captured by Modal's mount-time Escape listener.
export function createDialogGuard(){
  let busy=false,active=true,generation=0;
  const isCurrent=checkpoint=>active&&checkpoint===generation;
  return {
    mount(){active=true;busy=false;generation++;},
    unmount(){active=false;busy=false;generation++;},
    checkpoint(){return generation;},
    isCurrent,
    begin(){if(!active||busy)return false;busy=true;return true;},
    finish(checkpoint){if(checkpoint!==undefined&&!isCurrent(checkpoint))return false;busy=false;return true;},
    dismiss(close){if(!active||busy)return false;close();return true;},
  };
}
