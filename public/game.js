const socket = io();
window.__socket = socket;

// ==================== DOM ELEMENTS ====================
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const lobbyInfo = document.getElementById('lobbyInfo');
const roomCodeSpan = document.getElementById('roomCode');
const playerCountSpan = document.getElementById('playerCount');
const playerList = document.getElementById('playerList');
const startBtn = document.getElementById('startBtn');
const errorDiv = document.getElementById('error');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const phaseName = document.getElementById('phaseName');
const timerSpan = document.getElementById('timer');
const roundInfo = document.getElementById('roundInfo');
const myRole = document.getElementById('myRole');
const myGoal = document.getElementById('myGoal');
const gamePlayerList = document.getElementById('gamePlayerList');
const relicList = document.getElementById('relicList');
const actionButtons = document.getElementById('actionButtons');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatBtn = document.getElementById('chatBtn');

const roleModal = document.getElementById('roleModal');
const roleTitle = document.getElementById('roleTitle');
const roleText = document.getElementById('roleText');
const roleModalClose = roleModal.querySelector('.close-modal');

const offerModal = document.getElementById('offerModal');
const offerText = document.getElementById('offerText');
const acceptMask = document.getElementById('acceptMask');
const declineMask = document.getElementById('declineMask');

const gameOverModal = document.getElementById('gameOverModal');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverText = document.getElementById('gameOverText');
const backToLobby = document.getElementById('backToLobby');

const systemLog = [];
const systemLogEl = document.getElementById('systemLog');
const systemLogWrapper = document.getElementById('systemLogWrapper');
const toggleLogBtn = document.getElementById('toggleLogBtn');
const copyLogBtn = document.getElementById('copyLogBtn');

const roundActionModal = document.getElementById('roundActionModal');
const roundActionTitle = document.getElementById('roundActionTitle');
const roundActionText = document.getElementById('roundActionText');
const roundActionClose = document.getElementById('roundActionClose');

let roundActionAutoHide = null;

// ==================== STATE ====================
let state = null;
let myId = null;
let keys = {};
let selectedTargetId = null;
let mousePos = { x: 0, y: 0 };
let lastMoveTime = 0;
let lastMoveEmit = 0;
const MOVE_EMIT_INTERVAL = 50; // ms
const renderedPlayers = {};
const targetPlayers = {};

const phaseNames = {
  lobby: 'Лобби',
  night: 'Ночь',
  masquerade: 'Маскарад',
  accusation: 'Обвинение',
  result: 'Итог',
  ended: 'Игра окончена'
};

const roleNames = {
  detective: 'Детектив',
  thief: 'Вор',
  butler: 'Дворецкий',
  impostor: 'Самозванец',
  guest: 'Гость',
  hidden: '???'
};

const roleGoals = {
  detective: 'Арестуйте Вора до кражи 3 реликвий.',
  thief: 'Украдите 3 реликвии или останьтесь нераскрытым.',
  butler: 'Ночью узнавайте роли и помогайте Детективам.',
  impostor: 'Ведите себя подозрительно и сбивайте следствие.',
  guest: 'Помогайте Детективам найти Вора.'
};

// ==================== METRICS ====================
const METERS_PER_PIXEL = 0.05; // 1 px = 5 cm; 20 px = 1 meter
const CANVAS_METERS = { width: 50, height: 35 };
const CANVAS_PIXELS = {
  width: Math.round(CANVAS_METERS.width / METERS_PER_PIXEL),
  height: Math.round(CANVAS_METERS.height / METERS_PER_PIXEL)
};
const PLAYER_RADIUS_METERS = 0.8;
const PLAYER_RADIUS_PIXELS = PLAYER_RADIUS_METERS / METERS_PER_PIXEL;
const PLAYER_SPEED_METERS_PER_SECOND = 9;
const PLAYER_SPEED_PIXELS_PER_SECOND = PLAYER_SPEED_METERS_PER_SECOND / METERS_PER_PIXEL;

function metersToPixels(m) {
  return m / METERS_PER_PIXEL;
}

function pixelsToMeters(px) {
  return px * METERS_PER_PIXEL;
}

// ==================== ASSETS ====================
const ASSET_BASE = '/assets';
const UNIT_COLORS = ['red', 'blue', 'yellow', 'purple', 'black'];
const HEX_TO_UNIT = {
  '#EF5350': 'red',
  '#EC407A': 'purple',
  '#AB47BC': 'purple',
  '#7E57C2': 'purple',
  '#5C6BC0': 'blue',
  '#42A5F5': 'blue',
  '#29B6F6': 'blue',
  '#26C6DA': 'blue',
  '#26A69A': 'black',
  '#66BB6A': 'yellow'
};

