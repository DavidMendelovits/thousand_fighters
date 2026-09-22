import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';

/** Single-host advisory lock, not a distributed lease. The small Python helper
 * uses the same Python 3 runtime as sprite extraction. Kernel flock ownership
 * avoids stale-record read/check/unlink races. The inode is never deleted. */
export class BuildWorkerOwner {
  constructor(storage, lockPath) {
    const scope=storage?.rootDir ?? storage?.cache?.rootDir ?? `${storage?.provider}:${storage?.bucket??storage?.bucketName??'cms'}`;
    const hash=createHash('sha256').update(scope).digest('hex').slice(0,24);
    this.path=lockPath??process.env.CMS_BUILD_LOCK_PATH??path.join(os.tmpdir(),`tf-build-worker-${hash}.lock`);
    this.token=randomUUID();this.held=false;this.acquiring=null;this.releasing=false;
  }
  async acquire() {
    if(this.held)return;
    if(this.acquiring)return this.acquiring;
    this.releasing=false;
    this.acquiring=new Promise((resolve,reject)=>{
      const child=spawn('python3',[fileURLToPath(new URL('./build_worker_lock.py',import.meta.url)),this.path,String(process.pid),this.token],{stdio:['pipe','pipe','pipe']});
      this.child=child;let accepted=false,output='',errorOutput='';
      this.closed=new Promise(done=>child.once('close',done));
      child.stderr.on('data',data=>{errorOutput=(errorOutput+data.toString()).slice(-1000);});
      child.stdout.on('data',data=>{
        output+=data.toString();
        if(!accepted&&output.includes('acquired\n')){accepted=true;this.held=true;resolve();}
      });
      child.once('error',error=>reject(new Error(`Cannot start build ownership helper: ${error.message}`)));
      child.once('close',code=>{
        this.held=false;
        if(accepted&&!this.releasing){
          // Continuing could let a replacement worker and this process mutate
          // the same generation. Exit before accepting any more work; durable
          // stages/attempt IDs are reconciled by the replacement process.
          console.error('CMS build ownership was lost. Exiting to prevent concurrent generation.');
          process.exit(70);
        }
        if(!accepted)reject(Object.assign(new Error(code===73?'Another build worker owns this storage. Stop it before starting recovery.':`Build ownership helper failed: ${errorOutput||code}`),{statusCode:503}));
      });
      child.stdin.on('error',()=>{});
    });
    try{await this.acquiring;}finally{this.acquiring=null;}
  }
  async release(){
    if(this.acquiring)await this.acquiring.catch(()=>{});
    if(!this.child)return;
    this.releasing=true;
    this.child.stdin.end();await this.closed;this.held=false;this.child=null;
  }
}
