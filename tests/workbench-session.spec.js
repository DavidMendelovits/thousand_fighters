import {test,expect} from '@playwright/test';
test.skip(!process.env.STUDIO_BASE_URL,'Requires live game and CMS.');

test('controller remounts dispose old documents, preserve focus and keep one navigation owner',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest&move=hands_pinch`);
  const cms=page.frameLocator('#cms-frame');
  await expect(cms.locator('[data-preview-row]')).toHaveValue('hands_pinch');
  const frame=page.frames().find(frame=>frame.url().includes('/cms-admin/roster/'));
  await frame.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  const result=await frame.evaluate(async()=>{
    const session=window.__workbenchSession,old=[];
    for(let i=0;i<5;i++){old.push(session.documentScope);await session.selectCharacter('palimpsest',{silent:true,pushState:false});}
    return {same:session===window.__workbenchSession,disposed:old.every(scope=>scope.disposed&&scope.signal.aborted),navs:document.querySelectorAll('.workbench-sections').length};
  });
  expect(result).toEqual({same:true,disposed:true,navs:1});
  await expect(cms.locator('[data-preview-row]')).toHaveValue('hands_pinch');
  await cms.getByRole('button',{name:'All moves',exact:true}).click();
  expect(await cms.locator('[data-move-card]:visible').count()).toBeGreaterThan(1);
  await cms.getByRole('button',{name:'Focus one move',exact:true}).click();
  await expect(cms.locator('[data-move-card]:visible')).toHaveCount(1);
  await frame.evaluate(async()=>{
    const session=window.__workbenchSession;
    session.navigate('/roster/new');
    await session.selectCharacter('palimpsest',{silent:true,pushState:false});
  });
  await expect(cms.locator('#new-fighter-form')).toBeVisible();
  expect(await frame.evaluate(()=>window.__workbenchSession.state.currentCharacterId)).toBe('');
  await frame.evaluate(async()=>{
    const session=window.__workbenchSession;
    await session.selectCharacter('palimpsest',{pushState:false});
    session.navigate('/pipeline');
    await session.selectCharacter('palimpsest',{silent:true,pushState:false});
  });
  await expect(cms.locator('#pipeline-benchmarks')).toBeVisible();
});

test('anchor editor receives the latest selected row when its initial load finishes',async({page})=>{
  await page.goto(`${process.env.ADMIN_BASE_URL}/roster/palimpsest?standalone=1&move=hands_pinch`);
  await expect(page.locator('[data-preview-row]')).toHaveValue('hands_pinch');
  let release,started;
  const held=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>started=resolve);
  await page.route('**/gym?**',async route=>{started();await held;await route.continue();});
  await page.locator('[data-studio-section="anchors"]').click();await requested;
  await page.locator('[data-preview-row]').selectOption('ribbon_jab');release();
  const gym=page.frameLocator('[data-preview-kind="gym"]');
  await expect(gym.locator('.nav-move.active')).toHaveAttribute('data-sheet','ribbon_jab');
  await page.unrouteAll({behavior:'wait'});
});

test('standalone CMS handshake accepts configured parent and rejects stale or forged messages',async({page})=>{
  // HTTP tailnet hosts expose getRandomValues but not crypto.randomUUID.
  await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));
  await page.goto(`${process.env.ADMIN_BASE_URL}/roster/palimpsest?standalone=1&move=hands_pinch`);
  await expect(page.locator('[data-preview-status]')).toContainText('Ready',{timeout:25000});
  const original=await page.locator('[data-preview-status]').textContent();
  await page.evaluate(()=>{
    const frame=document.querySelector('[data-preview-kind="motion"]');
    window.dispatchEvent(new MessageEvent('message',{origin:new URL(frame.src).origin,source:frame.contentWindow,data:{type:'studio-preview-error',studioSession:'stale',message:'FORGED'}}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.example',source:frame.contentWindow,data:{type:'studio-preview-error',studioSession:new URL(frame.src).searchParams.get('studioSession'),message:'FORGED'}}));
  });
  await expect(page.locator('[data-preview-status]')).toHaveText(original);
  await page.locator('[data-studio-section="anchors"]').click();
  const gym=page.frameLocator('[data-preview-kind="gym"]');
  await expect(gym.locator('.frame-tile')).toHaveCount(20);
  await expect(page.locator('[data-preview-status]')).toContainText('Drag anchors');
  await gym.locator('body').evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.locator('[data-preview-row]').selectOption('ribbon_jab');
  await expect(gym.locator('.nav-move.active')).toHaveAttribute('data-sheet','ribbon_jab');
});

test('leaving a pending character load releases the interaction lock and ignores its late response',async({page})=>{
  await page.goto(`${process.env.ADMIN_BASE_URL}/roster/palimpsest?standalone=1`);
  await expect(page.locator('[data-preview-row]')).toBeVisible();
  let release,started;
  const held=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>started=resolve);
  await page.route('**/api/characters/palimpsest/draft',async route=>{started();await held;await route.continue();});
  await page.evaluate(()=>{void window.__workbenchSession.selectCharacter('palimpsest',{pushState:false});});
  await requested;
  await expect(page.locator('#character-workbench')).toHaveJSProperty('inert',true);
  await page.evaluate(()=>window.__workbenchSession.navigate('/roster/new'));
  await expect(page.locator('#character-workbench')).toHaveJSProperty('inert',false);
  await page.locator('#new-fighter-id').fill('still_editable');
  release();
  await expect(page.locator('#new-fighter-id')).toHaveValue('still_editable');
  await page.unrouteAll({behavior:'wait'});
});