function getUnitColor(hex) {
  return HEX_TO_UNIT[hex] || 'blue';
}

const ASSETS = {
  units: {},
  buildings: {},
  terrain: {}
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

async function loadAssets() {
  const promises = [];

  for (const color of UNIT_COLORS) {
    promises.push(
      Promise.all([
        loadImage(`${ASSET_BASE}/units/${color}/Pawn_Idle.png`),
        loadImage(`${ASSET_BASE}/units/${color}/Pawn_Run.png`)
      ]).then(([idle, run]) => {
        ASSETS.units[color] = { idle, run };
      })
    );
  }

  const buildingTypes = ['House1', 'House2', 'House3', 'Castle', 'Tower', 'Archery', 'Barracks', 'Monastery'];
  for (const color of UNIT_COLORS) {
    ASSETS.buildings[color] = {};
    for (const type of buildingTypes) {
      promises.push(
        loadImage(`${ASSET_BASE}/buildings/${color}/${type}.png`).then(img => {
          ASSETS.buildings[color][type] = img;
        })
      );
    }
  }

  promises.push(
    Promise.all([
      loadImage(`${ASSET_BASE}/terrain/tileset/Tilemap_color1.png`),
      loadImage(`${ASSET_BASE}/terrain/resources/gold/Gold_Resource.png`),
      loadImage(`${ASSET_BASE}/terrain/resources/wood/Wood Resource.png`),
      loadImage(`${ASSET_BASE}/terrain/resources/meat/Meat Resource.png`),
      loadImage(`${ASSET_BASE}/terrain/resources/tools/Tool_01.png`),
      loadImage(`${ASSET_BASE}/terrain/resources/tools/Tool_02.png`)
    ]).then(([tilemap, gold, wood, meat, tool1, tool2]) => {
      ASSETS.terrain.tilemap = tilemap;
      ASSETS.terrain.gold = gold;
      ASSETS.terrain.wood = wood;
      ASSETS.terrain.meat = meat;
      ASSETS.terrain.tool1 = tool1;
      ASSETS.terrain.tool2 = tool2;
    })
  );

  await Promise.all(promises);
  logSystem('assets loaded', { unitColors: UNIT_COLORS, buildingTypes });
}

loadAssets().catch(err => logSystem('asset load error', err.message));

const RELIC_ICONS = {
  0: () => ASSETS.terrain.gold,
  1: () => ASSETS.terrain.tool1,
  2: () => ASSETS.terrain.tool2,
  3: () => ASSETS.terrain.meat,
  4: () => ASSETS.terrain.wood
};

// ==================== SYSTEM LOG ====================
function logSystem(msg, data) {
  const entry = { time: new Date().toISOString(), msg, data };
  systemLog.push(entry);
  if (systemLog.length > 200) systemLog.shift();
  const div = document.createElement('div');
  div.textContent = `${entry.time.split('T')[1].split('.')[0]} ${msg}`;
  systemLogEl.appendChild(div);
  systemLogEl.scrollTop = systemLogEl.scrollHeight;
}

function exportSystemLog() {
  return JSON.stringify(systemLog, null, 2);
}

if (copyLogBtn) {
  copyLogBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(exportSystemLog()).then(() => {
      copyLogBtn.textContent = 'Скопировано!';
      setTimeout(() => copyLogBtn.textContent = 'Копировать лог', 2000);
    });
  });
}

if (toggleLogBtn && systemLogWrapper) {
  toggleLogBtn.addEventListener('click', () => {
    const hidden = systemLogWrapper.classList.toggle('hidden');
    toggleLogBtn.textContent = hidden ? 'Показать системный лог' : 'Скрыть системный лог';
  });
}

// ==================== LOBBY ====================
joinBtn.addEventListener('click', () => {
  const roomId = roomInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!roomId || !name) {
    showError('Введите имя и код комнаты');
    return;
  }
  socket.emit('joinRoom', { roomId, name }, res => {
    if (res.error) {
      showError(res.error);
    } else {
      lobbyInfo.classList.remove('hidden');
      roomCodeSpan.textContent = res.roomId;
      errorDiv.classList.add('hidden');
    }
  });
});

startBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

backToLobby.addEventListener('click', () => {
  location.reload();
});

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove('hidden');
}

