import {test,expect} from '@playwright/test';

// Opt-in audit against the real local draft. ALL writes are intercepted: this
// suite cannot spend generation credits, approve art, or change live anchors.
test.skip(!process.env.STUDIO_BASE_URL,'Set STUDIO_BASE_URL to a running full studio.');
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.fulfill({status:503,json:{error:'Audit fixture: provider unavailable. No generation was submitted.'}}));
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest`);
  await expect(page.frameLocator('#cms-frame').locator('[data-studio-section="motion"]')).toBeVisible();
});
const cms=page=>page.frameLocator('#cms-frame');

test('only authored rows; focus, scrolling, draft tabs and narrow layout',async({page},info)=>{
  const studio=cms(page);
  await expect(studio.locator('[data-move-card]')).toHaveCount(22);
  await expect(studio.locator('[data-move-card="base"], [data-move-card="punch"], [data-move-card="grab"], [data-move-card="throw"]')).toHaveCount(0);
  await studio.getByRole('button',{name:'Focus one move',exact:true}).click();
  await studio.locator('[data-preview-row]').selectOption('ribbon_jab');
  await expect(studio.locator('[data-move-card]:visible')).toHaveCount(1);
  await expect(studio.locator('[data-move-card="ribbon_jab"]')).toBeVisible();
  await studio.getByRole('button',{name:'All moves',exact:true}).click();
  await expect(studio.locator('#workbench-preview')).toBeHidden();
  await expect(studio.locator('[data-move-card]:visible')).toHaveCount(22);
  await studio.locator('[data-move-card="ribbon_jab"] [data-inspect-row]').click();
  await expect(studio.locator('#workbench-preview')).toBeVisible();
  await expect(studio.getByRole('button',{name:'Focus one move',exact:true})).toHaveAttribute('aria-pressed','true');
  await studio.locator('[data-studio-section="identity"]').click();
  await studio.getByText('Advanced combat rules · stats, power-ups & hidden forms',{exact:true}).click();
  await studio.locator('#advanced-combat-json').fill('{"combatStats":{"attack":1.37}}');
  await page.getByRole('button',{name:'Pipeline & tools',exact:true}).click();
  await expect(studio.locator('[data-studio-section="build"]')).toHaveAttribute('aria-pressed','true');
  await studio.locator('[data-studio-section="identity"]').click();
  await expect(studio.locator('#advanced-combat-json')).toHaveValue('{"combatStats":{"attack":1.37}}');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await studio.locator('body').evaluate(el=>el.scrollWidth<=el.ownerDocument.defaultView.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('studio-responsive.png')});
});

test('combos play in the real engine and report contacts and illegal cancels',async({page})=>{
  const studio=cms(page);await studio.locator('[data-studio-section="combos"]').click();
  const game=studio.frameLocator('[data-preview-kind="testbed"]');
  await expect(game.locator('#hud')).toContainText('idle');
  await game.locator('#distance').focus();
  await game.locator('#distance').press('Home');
  await game.locator('#distance').press('ArrowRight');
  await expect(game.locator('#distance')).toHaveValue('42');
  await game.locator('#distance').evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await studio.getByRole('button',{name:'Preview combo',exact:true}).first().click();
  await expect(game.locator('#combo-preview-status')).toContainText('Sequence complete',{timeout:20000});
  await expect(game.locator('#combo-preview-status')).toContainText('3 moves');
  await expect(game.locator('#combo-preview-status')).not.toContainText('0 made contact');
  await expect(game.locator('#hud-hitboxes')).not.toContainText('engine error');
  await game.getByRole('button',{name:'Hit-confirm route',exact:true}).first().click();
  await expect(game.locator('#combo-preview-status')).toContainText('Route stopped',{timeout:20000});
  await game.locator('#distance').evaluate(el=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await game.getByRole('button',{name:'Hit-confirm route',exact:true}).first().click();
  await expect(game.locator('#combo-preview-status')).toContainText('Sequence complete',{timeout:20000});
  await expect(game.locator('#combo-preview-status')).toContainText('3 made contact');
});

test('custom anchors use active metadata, retain unsaved edits across tabs and save explicitly',async({page})=>{
  const studio=cms(page);await studio.locator('[data-preview-row]').selectOption('hands_pinch');
  await studio.locator('[data-studio-section="anchors"]').click();
  const gym=studio.frameLocator('[data-preview-kind="gym"]');
  await expect(gym.locator('#char-name')).toHaveText('Palimpsest');
  await expect(gym.locator('[data-sheet="hands_pinch"]')).toBeVisible();
  await expect(gym.locator('.frame-tile')).toHaveCount(20);
  const x=gym.locator('#anchor-x'),original=await x.inputValue();
  await x.fill(String(Number(original)+1));await x.press('Tab');
  await expect(gym.locator('#save-btn')).toBeEnabled();
  await studio.locator('[data-studio-section="motion"]').click();
  await studio.locator('[data-studio-section="anchors"]').click();
  await expect(x).toHaveValue(String(Number(original)+1));
  let payload;
  await page.route('**/api/tools/save_gym_edits',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{result:{frameData:{status:'saved'}}}});});
  await gym.locator('#save-btn').click();
  await expect(studio.locator('[data-preview-save-status]')).toContainText('saved to draft');
  expect(payload.frameData.frames.hands_pinch).toHaveLength(20);
  expect(payload.frameData.frames.hands_pinch[0].anchor.x).toBe(Number(original)+1);
  await expect(gym.locator('#save-btn')).toBeDisabled();
});

test('generation reports immediate submission then visible errors, including insecure contexts',async({page})=>{
  const studio=cms(page);
  await studio.locator('body').evaluate(()=>{Object.defineProperty(crypto,'subtle',{value:undefined});Object.defineProperty(crypto,'randomUUID',{value:undefined});});
  let release, submissions=0;
  const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/characters/palimpsest/build-jobs',async route=>{
    if(route.request().method()==='GET')return route.fallback();
    submissions++;await pending;await route.fulfill({status:503,json:{error:'Audit fixture: provider unavailable. No generation was submitted.'}});
  });
  await studio.getByRole('button',{name:'Focus one move',exact:true}).click();
  await studio.locator('[data-preview-row]').selectOption('ribbon_jab');
  const generate=studio.locator('[data-gen-move="ribbon_jab"]');
  await generate.click();
  await expect(generate).toBeDisabled();
  await expect(studio.locator('[data-generation-status="ribbon_jab"]')).toContainText('Submitting job');
  expect(submissions).toBe(1);release();
  await expect(studio.locator('[data-generation-status="ribbon_jab"]')).toContainText('provider unavailable');
  await expect(studio.locator('#workbench-error-notice')).toBeVisible();
  await expect(generate).toBeEnabled();
});

test('reference, projectile and combo generation expose pending and failure states',async({page})=>{
  const studio=cms(page);
  async function failAfterFeedback(url,button,status){
    let release;const pending=new Promise(resolve=>{release=resolve;});
    await page.route(url,async route=>{
      if(route.request().method()==='GET')return route.fallback();
      await pending;await route.fulfill({status:503,json:{error:'Controlled generation failure; no API credits used.'}});
    });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(status).toContainText(/Starting|Submitting/);
    release();
    await expect(status).toContainText('Controlled generation failure');
    await expect(button).toBeEnabled();
  }
  await studio.locator('[data-studio-section="identity"]').click();
  await failAfterFeedback('**/api/characters/palimpsest/build-jobs',studio.locator('[data-gen-concept]'),studio.locator('[data-concept-status]'));
  await studio.locator('[data-studio-section="combos"]').click();
  await studio.locator('[data-projectile-new-id]').fill('audit_paint');
  await studio.locator('[data-projectile-new-prompt]').fill('An isolated paint drop.');
  await failAfterFeedback('**/api/tools/generate_projectile',studio.locator('[data-projectile-generate]'),studio.locator('[data-projectile-generate] + .generation-status'));
  await studio.locator('[data-author-combo-id]').fill('audit_route');
  await studio.locator('[data-author-combo-segments]').fill('ribbon_jab\nundertow');
  await failAfterFeedback('**/api/tools/author_combo',studio.locator('[data-author-combo]'),studio.locator('[data-author-combo] + .generation-status'));
});
