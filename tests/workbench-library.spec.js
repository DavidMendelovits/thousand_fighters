import {test,expect} from '@playwright/test';

test('empty drafts, uncropped reference review and reversible archive survive reload',async({page,request},testInfo)=>{
  // Default Playwright config starts the isolated, keyless CMS fixture.
  const id=`pw_library_${testInfo.project.name.replaceAll('-','_')}_${Date.now()}`;
  const create=await request.post('/api/tools/create_character_draft',{data:{characterId:id,brief:'A living paint ribbon',artStyle:'paint'}});
  expect(create.ok()).toBeTruthy();
  const reference=await request.post('/api/tools/generate_character_concept',{data:{characterId:id,prompt:'One isolated paint creature'}});
  expect(reference.ok()).toBeTruthy();
  await page.goto(`/roster/${id}?standalone=1`);
  await expect(page.locator('[data-preview-status]')).toContainText('no complete motion clip');
  await expect(page.locator('[data-playtest]')).toBeDisabled();
  await page.locator('[data-studio-section="identity"]').click();
  await expect(page.locator('.reference-stage img')).toHaveCount(1);
  await expect(page.locator('.reference-stage img')).toHaveCSS('object-fit','contain');
  await expect(page.locator('.concept-panels')).toHaveCount(0);
  await page.locator('[data-reference-notes]').fill('Test review: incompatible silhouette.');
  await page.locator('[data-reference-review="rejected"]').click();
  await expect(page.locator('[data-reference-status="rejected"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-reference-status="rejected"]')).toBeVisible();
  await page.locator('[data-archive-character="true"]').click();
  await expect(page.locator('[data-collection="archived"]')).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await expect(page.locator('[data-archive-character="false"]')).toBeVisible();
  await page.locator('[data-archive-character="false"]').click();
  await expect(page.locator('[data-collection="drafts"]')).toHaveAttribute('aria-pressed','true');
  const detail=await (await request.get(`/api/characters/${id}/workbench`)).json();
  expect(detail.reference.status).toBe('rejected');expect(detail.archived).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
