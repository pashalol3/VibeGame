const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
const ROOM_CODE = 'TEST' + Math.floor(Math.random() * 1000);
const PLAYER_NAMES = ['Алиса', 'Боб', 'Вика', 'Гриша', 'Дина', 'Егор'];
const PORT = 3001;

let serverProcess;

async function waitForPhase(page, expectedPhase, timeout = 15000) {
  await page.waitForFunction(
    (phase) => {
      const el = document.getElementById('phaseName');
      return el && el.textContent.includes(phase);
    },
    expectedPhase,
    { timeout }
  );
}

async function getMyRole(page) {
  const text = await page.textContent('#myRole');
  const match = text.match(/Роль:\s*(.+)/);
  return match ? match[1].trim() : null;
}

async function closeRoleModal(page) {
  const modal = page.locator('#roleModal');
  if (await modal.isVisible().catch(() => false)) {
    await page.click('#roleModal button');
    await page.waitForFunction(() => {
      const el = document.getElementById('roleModal');
      return el && el.classList.contains('hidden');
    }, { timeout: 5000 });
  }
}

async function closeRoundActionModal(page) {
  const modal = page.locator('#roundActionModal');
  const gameOver = page.locator('#gameOverModal');
  if (await gameOver.isVisible().catch(() => false)) return;
  if (await modal.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      const el = document.getElementById('roundActionModal');
      if (el) el.classList.add('hidden');
    });
  }
}

test.beforeAll(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      NIGHT_TIME: '10',
      MASQUERADE_TIME: '15',
      ACCUSATION_TIME: '15',
      RESULT_TIME: '3',
      STEAL_TIME: '3'
    },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => console.log(`[server] ${data.toString().trim()}`));
  serverProcess.stderr.on('data', (data) => console.error(`[server-err] ${data.toString().trim()}`));

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
});

test.afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
});

