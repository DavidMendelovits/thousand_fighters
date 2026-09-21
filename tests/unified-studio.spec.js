import {test,expect} from '@playwright/test';

// Full-studio checks need both Vite and CMS, not the admin-only fixture.
test.skip(!process.env.STUDIO_BASE_URL,'Set STUDIO_BASE_URL to a running full studio.');
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.fulfill({status:503,json:{error:'Audit fixture: writes disabled.'}}));
});

test('legacy combat workspace opens the selected draft combo editor',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/animation-lab?workspace=combat&character=palimpsest`);
  const cms=page.frameLocator('#cms-frame');
  await expect(cms.locator('[data-studio-section="combos"]')).toHaveAttribute('aria-pressed','true');
  await expect(cms.getByRole('heading',{name:'Palimpsest',exact:true})).toBeVisible();
  await expect(cms.locator('[data-preview-kind="testbed"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('focused row and section survive refresh; clip library retains the draft',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest`);
  const cms=page.frameLocator('#cms-frame');
  await cms.getByRole('button',{name:'Focus one move',exact:true}).click();
  await cms.locator('[data-preview-row]').selectOption('hands_pinch');
  await cms.locator('[data-studio-section="anchors"]').click();
  const gym=cms.frameLocator('[data-preview-kind="gym"]');
  await expect(gym.locator('.frame-tile')).toHaveCount(20);
  await gym.locator('#play-btn').click();
  await expect(gym.locator('#play-btn')).not.toHaveText('▶');
  await page.getByRole('button',{name:'Clip library',exact:true}).click();
  await expect(gym.locator('#play-btn')).toHaveText('▶');
  await page.getByRole('button',{name:'Character workbench',exact:true}).click();
  await expect(cms.locator('[data-preview-row]')).toHaveValue('hands_pinch');
  await expect(cms.locator('[data-move-card]:visible')).toHaveCount(1);
  await cms.locator('[data-studio-section="identity"]').click();
  await page.reload();
  await expect(cms.locator('[data-studio-section="identity"]')).toHaveAttribute('aria-pressed','true');
  await cms.locator('[data-studio-section="motion"]').click();
  await expect(cms.locator('[data-preview-row]')).toHaveValue('hands_pinch');
  await expect(cms.locator('[data-move-card]:visible')).toHaveCount(1);
});

test('invalid character size is rejected without a draft mutation',async({page})=>{
  await page.goto(`${process.env.STUDIO_BASE_URL}/workbench?character=palimpsest`);
  const cms=page.frameLocator('#cms-frame');
  await cms.locator('[data-studio-section="identity"]').click();
  await cms.getByText('Identity, movement & move definitions',{exact:true}).click();
  const editor=cms.getByRole('textbox',{name:'Character authoring JSON'});
  const value=JSON.parse(await editor.inputValue());
  value.sprite.relativeHeight=99;
  await editor.fill(JSON.stringify(value,null,2));
  let writes=0;page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/'))writes++;});
  await cms.getByRole('button',{name:'Save character definitions',exact:true}).click();
  await expect(cms.locator('#authoring-save-status')).toContainText('relativeHeight must be between');
  expect(writes).toBe(0);
});
