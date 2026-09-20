import {publicHttpsUrl,assertMp4,safeProviderDiagnostics} from './falVideoGeneratorAdapter.js';

const ORIGIN='https://api.pruna.ai';
export const PRUNA_VIDEO_MODEL='p-video-2-pro';
export function prunaVideoPayload(request){
  if(request.mode!=='image-to-video'||request.motion||request.orientation)throw new Error('Pruna supports image-to-video here, not motion-control.');
  const duration=Number(request.duration??5);
  if(!Number.isInteger(duration)||duration<5||duration>15)throw new Error('Pruna duration must be 5–15 seconds.');
  const resolution=request.resolution??'480p',mode=request.recipe??'speed';
  if(!['480p','768p'].includes(resolution)||!['speed','quality'].includes(mode))throw new Error('Invalid Pruna resolution or recipe.');
  if(!request.prompt?.trim()||!request.image)throw new Error('Pruna needs a prompt and reference image.');
  return {prompt:request.prompt,image:request.image,duration,resolution,mode,prompt_upsampler:'off',...(request.endImage?{last_frame_image:request.endImage}:{})};
}
export function trustedPrunaUrl(value,prefix='/v1/'){
  const url=new URL(value);
  if(url.origin!==ORIGIN||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(prefix))throw new Error('Untrusted Pruna API URL.');
  return url.href;
}
export class PrunaVideoGeneratorAdapter {
  constructor(options={}){
    this.apiKey=options.apiKey??process.env.PRUNA_API_KEY??'';
    this.fetch=options.fetch??globalThis.fetch;
    this.timeoutMs=Number(options.timeoutMs??900000);
    this.pollIntervalMs=Number(options.pollIntervalMs??1000);
    this.sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  }
  async requestJson(url,options={}){
    if(!this.apiKey)throw new Error('PRUNA_API_KEY is required.');
    const response=await this.fetch(trustedPrunaUrl(url),{...options,redirect:'error',signal:AbortSignal.timeout(60000),headers:{apikey:this.apiKey,...options.headers}});
    if(!response.ok){
      let diagnostics=[];try{diagnostics=safeProviderDiagnostics(await response.json(),this.apiKey);}catch{}
      const error=new Error(`Pruna HTTP ${response.status}: ${diagnostics.map(d=>d.message).join('; ')}`);
      error.statusCode=response.status;error.diagnostics=diagnostics;throw error;
    }
    return response.json();
  }
  async upload(image){
    if(!image.startsWith('data:'))return publicHttpsUrl(image);
    const match=image.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if(!match)throw new Error('Invalid Pruna reference media.');
    const body=new FormData();body.append('content',new Blob([Buffer.from(match[2],'base64')],{type:match[1]}),'reference.png');
    const result=await this.requestJson(`${ORIGIN}/v1/files`,{method:'POST',body});
    return trustedPrunaUrl(result.urls?.get,'/v1/files/');
  }
  async submit(request){
    const input=prunaVideoPayload(request);
    const uploadStarted=Date.now();
    input.image=await this.upload(input.image);
    if(input.last_frame_image)input.last_frame_image=await this.upload(input.last_frame_image);
    const referenceUploadMs=Date.now()-uploadStarted;
    const submissionStarted=Date.now();
    const result=await this.requestJson(`${ORIGIN}/v1/predictions`,{method:'POST',headers:{'content-type':'application/json',Model:PRUNA_VIDEO_MODEL},body:JSON.stringify({input})});
    if(typeof result.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(result.id))throw new Error('Pruna returned no task ID; do not resubmit automatically.');
    return {requestId:result.id,model:PRUNA_VIDEO_MODEL,statusUrl:`${ORIGIN}/v1/predictions/status/${result.id}`,timings:{referenceUploadMs,predictionSubmissionMs:Date.now()-submissionStarted}};
  }
  async result(task){
    const value=await this.requestJson(trustedPrunaUrl(task.statusUrl,'/v1/predictions/status/'));
    if(value.status!=='succeeded'||!value.generation_url)throw new Error(`Pruna task not successful (${value.status}).`);
    return {url:trustedPrunaUrl(value.generation_url,'/v1/predictions/delivery/'),contentType:'video/mp4'};
  }
  async poll(task,{onStatus=async()=>{}}={}){
    const deadline=Date.now()+this.timeoutMs;let last;
    while(Date.now()<deadline){
      const result=await this.requestJson(trustedPrunaUrl(task.statusUrl,'/v1/predictions/status/'));
      if(!['starting','processing','queued','succeeded','failed','canceled','cancelled'].includes(result.status))throw new Error('Unknown Pruna status; resume after investigating.');
      const status=result.status==='succeeded'?'COMPLETED':result.status;
      if(status!==last){await onStatus(status);last=status;}
      if(result.status==='succeeded')return result;
      if(['failed','canceled','cancelled'].includes(result.status))throw new Error(`Pruna task ${result.status}; no automatic resubmission.`);
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error('Pruna timed out; resume the same persisted task.');
  }
  async download(video){
    const response=await this.fetch(trustedPrunaUrl(video.url,'/v1/predictions/delivery/'),{redirect:'error',headers:{apikey:this.apiKey},signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`Pruna download HTTP ${response.status}; resume to retry.`);
    const bytes=Buffer.from(await response.arrayBuffer());assertMp4(bytes);return bytes;
  }
}