test('full game flow: join, start, night, masquerade, accusation, voting', async ({ browser }) => {
  const contexts = [];
  const pages = [];

  for (let i = 0; i < PLAYER_NAMES.length; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    contexts.push(context);
    pages.push(page);
  }

  // Join room
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    await page.fill('#roomInput', ROOM_CODE);
    await page.fill('#nameInput', PLAYER_NAMES[i]);
    await page.click('#joinBtn');
    await page.waitForSelector('#lobbyInfo:not(.hidden)', { timeout: 5000 });
  }

  // Host starts game
  const hostPage = pages[0];
  await hostPage.waitForSelector('#startBtn:not(.hidden)', { timeout: 5000 });
  await hostPage.click('#startBtn');

  // Collect roles and close modals
  const roles = {};
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    await page.waitForSelector('#roleModal:not(.hidden)', { timeout: 5000 });
    const roleText = await page.textContent('#roleText');
    const roleMatch = roleText.match(/Ваша роль:\s*(.+)/);
    const role = roleMatch ? roleMatch[1].trim() : '???';
    roles[i] = role;
    console.log(`${PLAYER_NAMES[i]} => ${role}`);
    await closeRoleModal(page);
    await closeRoundActionModal(page);
  }

  const thiefIndex = Object.keys(roles).find(idx => roles[idx] === 'Вор');
  const butlerIndex = Object.keys(roles).find(idx => roles[idx] === 'Дворецкий');
  const detectiveIndex = Object.keys(roles).find(idx => roles[idx] === 'Детектив');

  expect(thiefIndex).toBeDefined();
  expect(butlerIndex).toBeDefined();
  expect(detectiveIndex).toBeDefined();

  console.log({ thiefIndex, butlerIndex, detectiveIndex });

  const thiefPage = pages[parseInt(thiefIndex)];
  const butlerPage = pages[parseInt(butlerIndex)];
  const accuserPage = pages[parseInt(detectiveIndex)];
  const accuserIndex = parseInt(detectiveIndex);

  // NIGHT
  await waitForPhase(thiefPage, 'Ночь');
  console.log('Night phase started');

  // Thief selects a relic via direct socket emit and verifies UI feedback
  await closeRoundActionModal(thiefPage);
  const selectedRelicId = 1; // Библиотека
  await thiefPage.evaluate((relicId) => {
    window.__socket.emit('thiefSelectRelic', { relicId });
  }, selectedRelicId);
  await expect(thiefPage.locator('#chatMessages')).toContainText('Вы выбрали', { timeout: 5000 });
  const selectedRelicText = await thiefPage.evaluate((id) => {
    const r = window.__gameState?.rooms?.find(room => room.id === id);
    return r ? `${r.relic} (${r.name})` : '';
  }, selectedRelicId);
  console.log('Thief selected relic:', selectedRelicText);

  // Butler selects a player via direct socket emit and verifies UI feedback
  await closeRoundActionModal(butlerPage);
  const butlerTargetIndex = parseInt(butlerIndex) === 0 ? 1 : 0;
  await butlerPage.evaluate((targetIdx) => {
    const players = window.__gameState?.players || {};
    const ids = Object.keys(players);
    if (ids[targetIdx]) window.__socket.emit('butlerSelectPlayer', { targetId: ids[targetIdx] });
  }, butlerTargetIndex);
  await expect(butlerPage.locator('#chatMessages')).toContainText('Вы узнали', { timeout: 5000 });
  console.log('Butler learned a role');

  // Wait for masquerade
  await Promise.all(pages.map(p => waitForPhase(p, 'Маскарад', 15000)));
  console.log('Masquerade phase started');

  // Thief moves to the selected relic room using the real socket
    // Move thief to the selected relic room. Because room positions are now randomized,
  // read actual room position from game state and teleport there.
  const targetRoom = await thiefPage.evaluate((id) => {
    const rooms = window.__gameState?.rooms || [];
    return rooms.find(r => r.id === id) || rooms[0];
  }, selectedRelicId);

    // Teleport thief into the target room center to guarantee steal progress despite random obstacles
  await thiefPage.evaluate((room) => {
    const socket = window.__socket;
    if (!socket || !room) return;
    // stand slightly offset to avoid exact center edge cases
    socket.emit('movement', { x: room.x + 2, y: room.y + 2 });
  }, targetRoom);
  await thiefPage.waitForTimeout(500);
  await thiefPage.evaluate((room) => {
    const socket = window.__socket;
    if (!socket || !room) return;
    socket.emit('movement', { x: room.x, y: room.y });
  }, targetRoom);
  await thiefPage.waitForTimeout(500);

  console.log('Thief moved to room:', targetRoom.name);

  // Wait for theft to complete (relic marked stolen) before accusation
  await expect(thiefPage.locator('#chatMessages')).toContainText('украдена', { timeout: 20000 });
  console.log('Theft succeeded');

  // Wait for accusation phase
  await Promise.all(pages.map(p => waitForPhase(p, 'Обвинение', 15000)));
  console.log('Accusation phase started');

  // Detective accuses the thief
  await closeRoundActionModal(accuserPage);
  await accuserPage.locator('#gamePlayerList li').nth(parseInt(thiefIndex)).click();
  await accuserPage.waitForTimeout(200);
  await accuserPage.click('button:has-text("Обвинить игрока")');
  await expect(accuserPage.locator('#chatMessages')).toContainText('обвиняет', { timeout: 3000 });
  console.log(`${PLAYER_NAMES[accuserIndex]} accused ${PLAYER_NAMES[parseInt(thiefIndex)]}`);

  // All eligible voters vote yes
  for (let i = 0; i < pages.length; i++) {
    if (i === parseInt(detectiveIndex) || i === parseInt(thiefIndex)) continue;
    const page = pages[i];
    await closeRoundActionModal(page);
    const yesBtn = page.locator('button:has-text("Голосовать ЗА")');
    if (await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      console.log(`${PLAYER_NAMES[i]} voted YES`);
    }
  }

  // Wait for outcome
  await Promise.race([
    pages[0].waitForSelector('#gameOverModal:not(.hidden)', { timeout: 30000 }),
    waitForPhase(pages[0], 'Итог', 30000)
  ]);

  const gameOverVisible = await pages[0].locator('#gameOverModal:not(.hidden)').isVisible().catch(() => false);
  if (gameOverVisible) {
    const title = await pages[0].textContent('#gameOverTitle');
    console.log('Game over:', title);
    expect(title).toContain('Победа');
  } else {
    console.log('Reached result phase');
  }

  // Screenshots
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: path.resolve(__dirname, `../test-screenshots/player-${i}-${PLAYER_NAMES[i]}.png`) });
  }

  await Promise.all(contexts.map(c => c.close()));
});