// ==================== SOCKET EVENTS ====================
socket.on('state', newState => {
  window.__gameState = newState;
  logSystem('state received', { phase: newState.phase, myId: newState.myId, myRole: newState.myRole, maskOffer: newState.maskOffer, players: Object.keys(newState.players).length });
  if (state && state.phase !== newState.phase) {
    selectedTargetId = null;
  }
  const phaseChanged = !state || state.phase !== newState.phase;
  state = newState;
  myId = newState.myId;
  updateRenderedTargets(newState.players);
  updateLobby();
  if (state.phase !== 'lobby') {
    showGameScreen();
    updateGameUI();
    requestAnimationFrame(render);
  }
  if (phaseChanged && state.phase !== 'lobby' && state.phase !== 'ended') {
    showRoundActionModal();
  }
});

socket.on('publicState', newState => {
  if (!state || state.phase === 'lobby') {
    state = newState;
    if (!myId && newState.myId) myId = newState.myId;
    updateLobby();
  }
});

socket.on('roleInfo', info => {
  roleTitle.textContent = 'Ваша роль';
  roleText.textContent = info.text;
  roleModal.classList.remove('hidden');
});

socket.on('notify', text => {
  logSystem('notify', text);
  addChatMessage(text, 'info');
});

socket.on('errorMessage', text => {
  logSystem('errorMessage', text);
  addChatMessage(text, 'penalty');
});

socket.on('connect', () => {
  logSystem('connect', 'connected');
  addChatMessage('Подключено к серверу', 'info');
});

socket.on('disconnect', () => {
  logSystem('disconnect', 'disconnected');
  addChatMessage('Соединение потеряно', 'penalty');
});

roleModalClose.addEventListener('click', () => roleModal.classList.add('hidden'));

// ==================== LOBBY UI ====================
function updateLobby() {
  if (!state || !myId) return;
  const players = Object.values(state.players);
  playerCountSpan.textContent = players.length;
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === state.hostId) li.textContent += ' 👑';
    playerList.appendChild(li);
  });

  const isHost = state.hostId === myId;
  if (isHost && players.length >= 2) {
    startBtn.classList.remove('hidden');
  } else {
    startBtn.classList.add('hidden');
  }
}

function showGameScreen() {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
}

// ==================== GAME UI ====================
function updateGameUI() {
  if (!state) return;

  phaseName.textContent = phaseNames[state.phase] || state.phase;
  roundInfo.textContent = `Раунд ${state.round}/${state.maxRounds}`;

  if (state.phaseEndTime) {
    const remaining = Math.max(0, Math.ceil((state.phaseEndTime - Date.now()) / 1000));
    timerSpan.textContent = formatTime(remaining);
  } else {
    timerSpan.textContent = '00:00';
  }

  if (state.myRole) {
    myRole.textContent = `Роль: ${roleNames[state.myRole]}`;
    myGoal.textContent = `Цель: ${roleGoals[state.myRole]}`;
  }

  gamePlayerList.innerHTML = '';
  Object.values(state.players).forEach(p => {
    const li = document.createElement('li');
    let text = p.name;
    if (p.id === myId) text += ' (вы)';
    if (state.surveillance && state.surveillance.targetId === p.id && state.surveillance.endTime > Date.now()) {
      const roomName = state.rooms[p.roomId]?.name || '?';
      text += ` — слежка: ${roomName}`;
    }
    li.textContent = text;
    li.style.cursor = p.id === myId ? 'default' : 'pointer';
    if (p.id !== myId) {
      li.addEventListener('click', () => {
        selectedTargetId = p.id;
        logSystem('player selected from list', { selectedTargetId: p.id, name: p.name });
        updateGameUI();
      });
    }
    if (selectedTargetId === p.id) {
      li.style.background = 'rgba(255, 215, 0, 0.2)';
    }
    gamePlayerList.appendChild(li);
  });

  relicList.innerHTML = '';
  state.rooms.forEach(r => {
    const li = document.createElement('li');
    const stolen = state.stolenRelics.includes(r.id);
    li.textContent = `${r.relic} (${r.name}) ${stolen ? '✓ Украдена' : ''}`;
    li.style.color = stolen ? '#00ff7f' : '#fff';
    li.addEventListener('click', () => {
      if ((state.phase === 'night' || (state.phase === 'masquerade' && state.myRole === 'thief' && !state.myStolenThisRound)) && state.myRole === 'thief' && !stolen) {
        selectedTargetId = r.id;
        socket.emit('thiefSelectRelic', { relicId: r.id });
      } else {
        selectedTargetId = r.id;
      }
      updateGameUI();
    });
    if (selectedTargetId === r.id) {
      li.style.background = 'rgba(255, 215, 0, 0.2)';
    }
    relicList.appendChild(li);
  });

  actionButtons.innerHTML = '';
  renderActionButtons();

  const currentCount = chatMessages.children.length;
  const newMessages = state.messages.slice(currentCount);
  newMessages.forEach(m => addChatMessage(m.text, m.type, true));
  if (newMessages.length > 0) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  if (state.gameOver && gameOverModal.classList.contains('hidden')) {
    gameOverTitle.textContent = state.gameOver.winner === 'detectives' ? 'Победа Детективов!' : 'Победа Воров!';
    gameOverText.textContent = state.gameOver.reason;
    gameOverModal.classList.remove('hidden');
  }

  if (state.maskOffer && state.maskOffer.toId === myId) {
    const from = state.players[state.maskOffer.fromId];
    offerText.textContent = `${from ? from.name : 'Игрок'} предлагает обменяться масками.`;
    offerModal.classList.remove('hidden');
  } else {
    offerModal.classList.add('hidden');
  }
}

