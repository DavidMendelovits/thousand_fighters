import {test,expect} from '@playwright/test';

test('finished gameplay MP4 decodes, plays, and seeks through the mechanic showcase',async({page},info)=>{
  await page.goto('http://127.0.0.1:5173/roster.html');
  const video=page.locator('#replay video');await expect(video).toBeVisible();
  await video.scrollIntoViewIfNeeded();
  const metadata=await video.evaluate(async v=>{
    if(v.readyState<1)await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));
    v.muted=true;await v.play();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight};
  });
  expect(metadata.duration).toBeGreaterThan(33);expect(metadata.duration).toBeLessThan(36);
  expect(metadata.width).toBe(1600);expect(metadata.height).toBe(900);
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.5);
  const hashes=[];
  for(const [label,time] of [['tentacle',2.8],['ground',5.6],['sky',7.4],['rear',9.8],['clinch',16.4],['block',20.8],['cpu',29.9]]){
    const frame=await video.evaluate(async(v,time)=>{
      v.pause();v.currentTime=time;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
      const c=document.createElement('canvas');c.width=800;c.height=450;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,800,450);
      let hash=0;const pixels=ctx.getImageData(0,0,800,450).data;for(let i=0;i<pixels.length;i++)hash=(Math.imul(hash,31)+pixels[i])|0;
      return {hash,error:v.error};
    },time);
    expect(frame.error).toBeNull();hashes.push(frame.hash);
    await video.screenshot({path:info.outputPath(`${label}.png`)});
  }
  expect(new Set(hashes).size).toBe(hashes.length);
});
