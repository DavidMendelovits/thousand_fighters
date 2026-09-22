// Application -> selected document -> mounted features.
// Replacement aborts the old owner before any new feature may attach.
export class ResourceScope {
  constructor() { this.controller=new AbortController(); this.cleanups=new Set(); this.children=new Map(); this.disposed=false; }
  get signal(){return this.controller.signal;}
  own(resource){
    const dispose=typeof resource==='function'?resource:()=>resource?.dispose?.();
    if(this.disposed)dispose();else this.cleanups.add(dispose);
    return resource;
  }
  listen(target,type,listener,options={}){
    if(!target||this.disposed)return;
    target.addEventListener(type,listener,{...(typeof options==='boolean'?{capture:options}:options),signal:this.signal});
  }
  guard(callback){return (...args)=>{if(!this.disposed)return callback(...args);};}
  replaceScope(name){
    this.children.get(name)?.dispose();
    const scope=new ResourceScope();
    if(this.disposed)scope.dispose();else this.children.set(name,scope);
    return scope;
  }
  interval(callback,ms){const id=setInterval(this.guard(callback),ms);this.own(()=>clearInterval(id));return id;}
  timeout(callback,ms){const id=setTimeout(this.guard(callback),ms);this.own(()=>clearTimeout(id));return id;}
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.controller.abort();
    for(const child of this.children.values())child.dispose();
    this.children.clear();
    for(const cleanup of [...this.cleanups].reverse()){
      try{cleanup();}catch(error){console.error('Workbench cleanup failed',error);}
    }
    this.cleanups.clear();
  }
}

export class WorkbenchSession extends ResourceScope {
  constructor(owner){
    super();this.owner=owner;owner.__workbenchSession?.dispose();owner.__workbenchSession=this;
    this.state={};this.actions={};this.documentScope=new ResourceScope();this.selection=0;
    this.own(()=>this.documentScope.dispose());
  }
  start(mount){if(this.disposed)throw Error('Cannot start a disposed workbench');mount(this);return this;}
  replaceDocument(){this.documentScope.dispose();this.documentScope=new ResourceScope();return this.documentScope;}
  beginSelection(){const token=++this.selection;return ()=>!this.disposed&&token===this.selection;}
  selectCharacter(...args){return this.actions.selectCharacter(...args);}
  navigate(...args){return this.actions.navigateTo(...args);}
  dispose(){
    super.dispose();++this.selection;
    if(this.owner.__workbenchSession===this)delete this.owner.__workbenchSession;
  }
}
