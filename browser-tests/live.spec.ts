import { test,expect,type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture=process.env.MDRG_TEST_FIXTURE;
test.skip(!fixture,'Credentials for isolated test users are required');
const users=fixture?JSON.parse(readFileSync(fixture,'utf8')):[];
async function login(page:Page,index:number){
 await page.goto('./#/auth');
 await page.getByLabel('Электронная почта').fill(users[index].email);
 await page.getByLabel('Пароль',{exact:true}).fill(users[index].password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('button',{name:'Настройки',exact:true})).toBeVisible({timeout:20000});
}
test('independent browsers exchange persistent messages and attachments through hosted Supabase',async({browser})=>{
 const options={baseURL:test.info().project.use.baseURL,proxy:test.info().project.use.proxy,permissions:['camera','microphone']};const a=await browser.newContext(options);const b=await browser.newContext(options);const first=await a.newPage();const second=await b.newPage();
 const errors:string[]=[];for(const p of[first,second])p.on('pageerror',e=>errors.push(e.message));
 try{
 await login(first,0);await login(second,1);
 await first.getByRole('tab',{name:'Люди',exact:true}).click();
 await first.getByLabel('Поиск',{exact:true}).fill(users[1].username);
 await first.getByRole('button',{name:new RegExp(users[1].display_name)}).click();
 const sent='Живая проверка '+crypto.randomUUID();
 await first.getByLabel('Текст сообщения').fill(sent);await first.getByRole('button',{name:'Отправить',exact:true}).click();
 await second.getByRole('tab',{name:'Чаты',exact:true}).click();
 await second.getByRole('button',{name:new RegExp('Открыть чат с '+users[0].display_name)}).click();
 await expect(second.getByRole('main').getByText(sent,{exact:true})).toBeVisible({timeout:20000});
 const reply='Ответ с другого устройства '+crypto.randomUUID();
 await second.getByLabel('Текст сообщения').fill(reply);await second.getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(first.getByRole('main').getByText(reply,{exact:true})).toBeVisible({timeout:20000});
 await second.reload();await expect(second.getByRole('main').getByText(reply,{exact:true})).toBeVisible({timeout:20000});
 await first.locator('input[type=file]').setInputFiles({name:'server-check.txt',mimeType:'text/plain',buffer:Buffer.from('Persistent file check')});
 await expect(second.getByRole('link',{name:/server-check.txt/})).toBeVisible({timeout:20000});
 const href=await second.getByRole('link',{name:/server-check.txt/}).getAttribute('href');expect(href).toContain('/storage/v1/object/sign/');
 expect(await first.evaluate(()=>localStorage.getItem('nexus-demo-messages'))).toBeNull();
 expect(errors).toEqual([]);
 }finally{await a.close();await b.close();}
});
test('direct audio call uses Supabase signaling between isolated browser contexts',async({browser})=>{
 const opts={baseURL:test.info().project.use.baseURL,proxy:test.info().project.use.proxy,permissions:['camera','microphone']};const a=await browser.newContext(opts);const b=await browser.newContext(opts);const first=await a.newPage();const second=await b.newPage();
 const errors:string[]=[];for(const p of[first,second])p.on('pageerror',e=>errors.push(e.message));
 try{
 await login(first,0);await login(second,1);
 await first.getByRole('tab',{name:'Чаты',exact:true}).click();
 await first.getByRole('button',{name:new RegExp('Открыть чат с '+users[1].display_name)}).click();
 await first.getByRole('button',{name:'Аудиозвонок',exact:true}).click();
 await expect(second.getByRole('button',{name:'Принять звонок'})).toBeVisible({timeout:20000});
 await second.getByRole('button',{name:'Принять звонок'}).click();
 await first.getByRole('button',{name:'Подключиться с микрофоном'}).click();
 await second.getByRole('button',{name:'Подключиться с микрофоном'}).click();
 await expect(first.getByText('Соединение установлено',{exact:true}).first()).toBeVisible({timeout:30000});
 await expect(second.getByText('Соединение установлено',{exact:true}).first()).toBeVisible({timeout:30000});
 await first.getByRole('button',{name:'Завершить звонок',exact:true}).click();
 await expect(second.getByRole('button',{name:'Завершить звонок',exact:true})).toHaveCount(0,{timeout:20000});
 expect(errors).toEqual([]);
 }finally{await a.close();await b.close();}
});