function getRoundActionText() {
  if (!state || !state.myRole) return 'Новый раунд начался.';
  const role = state.myRole;
  const phase = state.phase;

  if (phase === 'night') {
    if (role === 'thief') {
      let text = 'Ночь: выберите реликвию для кражи.';
      if (state.myStolenThisRound) {
        text += ' Реликвия уже украдена в этом раунде.';
      }
      return text + ' Кликните по комнате на карте или по её названию в списке реликвий.';
    }
    if (role === 'butler') return 'Ночь: выберите одного игрока, чью роль хотите узнать.';
    return 'Ночь. Воры и Дворецкий делают выбор. Дождитесь фазы Маскарада.';
  }

  if (phase === 'masquerade') {
    if (role === 'thief') {
      if (state.myStolenThisRound) return 'Маскарад: реликвия уже украдена в этом раунде. Сыграйте незаметно до конца раунда.';
      if (state.myStealProgress > 0) return 'Маскарад: стойте в комнате с реликвией в одиночестве, чтобы завершить кражу.';
      return 'Маскарад: доберитесь до выбранной реликвии и простойте в её комнате 15 секунд в одиночестве. Если цель ещё не выбрана — кликните по комнате.';
    }
    return 'Маскарад: двигайтесь по особняку, следите за подозрительными игроками, предлагайте обмен масками.';
  }

  if (phase === 'accusation') {
    if (role === 'detective') return 'Обвинение: обсудите и голосуйте. При уверенности можно совершить официальный арест (один раз за игру). Перед арестом лучше проверить роль Дворецким.';
    return 'Обвинение: обсудите подозрения и проголосуйте. Ошибочное обвинение лишит голоса в следующем раунде.';
  }

  if (phase === 'result') {
    return 'Итог раунда. Смотрите, какие реликвии украдены, и готовьтесь к следующему раунду.';
  }

  return `${phaseNames[phase] || phase}: действуйте согласно своей роли.`;
}

function showRoundActionModal() {
  if (!state) return;
  roundActionTitle.textContent = `Раунд ${state.round} — ${phaseNames[state.phase] || state.phase}`;
  roundActionText.textContent = getRoundActionText();
  roundActionModal.classList.remove('hidden');
  clearTimeout(roundActionAutoHide);
  roundActionAutoHide = setTimeout(() => {
    roundActionModal.classList.add('hidden');
  }, 6000);
}

roundActionClose.addEventListener('click', () => {
  roundActionModal.classList.add('hidden');
  clearTimeout(roundActionAutoHide);
});

