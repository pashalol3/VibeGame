const socket = io();

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

// ==================== STATE ====================
let state = null;
let myId = null;
let keys = {};
let selectedTargetId = null;
let mousePos = { x: 0, y: 0 };
let lastMoveTime = 0;
let lastMoveEmit = 0;
const MOVE_EMIT_INTERVAL = 50; // ms
const renderedPlayers = {}; // { id: { x, y } }
const targetPlayers = {}; // { id: { x, y } }

const phaseNames = {
  lobby: 'Лобби',
  night: 'Ночь',
  masquerade: 'Маскарад',
  accusation: 'Обвинение',
  result: 'Итог',
  ended: 'Игра окончена'
};

const systemLog = [];
const systemLogEl = document.getElementById('systemLog');
const copyLogBtn = document.getElementById('copyLogBtn');

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
  logSystem('state received', { phase: newState.phase, myId: newState.myId, myRole: newState.myRole, maskOffer: newState.maskOffer, players: Object.keys(newState.players).length });
  // Reset target selection when phase changes to avoid using room id as player id
  if (state && state.phase !== newState.phase) {
    selectedTargetId = null;
  }
  state = newState;
  myId = newState.myId;
  updateRenderedTargets(newState.players);
  updateLobby();
  if (state.phase !== 'lobby') {
    showGameScreen();
    updateGameUI();
    requestAnimationFrame(render);
  }
});

