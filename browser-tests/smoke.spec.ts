import { test, expect } from '@playwright/test';
test.skip(process.env.MDRG_DEMO_TEST === '1', 'Production build only');
test('production opens real authentication without local demo accounts', async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./');
 await expect(page.getByRole('heading',{name:'Nexus Messenger'})).toBeVisible();
 await expect(page.getByLabel('Электронная почта')).toBeVisible();
 await expect(page.getByText(/anna@demo.local/)).toHaveCount(0);
 await page.setViewportSize({width:320,height:740});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
test('private invite requires sign-in and preserves destination across refresh',async({page})=>{
 await page.goto('./#/call/00000000-0000-0000-0000-000000000001');
 await expect(page.getByLabel('Электронная почта')).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
});