function renderActionButtons() {
  if (!state || !myId) return;
  const me = state.players[myId];
  if (!me) return;

  if (state.phase === 'night') {
    if (state.myRole === 'thief' && !state.myStolenThisRound) {
      const btn = createButton('Выбрать реликвию для кражи', () => {
        if (selectedTargetId !== null && !state.stolenRelics.includes(selectedTargetId)) {
          socket.emit('thiefSelectRelic', { relicId: selectedTargetId });
        }
      });
      actionButtons.appendChild(btn);
    }
    if (state.myRole === 'butler') {
      const btn = createButton('Узнать роль игрока', () => {
        if (selectedTargetId && selectedTargetId !== myId) {
          socket.emit('butlerSelectPlayer', { targetId: selectedTargetId });
        }
      });
      actionButtons.appendChild(btn);
    }
  }

  if (state.phase === 'masquerade' && state.myRole === 'thief' && !state.myStolenThisRound) {
    const btn = createButton('Выбрать реликвию для кражи', () => {
      if (selectedTargetId !== null && !state.stolenRelics.includes(selectedTargetId)) {
        socket.emit('thiefSelectRelic', { relicId: selectedTargetId });
      }
    });
    actionButtons.appendChild(btn);
  }

  if (state.phase === 'masquerade') {
    const btn = createButton('Предложить обмен масками', () => {
      if (selectedTargetId && selectedTargetId !== myId && state.players[selectedTargetId]) {
        logSystem('offerMask click', { selectedTargetId, myId, phase: state.phase, myRole: state.myRole });
        socket.emit('offerMask', { targetId: selectedTargetId });
      } else {
        logSystem('offerMask click: no target', { selectedTargetId, myId });
      }
    });
    actionButtons.appendChild(btn);

    if (state.myRole === 'detective') {
      const btn2 = createButton('Объявить слежку', () => {
        if (selectedTargetId && selectedTargetId !== myId && state.players[selectedTargetId]) {
          logSystem('surveillance click', { selectedTargetId, myId });
          socket.emit('surveillance', { targetId: selectedTargetId });
        } else {
          logSystem('surveillance click: no target', { selectedTargetId, myId });
        }
      });
      actionButtons.appendChild(btn2);
    }
  }

  if (state.phase === 'accusation') {
    const acc = state.accusation;
    if (!acc) {
      if (!state.nextRoundNoVote.includes(myId)) {
        const btn = createButton('Обвинить игрока', () => {
          if (selectedTargetId && selectedTargetId !== myId) {
            socket.emit('accuse', { targetId: selectedTargetId });
          }
        });
        actionButtons.appendChild(btn);
      }
    } else if (!acc.closed) {
      if (acc.accuserId !== myId && acc.targetId !== myId && !state.nextRoundNoVote.includes(myId)) {
        const yes = createButton('Голосовать ЗА', () => socket.emit('vote', { vote: 'yes' }));
        const no = createButton('Голосовать ПРОТИВ', () => socket.emit('vote', { vote: 'no' }));
        actionButtons.appendChild(yes);
        actionButtons.appendChild(no);
      }
    }

    if (state.myRole === 'detective' && !state.officialArrestUsed) {
      const arrest = createButton('Официальный арест', () => {
        if (selectedTargetId && selectedTargetId !== myId) {
          socket.emit('officialArrest', { targetId: selectedTargetId });
        }
      });
      arrest.style.background = '#ef5350';
      arrest.style.color = '#fff';
      actionButtons.appendChild(arrest);
    }
  }
}