socket.on('publicState', newState => {
  // Fallback if personal state not received
  if (!state || state.phase === 'lobby') {
    state = newState;
    // Ensure myId at least from newState if present; otherwise keep existing.
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
  console.log('Lobby update:', { myId, hostId: state.hostId, playerCount: players.length, isHost });

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

  // Player list
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

  // Relic list
  relicList.innerHTML = '';
  state.rooms.forEach(r => {
    const li = document.createElement('li');
    const stolen = state.stolenRelics.includes(r.id);
    li.textContent = `${r.relic} (${r.name}) ${stolen ? '✓ Украдена' : ''}`;
    li.style.color = stolen ? '#00ff7f' : '#fff';
    relicList.appendChild(li);
  });

  // Action buttons
  actionButtons.innerHTML = '';
  renderActionButtons();

  // Messages
  chatMessages.innerHTML = '';
  state.messages.forEach(m => addChatMessage(m.text, m.type, false));
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Game over
  if (state.gameOver && gameOverModal.classList.contains('hidden')) {
    gameOverTitle.textContent = state.gameOver.winner === 'detectives' ? 'Победа Детективов!' : 'Победа Воров!';
    gameOverText.textContent = state.gameOver.reason;
    gameOverModal.classList.remove('hidden');
  }

  // Mask offer
  if (state.maskOffer && state.maskOffer.toId === myId) {
    const from = state.players[state.maskOffer.fromId];
    offerText.textContent = `${from ? from.name : 'Игрок'} предлагает обменяться масками.`;
    console.log('showing offer modal', state.maskOffer);
    offerModal.classList.remove('hidden');
  } else {
    if (!offerModal.classList.contains('hidden')) {
      console.log('hiding offer modal', state.maskOffer);
    }
    offerModal.classList.add('hidden');
  }
}

function renderActionButtons() {
  if (!state || !myId) return;
  actionButtons.innerHTML = '';
  const me = state.players[myId];
  if (!me) return;

  // Night phase actions
  if (state.phase === 'night') {
    if (state.myRole === 'thief') {
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

  // Masquerade actions
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

  // Accusation actions
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

function addChatMessage(text, type = 'info', append = true) {
  const div = document.createElement('div');
  div.className = `msg-${type}`;
  div.textContent = text;
  if (append) {
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else {
    chatMessages.appendChild(div);
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
function render() {
  if (!state) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw connections between rooms
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 8;
  const center = state.rooms[0];
  for (let i = 1; i < state.rooms.length; i++) {
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(state.rooms[i].x, state.rooms[i].y);
    ctx.stroke();
  }

  // Draw rooms
  state.rooms.forEach(r => {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.fillStyle = r.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight surveillance target room
    if (state.surveillance && state.surveillance.targetId && state.surveillance.endTime > Date.now()) {
      const target = state.players[state.surveillance.targetId];
      if (target && target.roomId === r.id) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }

    // Room name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.name, r.x, r.y - 30);

    // Relic
    const stolen = state.stolenRelics.includes(r.id);
    ctx.beginPath();
    ctx.arc(r.x, r.y + 10, 12, 0, Math.PI * 2);
    ctx.fillStyle = stolen ? '#555' : r.relicColor;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

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

  // Draw players using rendered (smoothed) positions
  Object.values(state.players).forEach(p => {
    if (!p.connected) return;
    const rp = renderedPlayers[p.id];
    if (!rp) return;
    const px = rp.x;
    const py = rp.y;

    ctx.beginPath();
    ctx.arc(px, py, 16, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    if (p.id === myId) {
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.strokeStyle = selectedTargetId === p.id ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = selectedTargetId === p.id ? 4 : 2;
    ctx.stroke();

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, px, py - 24);

    // Role (only self or if revealed)
    if (p.id === myId && state.myRole) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(roleNames[state.myRole], px, py + 28);
    }

    // Show my current room
    if (p.id === myId && p.roomId !== null) {
      ctx.fillStyle = '#aaa';
      ctx.font = '12px sans-serif';
      ctx.fillText(state.rooms[p.roomId].name, px, py + 42);
    }

    // Steal progress for self thief
    if (p.id === myId && state.myRole === 'thief' && state.myStealProgress > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px - 20, py + 34, 40, 6);
      ctx.fillStyle = '#00ff7f';
      ctx.fillRect(px - 20, py + 34, 40 * (state.myStealProgress / 15), 6);
    }
  });

  // Draw mouse hover target highlight using rendered position
  if (selectedTargetId && state.players[selectedTargetId] && renderedPlayers[selectedTargetId]) {
    const p = renderedPlayers[selectedTargetId];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  requestAnimationFrame(render);
}

// ==================== INPUT ====================
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === 'Enter' && document.activeElement === chatInput) {
    sendChat();
  }
});

window.addEventListener('keyup', e => {
  keys[e.key] = false;
});

function sendChat() {
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('chat', { text });
    chatInput.value = '';
  }
}

chatBtn.addEventListener('click', sendChat);

// Local authoritative position for smooth movement
let localX = 0;
let localY = 0;
let localPosInitialized = false;

function initLocalPos() {
  if (localPosInitialized || !state || !myId || !state.players[myId]) return;
  localX = state.players[myId].x;
  localY = state.players[myId].y;
  localPosInitialized = true;
}

// Movement loop
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
  if (keys['w'] || keys['W'] || keys['ArrowUp'] || keys['ц'] || keys['Ц']) dy -= 1;
  if (keys['s'] || keys['S'] || keys['ArrowDown'] || keys['ы'] || keys['Ы']) dy += 1;
  if (keys['a'] || keys['A'] || keys['ArrowLeft'] || keys['ф'] || keys['Ф']) dx -= 1;
  if (keys['d'] || keys['D'] || keys['ArrowRight'] || keys['в'] || keys['В']) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    const speed = 360;
    localX = Math.max(16, Math.min(1000 - 16, localX + dx * speed * dt));
    localY = Math.max(16, Math.min(700 - 16, localY + dy * speed * dt));

    // Update state for rendering & target interpolation
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
    // If we are standing still, gently sync local position towards server position
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

// Mouse interaction for selecting targets
function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  // If canvas is displayed at a different size than its internal resolution,
  // map CSS pixels to canvas coordinates.
  const cssWidth = rect.width;
  const cssHeight = rect.height;
  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
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
    // Use rendered position for click detection if available
    const rp = renderedPlayers[p.id] || p;
    const dx = x - rp.x;
    const dy = y - rp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 60 && dist < bestDistance) {
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

  // If night thief, click room to select relic
  if (state.phase === 'night' && state.myRole === 'thief') {
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

  // Select player target
  const picked = pickTargetAt(mousePos.x, mousePos.y);
  if (picked) {
    selectedTargetId = picked;
    logSystem('player selected', { selectedTargetId });
    updateGameUI();
  } else {
    logSystem('player selected: none under cursor', { mousePos });
  }
});

// Mask offer response
acceptMask.addEventListener('click', () => {
  socket.emit('respondMask', { accept: true });
});

declineMask.addEventListener('click', () => {
  socket.emit('respondMask', { accept: false });
});

// Periodic UI refresh for timer
setInterval(() => {
  if (state && state.phase !== 'lobby') {
    updateGameUI();
  }
}, 1000);
