import {test,expect} from '@playwright/test';
const base='http://127.0.0.1:5173/animation-lab.html';
test('shared studio retains the CMS draft and unsaved combat edits across tabs',async({page})=>{
  await page.goto(`${base}?workspace=characters`);
  const cms=page.frameLocator('#cms-frame');
  await cms.getByRole('button',{name:'Sir Chuckle sir_chuckle · draft'}).click();
  await cms.getByText('Advanced combat rules · stats, power-ups & hidden forms').click();
  await cms.getByRole('textbox',{name:'Advanced combat JSON'}).fill('{"combatStats":{"attack":1.37}}');
  await page.getByRole('button',{name:'Pipeline & tools',exact:true}).click();
  await expect(cms.getByRole('tab',{name:/Pipeline/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Characters & assets',exact:true}).click();
  await expect(cms.getByRole('textbox',{name:'Advanced combat JSON'})).toHaveValue('{"combatStats":{"attack":1.37}}');
  // This is an unsaved local edit; no CMS mutations or generation requests.
});
test('combat inspection is responsive and form configs stay outside the selectable roster',async({page},info)=>{
  await page.goto(`${base}?workspace=combat`);
  await expect(page.getByRole('heading',{name:'Brine / Abyssal Admiral'})).toBeVisible();
  await expect(page.locator('#combat-fighter option')).toHaveCount(10);
  await page.locator('#combat-fighter').selectOption('taffy');
  await expect(page.getByText('Until KO · 50 meter · Q to transform')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('studio.png'),fullPage:true});
});
test('legacy CMS route leads to the same studio',async({page})=>{
  await page.goto('http://127.0.0.1:8787/roster/sir_chuckle');
  await expect(page).toHaveURL(/animation-lab.html\?workspace=characters&character=sir_chuckle/);
  await expect(page.frameLocator('#cms-frame').getByRole('heading',{name:'Sir Chuckle',exact:true})).toBeVisible();
});