function createButton(text, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function addChatMessage(text, type = 'info', append = true, dedup = false) {
  const div = document.createElement('div');
  div.className = `msg-${type}`;
  div.textContent = text;
  if (dedup) {
    const existing = Array.from(chatMessages.children).find(el => el.textContent === text);
    if (existing) {
      existing.replaceWith(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }
  }
  chatMessages.appendChild(div);
  if (append) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateRenderedTargets(players) {
  if (!players) return;
  Object.values(players).forEach(p => {
    if (!renderedPlayers[p.id]) {
      renderedPlayers[p.id] = { x: p.x, y: p.y };
    }
    targetPlayers[p.id] = { x: p.x, y: p.y };
  });
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

// ==================== CANVAS RENDERING ====================
const UNIT_FRAME_SIZE = 192;
const UNIT_DISPLAY_SIZE = 84;
const UNIT_IDLE_FRAMES = 8;
const UNIT_RUN_FRAMES = 6;
const playerAnim = {};
const lastPositions = {};

let backgroundCanvas = null;
let backgroundCtx = null;
let backgroundDirty = true;

function drawSprite(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight, flipX = false) {
  if (!img || !img.complete || img.naturalWidth === 0) return;
  if (flipX) {
    ctx.save();
    ctx.translate(dx + dWidth, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, dWidth, dHeight);
    ctx.restore();
  } else {
    ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
  }
}

function cacheBackground() {
  if (!backgroundDirty) return;
  if (!backgroundCanvas) {
    backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = canvas.width;
    backgroundCanvas.height = canvas.height;
    backgroundCtx = backgroundCanvas.getContext('2d');
  }
  const tile = ASSETS.terrain.tilemap;
  if (!tile || !tile.complete) {
    backgroundCtx.fillStyle = '#3e5f30';
    backgroundCtx.fillRect(0, 0, canvas.width, canvas.height);
    backgroundDirty = false;
    return;
  }
  const tileW = 32;
  const tileH = 32;
  const cols = Math.ceil(canvas.width / tileW);
  const rows = Math.ceil(canvas.height / tileH);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = 2 * tileW;
      const sy = 1 * tileH;
      backgroundCtx.drawImage(tile, sx, sy, tileW, tileH, c * tileW, r * tileH, tileW, tileH);
    }
  }
  backgroundDirty = false;
}

function drawDecorations() {
  // No bushes/rocks/trees per user request
}

function render() {
  if (!state) return;

  const me = state.players[myId];
  const myX = me ? (renderedPlayers[myId] ? renderedPlayers[myId].x : me.x) : 0;
  const myY = me ? (renderedPlayers[myId] ? renderedPlayers[myId].y : me.y) : 0;
  const visionRadius = state.visionRadius || metersToPixels(7);

  if (backgroundDirty && ASSETS.terrain.tilemap && ASSETS.terrain.tilemap.complete) {
    cacheBackground();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (backgroundCanvas) {
    ctx.drawImage(backgroundCanvas, 0, 0);
  } else {
    const tile = ASSETS.terrain.tilemap;
    if (!tile || !tile.complete) {
      ctx.fillStyle = '#3e5f30';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  drawDecorations();

  // Paths between rooms
  ctx.strokeStyle = 'rgba(139, 90, 43, 0.5)';
  ctx.lineWidth = metersToPixels(0.6);
  ctx.setLineDash([]);
  const center = state.rooms[0];
  for (let i = 1; i < state.rooms.length; i++) {
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(state.rooms[i].x, state.rooms[i].y);
    ctx.stroke();
  }

  // Update rendered positions toward target positions smoothly
  Object.keys(targetPlayers).forEach(id => {
    const target = targetPlayers[id];
    const rendered = renderedPlayers[id];
    if (!rendered) {
      renderedPlayers[id] = { x: target.x, y: target.y };
      return;
    }
    rendered.x = lerp(rendered.x, target.x, 0.12);
    rendered.y = lerp(rendered.y, target.y, 0.12);
  });

  // Draw obstacles (natural barriers)
  if (state.obstacles) {
    state.obstacles.forEach(o => {
      const img = o.type === 0 ? ASSETS.terrain.wood : (o.type === 1 ? ASSETS.terrain.tool1 : ASSETS.terrain.tool2);
      if (img && img.complete) {
        const size = o.r * 2;
        ctx.drawImage(img, o.x - size / 2, o.y - size / 2, size, size);
      } else {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fillStyle = '#4a4a4a';
        ctx.fill();
      }
    });
  }

  // Draw rooms as buildings
  state.rooms.forEach((r, idx) => {
    const buildingColor = UNIT_COLORS[idx % UNIT_COLORS.length];
    const buildingTypes = ['Castle', 'House1', 'House2', 'House3', 'Tower'];
    const buildingType = buildingTypes[idx % buildingTypes.length];
    const buildingImg = ASSETS.buildings[buildingColor][buildingType];
    if (buildingImg && buildingImg.complete) {
      const bw = buildingImg.width * 0.6;
      const bh = buildingImg.height * 0.6;
      ctx.drawImage(buildingImg, r.x - bw / 2, r.y - bh / 2 - metersToPixels(1), bw, bh);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(r.x - metersToPixels(3), r.y + metersToPixels(2.5), metersToPixels(6), metersToPixels(1.2));
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.name, r.x, r.y + metersToPixels(3.1));

    const stolen = state.stolenRelics.includes(r.id);
    const relicFn = RELIC_ICONS[idx] || RELIC_ICONS[0];
    const relicImg = relicFn();
    if (relicImg && relicImg.complete && !stolen) {
      const size = metersToPixels(2);
      ctx.drawImage(relicImg, r.x - size / 2, r.y + metersToPixels(0.5), size, size);
    }
    if (stolen) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(r.x - metersToPixels(1), r.y + metersToPixels(0.5), metersToPixels(2), metersToPixels(2));
      ctx.fillStyle = '#00ff7f';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('✓', r.x, r.y + metersToPixels(1.5));
    }

    if (state.surveillance && state.surveillance.targetId && state.surveillance.endTime > Date.now()) {
      const target = state.players[state.surveillance.targetId];
      if (target && target.roomId === r.id) {
        ctx.beginPath();
        ctx.arc(r.x, r.y + metersToPixels(1.5), metersToPixels(2.5), 0, Math.PI * 2);
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = metersToPixels(0.2);
        ctx.stroke();
      }
    }

    if (state.myRole === 'thief' && selectedTargetId === r.id && !state.stolenRelics.includes(r.id)) {
      ctx.beginPath();
      ctx.arc(r.x, r.y + metersToPixels(1.5), metersToPixels(2.75), 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff7f';
      ctx.lineWidth = metersToPixels(0.15);
      ctx.setLineDash([metersToPixels(0.4), metersToPixels(0.3)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Draw players
  Object.values(state.players).forEach(p => {
    if (!p.connected) return;
    const rp = renderedPlayers[p.id];
    if (!rp) return;
    const px = rp.x;
    const py = rp.y;

    const unitColor = getUnitColor(p.color);
    const unitSet = ASSETS.units[unitColor];
    if (!unitSet || !unitSet.idle.complete) {
      ctx.beginPath();
      ctx.arc(px, py, PLAYER_RADIUS_PIXELS, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      return;
    }

    if (!lastPositions[p.id]) lastPositions[p.id] = { x: px, y: py };
    const lp = lastPositions[p.id];
    const dx = px - lp.x;
    const dy = py - lp.y;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.3;
    lp.x = px;
    lp.y = py;

    if (!playerAnim[p.id]) playerAnim[p.id] = { frame: 0, lastFrameTime: 0, facingRight: true };
    const anim = playerAnim[p.id];
    if (dx > 0.1) anim.facingRight = true;
    if (dx < -0.1) anim.facingRight = false;

    const now = performance.now();
    const frames = moving ? UNIT_RUN_FRAMES : UNIT_IDLE_FRAMES;
    const fps = moving ? 10 : 6;
    if (now - anim.lastFrameTime > 1000 / fps) {
      anim.frame = (anim.frame + 1) % frames;
      anim.lastFrameTime = now;
    }

    const img = moving ? unitSet.run : unitSet.idle;
    const sx = anim.frame * UNIT_FRAME_SIZE;
    const sy = 0;
    const dSize = UNIT_DISPLAY_SIZE;
    drawSprite(img, sx, sy, UNIT_FRAME_SIZE, UNIT_FRAME_SIZE, px - dSize / 2, py - dSize / 2, dSize, dSize, !anim.facingRight);

    if (p.id === myId) {
      ctx.beginPath();
      ctx.arc(px, py, metersToPixels(1.4), 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = metersToPixels(0.15);
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, px, py - metersToPixels(2.1));

    if (p.id === myId && state.myRole) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(roleNames[state.myRole], px, py + metersToPixels(1.9));
    }

    if (p.id === myId && p.roomId !== null) {
      ctx.fillStyle = '#aaa';
      ctx.font = '12px sans-serif';
      ctx.fillText(state.rooms[p.roomId].name, px, py + metersToPixels(2.6));
    }

    if (p.id === myId && state.myRole === 'thief' && state.myStealProgress > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px - metersToPixels(1.2), py + metersToPixels(2.1), metersToPixels(2.4), metersToPixels(0.4));
      ctx.fillStyle = '#00ff7f';
      ctx.fillRect(px - metersToPixels(1.2), py + metersToPixels(2.1), metersToPixels(2.4) * Math.min(1, state.myStealProgress / 15), metersToPixels(0.4));
    }
  });

  if (selectedTargetId && state.players[selectedTargetId] && renderedPlayers[selectedTargetId]) {
    const p = renderedPlayers[selectedTargetId];
    ctx.beginPath();
    ctx.arc(p.x, p.y, metersToPixels(1.6), 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = metersToPixels(0.1);
    ctx.setLineDash([metersToPixels(0.25), metersToPixels(0.25)]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Fog of war overlay
  if (me && visionRadius > 0) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tctx = tempCanvas.getContext('2d');

    tctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    tctx.fillRect(0, 0, canvas.width, canvas.height);

    tctx.globalCompositeOperation = 'destination-out';

    const grad = tctx.createRadialGradient(myX, myY, 0, myX, myY, visionRadius);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.85, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    tctx.fillStyle = grad;
    tctx.beginPath();
    tctx.arc(myX, myY, visionRadius, 0, Math.PI * 2);
    tctx.fill();

    Object.values(state.players).forEach(p => {
      if (!p.connected || p.id === myId) return;
      const rp = renderedPlayers[p.id];
      if (!rp) return;
      const dist = Math.hypot(rp.x - myX, rp.y - myY);
      if (dist < visionRadius) {
        const g = tctx.createRadialGradient(rp.x, rp.y, 0, rp.x, rp.y, metersToPixels(2.5));
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        tctx.fillStyle = g;
        tctx.beginPath();
        tctx.arc(rp.x, rp.y, metersToPixels(2.5), 0, Math.PI * 2);
        tctx.fill();
      }
    });

    state.rooms.forEach(r => {
      const dist = Math.hypot(r.x - myX, r.y - myY);
      if (dist < visionRadius + r.r) {
        const g = tctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r + metersToPixels(2));
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        tctx.fillStyle = g;
        tctx.beginPath();
        tctx.arc(r.x, r.y, r.r + metersToPixels(2), 0, Math.PI * 2);
        tctx.fill();
      }
    });

    ctx.drawImage(tempCanvas, 0, 0);
  }

  requestAnimationFrame(render);
}

// ==================== INPUT ====================
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Enter' && document.activeElement === chatInput) {
    sendChat();
  }
});

window.addEventListener('keyup', e => {
  keys[e.code] = false;
});

window.addEventListener('blur', () => {
  keys = {};
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) keys = {};
});

function sendChat() {
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('chat', { text });
    chatInput.value = '';
  }
}

chatBtn.addEventListener('click', sendChat);

let localX = 0;
let localY = 0;
let localPosInitialized = false;

function initLocalPos() {
  if (localPosInitialized || !state || !myId || !state.players[myId]) return;
  localX = state.players[myId].x;
  localY = state.players[myId].y;
  localPosInitialized = true;
}

function updateMovement() {
  if (!state || state.phase !== 'masquerade' || !myId || state.gameOver) {
    requestAnimationFrame(updateMovement);
    return;
  }
  initLocalPos();
  const me = state.players[myId];
  if (!me) {
    requestAnimationFrame(updateMovement);
    return;
  }

  const now = Date.now();
  const dt = Math.min(0.05, (now - lastMoveTime) / 1000 || 0.016);
  lastMoveTime = now;

  let dx = 0, dy = 0;
  if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    const speed = PLAYER_SPEED_PIXELS_PER_SECOND;
    localX = Math.max(PLAYER_RADIUS_PIXELS, Math.min(CANVAS_PIXELS.width - PLAYER_RADIUS_PIXELS, localX + dx * speed * dt));
    localY = Math.max(PLAYER_RADIUS_PIXELS, Math.min(CANVAS_PIXELS.height - PLAYER_RADIUS_PIXELS, localY + dy * speed * dt));

    me.x = localX;
    me.y = localY;
    if (!renderedPlayers[myId]) renderedPlayers[myId] = { x: localX, y: localY };
    renderedPlayers[myId].x = localX;
    renderedPlayers[myId].y = localY;
    targetPlayers[myId] = { x: localX, y: localY };

    if (now - lastMoveEmit >= MOVE_EMIT_INTERVAL) {
      lastMoveEmit = now;
      socket.emit('movement', { x: localX, y: localY });
    }
  } else {
    const serverX = me.x;
    const serverY = me.y;
    if (Math.abs(localX - serverX) > 2 || Math.abs(localY - serverY) > 2) {
      localX += (serverX - localX) * 0.1;
      localY += (serverY - localY) * 0.1;
      me.x = localX;
      me.y = localY;
      renderedPlayers[myId].x = localX;
      renderedPlayers[myId].y = localY;
      targetPlayers[myId] = { x: localX, y: localY };
    }
  }

  requestAnimationFrame(updateMovement);
}

requestAnimationFrame(updateMovement);

function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

function pickTargetAt(x, y) {
  let best = null;
  let bestDistance = Infinity;
  if (!state || !state.players) return null;
  Object.values(state.players).forEach(p => {
    if (p.id === myId) return;
    const rp = renderedPlayers[p.id] || p;
    const dx = x - rp.x;
    const dy = y - rp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < metersToPixels(3) && dist < bestDistance) {
      best = p.id;
      bestDistance = dist;
    }
  });
  return best;
}

canvas.addEventListener('mousemove', e => {
  if (!state) return;
  mousePos = getMousePos(e);
  const hovered = pickTargetAt(mousePos.x, mousePos.y);
  canvas.style.cursor = hovered ? 'pointer' : 'crosshair';
});

canvas.addEventListener('click', e => {
  if (!state) return;
  mousePos = getMousePos(e);
  logSystem('canvas click', { phase: state.phase, myRole: state.myRole, mousePos });

  if ((state.phase === 'night' || (state.phase === 'masquerade' && state.myRole === 'thief' && !state.myStolenThisRound)) && state.myRole === 'thief') {
    for (const r of state.rooms) {
      const dx = mousePos.x - r.x;
      const dy = mousePos.y - r.y;
      if (Math.sqrt(dx * dx + dy * dy) < r.r) {
        selectedTargetId = r.id;
        logSystem('thiefSelectRelic click', { relicId: r.id });
        socket.emit('thiefSelectRelic', { relicId: r.id });
        updateGameUI();
        return;
      }
    }
  }

  const picked = pickTargetAt(mousePos.x, mousePos.y);
  if (picked) {
    selectedTargetId = picked;
    logSystem('player selected', { selectedTargetId });
    updateGameUI();
  } else {
    logSystem('player selected: none under cursor', { mousePos });
  }
});

acceptMask.addEventListener('click', () => {
  socket.emit('respondMask', { accept: true });
});

declineMask.addEventListener('click', () => {
  socket.emit('respondMask', { accept: false });
});

setInterval(() => {
  if (state && state.phase !== 'lobby') {
    updateGameUI();
  }
}, 1000);
