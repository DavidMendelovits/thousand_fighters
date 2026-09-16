import {ControlTelemetry,CONTROL_BUCKETS} from '../core/ControlTelemetry';

/** DOM readout, outside sprite canvases; opening it never pauses or alters combat. */
export class ControlTelemetryPanel {
  readonly element=document.createElement('details');
  private last='';
  constructor(private telemetry:ControlTelemetry){
    this.element.className='control-telemetry';
    this.element.innerHTML='<summary>Control meter · live</summary><div class="control-readout"></div><button type="button">Reset measurement</button><p>60 Hz samples. Hitstop is counted once, not again as stun. “Free” includes your own attack recovery; this measures opponent-imposed loss of control.</p>';
    Object.assign(this.element.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:'90',width:'min(350px, calc(100vw - 24px))',background:'#121b22f5',color:'#e4eee9',border:'1px solid #58756d',borderRadius:'8px',padding:'12px',font:'12px/1.5 monospace',boxSizing:'border-box'});
    Object.assign(this.element.style,{background:'#121b22',maxHeight:'70vh',overflowY:'auto'});
    this.element.querySelector('summary')!.style.cursor='pointer';
    Object.assign(this.element.querySelector('button')!.style,{background:'#263a43',color:'#e4eee9',border:'1px solid #58756d',borderRadius:'4px',padding:'6px 10px',font:'inherit',cursor:'pointer'});
    this.element.querySelector('button')!.onclick=()=>{this.telemetry.reset();this.render();};
    document.body.append(this.element);
  }
  render(){
    if(!this.element.open)return;
    const s=this.telemetry.snapshot();
    const html=`<p>${s.seconds.toFixed(1)}s measured · pauses excluded</p><table style="width:100%;text-align:right"><thead><tr><th style="text-align:left">Seconds</th><th>P1</th><th>P2</th></tr></thead><tbody>${CONTROL_BUCKETS.map(k=>`<tr><td style="text-align:left">${k==='actionable'?'free':k}</td>${s.players.map(p=>`<td>${(p.ticks[k]/60).toFixed(2)}</td>`).join('')}</tr>`).join('')}<tr><td style="text-align:left">Locked</td>${s.players.map(p=>`<td>${p.lockedPercent.toFixed(1)}%</td>`).join('')}</tr><tr><td style="text-align:left">Longest</td>${s.players.map(p=>`<td>${p.longestLockMs}ms</td>`).join('')}</tr></tbody></table>`;
    if(html!==this.last){this.element.querySelector('.control-readout')!.innerHTML=html;this.last=html;}
  }
  destroy(){this.element.remove();}
}
