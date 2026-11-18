import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, name: 'anna' | 'ivan') {
  await page.goto('./#/auth');
  await page.getByLabel('Электронная почта').fill(name + '@demo.local');
  await page.getByLabel('Пароль', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
}
function checkErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function openIvanChat(page: Page) {
  await page.getByRole('tab', { name: 'Люди', exact: true }).click();
  await page.getByRole('button', { name: /Иван Петров/ }).click();
  await expect(page.getByLabel('Текст сообщения')).toBeVisible();
}

test('anonymous load, validation, sign-in, settings refresh and sign-out', async ({ page }) => {
  const errors = checkErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Nexus Messenger' })).toBeVisible();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await login(page, 'anna');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Профиль и настройки' })).toBeVisible();
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Электронная почта')).toBeVisible();
  expect(errors).toEqual([]);
});

test('two tabs keep independent accounts and exchange messages without duplicates', async ({ page, context }) => {
  const errors = checkErrors(page);
  await login(page, 'anna');
  const peer = await context.newPage();
  const peerErrors = checkErrors(peer);
  await login(peer, 'ivan');
  await openIvanChat(page);
  await page.getByLabel('Текст сообщения').fill('Проверка сообщения');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Проверка сообщения', { exact: true })).toHaveCount(1);
  await peer.getByRole('tab', { name: 'Чаты', exact: true }).click();
  await peer.getByRole('button', { name: /Открыть чат с Анна/ }).click();
  await expect(peer.getByRole('main').getByText('Проверка сообщения', { exact: true })).toHaveCount(1);
  await peer.getByLabel('Текст сообщения').fill('Ответ из другой вкладки');
  await peer.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('main').getByText('Ответ из другой вкладки', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Аудиозвонок', exact: true })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByText('Анна Смирнова', { exact: true }).first()).toBeVisible();
  expect([...errors, ...peerErrors]).toEqual([]);
});

test('invitation, two media participants, room refresh and cleanup', async ({ page, context }) => {
  const errors = checkErrors(page);
  await login(page, 'anna');
  await page.getByRole('button', { name: 'Создать звонок по ссылке' }).click();
  await page.getByRole('button', { name: 'Создать и получить ссылку' }).click();
  const invite = await page.getByLabel('Ссылка-приглашение').inputValue();
  expect(invite).toContain('/mdrg/#/call/');
  await page.getByRole('button', { name: 'Войти в комнату', exact: true }).click();
  await page.getByRole('button', { name: 'Подключиться с камерой' }).click();
  await expect(page.getByRole('button', { name: 'Завершить звонок' })).toBeVisible();
  const peer = await context.newPage();
  const peerErrors = checkErrors(peer);
  await peer.goto(invite);
  await peer.reload();
  await peer.getByRole('button', { name: 'Подключиться с камерой' }).click();
  await expect(peer.getByRole('button', { name: 'Завершить звонок' })).toBeVisible();
  await expect(page.getByText('Соединение установлено', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(peer.getByText('Соединение установлено', { exact: true })).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nexus-demo-room-parts') || '[]').length)).toBe(2);
  await peer.getByRole('button', { name: 'Завершить звонок' }).click();
  await page.getByRole('button', { name: 'Завершить звонок' }).click();
  await expect(page.getByText('Звонок завершён', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nexus-demo-room-parts') || '[]').length)).toBe(0);
  expect([...errors, ...peerErrors]).toEqual([]);
});

test('incoming direct call appears and both participants can connect', async ({ page, context }) => {
  const errors = checkErrors(page);
  await login(page, 'anna');
  const peer = await context.newPage();
  const peerErrors = checkErrors(peer);
  await login(peer, 'ivan');
  await openIvanChat(page);
  await page.getByRole('button', { name: 'Аудиозвонок', exact: true }).click();
  await expect(peer.getByRole('button', { name: /Принять/ })).toBeVisible();
  await peer.getByRole('button', { name: /Принять/ }).click();
  await page.getByRole('button', { name: 'Подключиться с микрофоном' }).click();
  await peer.getByRole('button', { name: 'Подключиться с микрофоном' }).click();
  await expect(page.getByRole('button', { name: 'Завершить звонок' })).toBeVisible();
  await expect(peer.getByRole('button', { name: 'Завершить звонок' })).toBeVisible();
  await expect(page.getByText('Соединение установлено', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  expect([...errors, ...peerErrors]).toEqual([]);
});

test('mobile auth and missing room display without overflow or a blank screen', async ({ page }) => {
  const errors = checkErrors(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Nexus Messenger' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('./#/call/missing');
  await expect(page.getByRole('heading', { name: 'Не удалось подключиться' })).toBeVisible();
  expect(errors).toEqual([]);
});
