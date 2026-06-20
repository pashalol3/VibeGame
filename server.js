const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ==================== GAME CONFIG ====================
const METERS_PER_PIXEL = 0.05; // 1 px = 5 cm; 20 px = 1 meter
const CANVAS_METERS = { width: 50, height: 35 }; // 1000px x 700px
const CANVAS_PIXELS = {
  width: Math.round(CANVAS_METERS.width / METERS_PER_PIXEL),
  height: Math.round(CANVAS_METERS.height / METERS_PER_PIXEL)
};

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const MAX_ROUNDS = 5;
const RELICS_TO_WIN = 3;
const STEAL_TIME = process.env.STEAL_TIME ? parseInt(process.env.STEAL_TIME) : 15; // seconds
const NIGHT_TIME = process.env.NIGHT_TIME ? parseInt(process.env.NIGHT_TIME) : 60;
const MASQUERADE_TIME = process.env.MASQUERADE_TIME ? parseInt(process.env.MASQUERADE_TIME) : 180;
const ACCUSATION_TIME = process.env.ACCUSATION_TIME ? parseInt(process.env.ACCUSATION_TIME) : 90;
const RESULT_TIME = process.env.RESULT_TIME ? parseInt(process.env.RESULT_TIME) : 30;
const SURVEILLANCE_TIME = 30;

const VISION_RADIUS_METERS = 7; // visibility radius in meters
const VISION_RADIUS_PIXELS = VISION_RADIUS_METERS / METERS_PER_PIXEL;

const OBSTACLE_COUNT = 10;
const OBSTACLE_RADIUS_METERS = 1.2;
const OBSTACLE_RADIUS_PIXELS = OBSTACLE_RADIUS_METERS / METERS_PER_PIXEL;

const ROOM_MIN_DISTANCE_METERS = 12;
const ROOM_MIN_DISTANCE_PIXELS = ROOM_MIN_DISTANCE_METERS / METERS_PER_PIXEL;

const ROOM_DATA = [
  { id: 0, name: 'Зал', rMeters: 5.5, color: '#8B5A2B', relic: 'Корона', relicColor: '#FFD700' },
  { id: 1, name: 'Библиотека', rMeters: 4.5, color: '#5D4037', relic: 'Древний фолиант', relicColor: '#A0522D' },
  { id: 2, name: 'Столовая', rMeters: 4.5, color: '#795548', relic: 'Золотая чаша', relicColor: '#FFA500' },
  { id: 3, name: 'Сад', rMeters: 4.5, color: '#2E7D32', relic: 'Изумрудная статуэтка', relicColor: '#00FF7F' },
  { id: 4, name: 'Хранилище', rMeters: 4.5, color: '#455A64', relic: 'Серебряный ключ', relicColor: '#C0C0C0' }
];

const PLAYER_RADIUS_METERS = 0.8;
const PLAYER_RADIUS_PIXELS = PLAYER_RADIUS_METERS / METERS_PER_PIXEL;
const PLAYER_SPEED_METERS_PER_SECOND = 9; // m/s
const PLAYER_SPEED_PIXELS_PER_SECOND = PLAYER_SPEED_METERS_PER_SECOND / METERS_PER_PIXEL;

// ==================== STATE ====================
const rooms = {}; // roomId -> gameRoom state
const socketToRoom = {};

function createRoomState(roomId, hostId) {
  return {
    id: roomId,
    hostId,
    phase: 'lobby',
    phaseEndTime: null,
    round: 1,
    players: {},
    messages: [],
    currentRound: 1,
    rooms: [],
    obstacles: [],
    stolenRelics: [],
    butlerTarget: null,
    surveillance: { targetId: null, endTime: null },
    surveillanceUsedThisRound: new Set(),
    accusation: null,
    maskOffer: null,
    lastArrestResult: null,
    lastTheftResult: null,
    gameOver: null,
    timers: {},
    officialArrestUsed: false,
    nextRoundNoVote: new Set(),
    penaltyRound: {},
    lastStealEmit: 0
  };
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function metersToPixels(m) {
  return m / METERS_PER_PIXEL;
}

function pixelsToMeters(px) {
  return px * METERS_PER_PIXEL;
}

function assignRoles(playerIds) {
  const n = playerIds.length;
  const detectiveCount = n >= 8 ? 2 : 1;
  const thiefCount = n >= 8 ? 2 : 1;
  const roles = [];
  for (let i = 0; i < detectiveCount; i++) roles.push('detective');
  for (let i = 0; i < thiefCount; i++) roles.push('thief');
  roles.push('butler');
  roles.push('impostor');
  while (roles.length < n) roles.push('guest');
  shuffle(roles);

  const assignment = {};
  playerIds.forEach((id, idx) => {
    assignment[id] = roles[idx];
  });
  return assignment;
}

function generateRooms() {
  const rooms = [];
  const shuffled = shuffle([...ROOM_DATA]);
  const margin = metersToPixels(4);
  const w = CANVAS_PIXELS.width - margin * 2;
  const h = CANVAS_PIXELS.height - margin * 2;

  for (let i = 0; i < shuffled.length; i++) {
    const data = shuffled[i];
    let x, y, attempts = 0;
    do {
      x = margin + Math.random() * w;
      y = margin + Math.random() * h;
      attempts++;
    } while (attempts < 200 && rooms.some(r => {
      const dx = r.x - x;
      const dy = r.y - y;
      return Math.sqrt(dx * dx + dy * dy) < ROOM_MIN_DISTANCE_PIXELS;
    }));
    rooms.push({
      ...data,
      x,
      y,
      r: metersToPixels(data.rMeters)
    });
  }
  return rooms;
}

function generateObstacles(rooms) {
  const obstacles = [];
  const margin = metersToPixels(3);
  const w = CANVAS_PIXELS.width - margin * 2;
  const h = CANVAS_PIXELS.height - margin * 2;

  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    let x, y, attempts = 0;
    do {
      x = margin + Math.random() * w;
      y = margin + Math.random() * h;
      attempts++;
    } while (attempts < 200 && (
      rooms.some(r => {
        const dx = r.x - x;
        const dy = r.y - y;
        return Math.sqrt(dx * dx + dy * dy) < r.r + OBSTACLE_RADIUS_PIXELS + metersToPixels(2);
      }) ||
      obstacles.some(o => {
        const dx = o.x - x;
        const dy = o.y - y;
        return Math.sqrt(dx * dx + dy * dy) < OBSTACLE_RADIUS_PIXELS * 2 + metersToPixels(1);
      })
    ));
    obstacles.push({ x, y, r: OBSTACLE_RADIUS_PIXELS, type: Math.floor(Math.random() * 3) });
  }
  return obstacles;
}

function resetPlayerPositions(room) {
  const ids = Object.keys(room.players);
  ids.forEach((id, i) => {
    const angle = (i / ids.length) * Math.PI * 2;
    room.players[id].x = CANVAS_PIXELS.width / 2 + Math.cos(angle) * metersToPixels(3);
    room.players[id].y = CANVAS_PIXELS.height / 2 + Math.sin(angle) * metersToPixels(3);
  });
}

function getRoomNameByPosition(x, y, rooms) {
  for (const r of rooms) {
    const dx = x - r.x;
    const dy = y - r.y;
    if (Math.sqrt(dx * dx + dy * dy) < r.r) return r.id;
  }
  return null;
}

function isObstacleCollision(x, y, obstacles, radius = PLAYER_RADIUS_PIXELS) {
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < o.r + radius) return true;
  }
  return false;
}

function resolveObstacleCollision(x, y, obstacles, radius = PLAYER_RADIUS_PIXELS) {
  let nx = x;
  let ny = y;
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = o.r + radius;
    if (dist < minDist && dist > 0) {
      const ratio = minDist / dist;
      nx = o.x + dx * ratio;
      ny = o.y + dy * ratio;
    }
  }
  return { x: nx, y: ny };
}

function emitState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const now = Date.now();
  const remaining = Math.max(0, Math.ceil((room.phaseEndTime - now) / 1000));

  const publicState = {
    phase: room.phase,
    phaseEndTime: room.phaseEndTime,
    remainingTime: remaining,
    round: room.currentRound,
    maxRounds: MAX_ROUNDS,
    hostId: room.hostId,
    players: {},
    rooms: room.rooms,
    obstacles: room.obstacles,
    messages: room.messages.slice(-50),
    accusation: room.accusation ? {
      accuserId: room.accusation.accuserId,
      targetId: room.accusation.targetId,
      votes: room.accusation.votes,
      closed: room.accusation.closed,
      result: room.accusation.result
    } : null,
    maskOffer: room.maskOffer,
    surveillance: room.surveillance,
    stolenRelics: room.stolenRelics,
    lastArrestResult: room.lastArrestResult,
    lastTheftResult: room.lastTheftResult,
    gameOver: room.gameOver,
    officialArrestUsed: room.officialArrestUsed,
    nextRoundNoVote: Array.from(room.nextRoundNoVote),
    visionRadius: VISION_RADIUS_PIXELS,
    myId: null,
    myRole: null,
    myOriginalRole: null,
    myStealProgress: 0,
    myStolenThisRound: false
  };

  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    publicState.players[id] = {
      id,
      name: p.name,
      x: p.x,
      y: p.y,
      color: p.color,
      role: room.gameOver ? p.currentRole : (room.phase === 'lobby' ? null : 'hidden'),
      roomId: getRoomNameByPosition(p.x, p.y, room.rooms),
      canVote: !room.nextRoundNoVote.has(id),
      connected: p.connected,
      host: room.hostId === id
    };
  }

  for (const id of Object.keys(room.players)) {
    const socketId = room.players[id].socketId;
    const personal = {
      ...publicState,
      myId: id,
      myOriginalRole: room.players[id].role,
      myRole: room.players[id].currentRole,
      myStealProgress: room.players[id].stealProgress,
      myStolenThisRound: room.players[id].stolenThisRound
    };
    io.to(socketId).emit('state', personal);
  }
}

function addMessage(room, text, type = 'info') {
  room.messages.push({ text, type, time: Date.now() });
  if (room.messages.length > 100) room.messages.shift();
}

function startPhase(roomId, phaseName) {
  const room = rooms[roomId];
  if (!room) return;

  room.phase = phaseName;
  room.surveillance = { targetId: null, endTime: null };
  room.accusation = null;
  room.maskOffer = null;
  room.lastArrestResult = null;
  room.lastTheftResult = null;

  Object.values(room.timers).forEach(t => clearTimeout(t));
  room.timers = {};

  if (phaseName === 'night') {
    room.butlerTarget = null;
    resetPlayerPositions(room);
    resetThiefTimers(room);
    addMessage(room, `=== Ночь раунда ${room.currentRound}. Воры и Дворецкий делают выбор ===`, 'phase');
    notifyThieves(room);
    notifyButlers(room);
    room.phaseEndTime = Date.now() + NIGHT_TIME * 1000;
    room.timers.phase = setTimeout(() => startPhase(roomId, 'masquerade'), NIGHT_TIME * 1000);
  } else if (phaseName === 'masquerade') {
    room.surveillanceUsedThisRound.clear();
    addMessage(room, `=== Маскарад раунда ${room.currentRound}. Свободное передвижение ===`, 'phase');
    room.phaseEndTime = Date.now() + MASQUERADE_TIME * 1000;
    room.timers.phase = setTimeout(() => startPhase(roomId, 'accusation'), MASQUERADE_TIME * 1000);
  } else if (phaseName === 'accusation') {
    addMessage(room, `=== Обвинение раунда ${room.currentRound} ===`, 'phase');
    room.phaseEndTime = Date.now() + ACCUSATION_TIME * 1000;
    room.timers.phase = setTimeout(() => resolveRound(roomId), ACCUSATION_TIME * 1000);
  } else if (phaseName === 'result') {
    room.phaseEndTime = Date.now() + RESULT_TIME * 1000;
    room.timers.phase = setTimeout(() => nextRound(roomId), RESULT_TIME * 1000);
  }

  emitState(roomId);
}

function notifyThieves(room) {
  for (const id of Object.keys(room.players)) {
    if (room.players[id].currentRole === 'thief') {
      io.to(id).emit('notify', '🌙 Выберите реликвию для кражи (клик по комнате или по списку).');
    }
  }
}

function notifyButlers(room) {
  for (const id of Object.keys(room.players)) {
    if (room.players[id].currentRole === 'butler') {
      io.to(id).emit('notify', '🌙 Выберите игрока для проверки (клик по имени).');
    }
  }
}

function nextRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.currentRound++;
  for (const id of Array.from(room.nextRoundNoVote)) {
    if (room.penaltyRound[id] <= room.currentRound - 2) {
      room.nextRoundNoVote.delete(id);
      delete room.penaltyRound[id];
    }
  }
  if (room.currentRound > MAX_ROUNDS) {
    endGame(roomId, 'thieves', 'Прошли все 5 раундов, Вор не раскрыт. Победа Воров!');
    return;
  }
  startPhase(roomId, 'night');
}

function endGame(roomId, winner, reason) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameOver = { winner, reason };
  room.phase = 'ended';
  room.phaseEndTime = null;
  Object.values(room.timers).forEach(t => clearTimeout(t));
  room.timers = {};
  addMessage(room, `ИГРА ОКОНЧЕНА: ${reason}`, 'win');
  emitState(roomId);
}

function resolveRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.accusation && !room.accusation.closed) {
    resolveVoteIfNeeded(room, true);
  }

  const thieves = Object.values(room.players).filter(p => p.currentRole === 'thief');
  let stolenThisRound = false;
  for (const t of thieves) {
    if (t.stolenThisRound && t.thiefTarget !== null && t.thiefTarget !== undefined && !room.stolenRelics.includes(t.thiefTarget)) {
      room.stolenRelics.push(t.thiefTarget);
      stolenThisRound = true;
    }
  }

  if (stolenThisRound) {
    addMessage(room, `Реликвия украдена! Украдено ${room.stolenRelics.length}/${RELICS_TO_WIN}`, 'theft');
    room.lastTheftResult = { success: true, count: room.stolenRelics.length };
  } else {
    room.lastTheftResult = { success: false };
  }

  if (room.stolenRelics.length >= RELICS_TO_WIN) {
    endGame(roomId, 'thieves', 'Воры украли 3 реликвии! Победа Воров!');
    return;
  }

  room.phase = 'result';
  room.phaseEndTime = Date.now() + RESULT_TIME * 1000;
  Object.values(room.timers).forEach(t => clearTimeout(t));
  room.timers = {};
  room.timers.phase = setTimeout(() => nextRound(roomId), RESULT_TIME * 1000);
  emitState(roomId);
}

function resetThiefTimers(room) {
  Object.values(room.players).forEach(p => {
    p.stolenThisRound = false;
    p.stealProgress = 0;
    p.stealStartTime = null;
    p.thiefTarget = null;
  });
}

function resolveVoteIfNeeded(room, isTimeout = false) {
  if (!room.accusation || room.accusation.closed) return;

  const eligible = Object.keys(room.players).filter(
    id => !room.nextRoundNoVote.has(id) && id !== room.accusation.accuserId && id !== room.accusation.targetId
  );
  const eligibleCount = eligible.length;
  const votes = Object.values(room.accusation.votes);
  const yes = votes.filter(v => v === 'yes').length;
  const no = votes.filter(v => v === 'no').length;
  const allVoted = votes.length >= eligibleCount;
  const yesMajority = eligibleCount > 0 && yes > eligibleCount / 2;
  const noMajority = eligibleCount > 0 && no > eligibleCount / 2;

  console.log('resolveVoteIfNeeded', {
    isTimeout,
    eligible: eligibleCount,
    voted: votes.length,
    yes,
    no,
    yesMajority,
    noMajority,
    allVoted
  });

  if (yesMajority) {
    const target = room.players[room.accusation.targetId];
    const accuser = room.players[room.accusation.accuserId];
    room.accusation.closed = true;
    room.accusation.result = { revealed: true, role: target.currentRole, targetName: target.name };
    addMessage(room, `Карточка ${target.name} вскрыта! Роль: ${roleToRussian(target.currentRole)}`, 'reveal');
    if (target.currentRole === 'thief') {
      room.lastArrestResult = { targetId: target.id, targetName: target.name, targetRole: 'thief' };
      endGame(room.id, 'detectives', `Вор (${target.name}) разоблачён голосованием. Победа Детективов!`);
    } else {
      room.nextRoundNoVote.add(accuser.id);
      room.penaltyRound[accuser.id] = room.currentRound;
      addMessage(room, `${accuser.name} ошибся и теряет голос в следующем раунде.`, 'penalty');
      room.accusation.result = { revealed: true, role: target.currentRole, targetName: target.name, wrong: true };
      endGame(room.id, 'thieves', `Невиновный ${target.name} разоблачён. Победа Воров!`);
    }
  } else if (noMajority) {
    const accuser = room.players[room.accusation.accuserId];
    room.accusation.closed = true;
    room.accusation.result = { revealed: false };
    addMessage(room, `Голоса против. Обвинение ${accuser ? accuser.name : ''} не прошло.`, 'penalty');
    emitState(room.id);
  } else if (isTimeout || allVoted) {
    room.accusation.closed = true;
    room.accusation.result = { revealed: false, timeout: true };
    addMessage(room, 'Голосование не набрало большинства.', 'info');
    emitState(room.id);
  }
}

function roleToRussian(role) {
  const map = {
    detective: 'Детектив',
    thief: 'Вор',
    butler: 'Дворецкий',
    impostor: 'Самозванец',
    guest: 'Гость'
  };
  return map[role] || role;
}

// Game loop: check steal progress and surveillance
setInterval(() => {
  const now = Date.now();
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (room.phase !== 'masquerade' || room.gameOver) continue;

    let stateDirty = false;
    for (const id of Object.keys(room.players)) {
      const p = room.players[id];
      if (p.currentRole !== 'thief' || p.stolenThisRound) continue;
      if (p.thiefTarget === null || p.thiefTarget === undefined) continue;
      if (room.stolenRelics.includes(p.thiefTarget)) continue;

      const roomPos = room.rooms.find(r => r.id === p.thiefTarget);
      if (!roomPos) continue;

      const inRoom = Math.sqrt(Math.pow(p.x - roomPos.x, 2) + Math.pow(p.y - roomPos.y, 2)) < roomPos.r;
      const othersInRoom = Object.values(room.players).some(
        other => other.id !== id && other.connected && Math.sqrt(Math.pow(other.x - roomPos.x, 2) + Math.pow(other.y - roomPos.y, 2)) < roomPos.r
      );

      if (inRoom && !othersInRoom) {
        const prevProgress = p.stealProgress || 0;
        if (!p.stealStartTime) {
          p.stealStartTime = now;
        }
        p.stealProgress = Math.min(STEAL_TIME, (now - p.stealStartTime) / 1000);
        if (Math.abs(p.stealProgress - prevProgress) >= 0.05) {
          stateDirty = true;
        }
        if (p.stealProgress >= STEAL_TIME) {
          p.stolenThisRound = true;
          p.stealProgress = 0;
          p.stealStartTime = null;
          addMessage(room, `💎 Реликвия "${roomPos.relic}" украдена!`, 'theft');
          stateDirty = true;
        }
      } else {
        if (p.stealProgress > 0 || p.stealStartTime) {
          p.stealProgress = 0;
          p.stealStartTime = null;
          stateDirty = true;
        }
      }
    }

    if (stateDirty && (!room.lastStealEmit || now - room.lastStealEmit >= 100)) {
      room.lastStealEmit = now;
      emitState(roomId);
    }
  }
}, 100);

server.listen(PORT, () => {
  console.log(`Маскарад сервер запущен на http://localhost:${PORT}`);
});

io.on('connection', socket => {
  socket.on('joinRoom', ({ roomId, name }, cb) => {
    if (!roomId || !name) return cb({ error: 'Нужно имя и комната' });
    roomId = roomId.trim().toUpperCase();
    name = name.trim().slice(0, 20);
    if (!/^[A-Z0-9]{3,8}$/.test(roomId)) return cb({ error: 'Код комнаты: 3-8 латинских букв/цифр' });

    if (!rooms[roomId]) {
      rooms[roomId] = createRoomState(roomId, socket.id);
    }
    const room = rooms[roomId];
    if (room.phase !== 'lobby') return cb({ error: 'Игра уже идёт' });
    if (Object.keys(room.players).length >= MAX_PLAYERS) return cb({ error: 'Комната заполнена' });

    const colors = ['#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0', '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A'];
    const player = {
      id: socket.id,
      socketId: socket.id,
      name,
      role: null,
      currentRole: null,
      x: CANVAS_PIXELS.width / 2,
      y: CANVAS_PIXELS.height / 2,
      color: colors[Object.keys(room.players).length % colors.length],
      connected: true,
      stealProgress: 0,
      stealStartTime: null,
      stolenThisRound: false,
      lastMoveTime: 0,
      canOfferMask: true
    };
    room.players[socket.id] = player;
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);
    addMessage(room, `${name} присоединился`, 'join');
    emitState(roomId);
    cb({ success: true, roomId });
  });

  socket.on('startGame', () => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase !== 'lobby') return;
    const count = Object.keys(room.players).length;
    if (count < MIN_PLAYERS) {
      socket.emit('errorMessage', `Нужно минимум ${MIN_PLAYERS} игроков`);
      return;
    }

    const roles = assignRoles(Object.keys(room.players));
    for (const id of Object.keys(roles)) {
      room.players[id].role = roles[id];
      room.players[id].currentRole = roles[id];
    }

    room.rooms = generateRooms();
    room.obstacles = generateObstacles(room.rooms);

    resetPlayerPositions(room);
    resetThiefTimers(room);
    room.currentRound = 1;
    room.stolenRelics = [];
    room.nextRoundNoVote.clear();
    room.penaltyRound = {};
    room.officialArrestUsed = false;
    room.gameOver = null;

    for (const id of Object.keys(room.players)) {
      const roleName = roleToRussian(room.players[id].role);
      io.to(id).emit('roleInfo', { role: room.players[id].role, text: `Ваша роль: ${roleName}` });
    }

    startPhase(roomId, 'night');
  });

  socket.on('thiefSelectRelic', ({ relicId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || (room.phase !== 'night' && room.phase !== 'masquerade')) return;
    const p = room.players[socket.id];
    if (!p || p.currentRole !== 'thief') return;
    if (room.stolenRelics.includes(relicId)) {
      socket.emit('errorMessage', 'Эта реликвия уже украдена');
      return;
    }
    if (p.stolenThisRound) {
      socket.emit('errorMessage', 'Вы уже украли реликвию в этом раунде');
      return;
    }
    if (room.phase === 'masquerade' && p.thiefTarget !== null && p.thiefTarget !== undefined) {
      socket.emit('errorMessage', 'Цель для кражи уже выбрана в этом раунде');
      return;
    }
    p.thiefTarget = relicId;
    io.to(socket.id).emit('notify', `✅ Вы выбрали цель: ${room.rooms.find(r => r.id === relicId)?.relic || '???'}. Ждите фазы Маскарад.`);
    emitState(roomId);
  });

  socket.on('butlerSelectPlayer', ({ targetId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'night') return;
    const player = room.players[socket.id];
    if (!player || player.currentRole !== 'butler') return;
    if (!room.players[targetId]) return;
    room.butlerTarget = targetId;
    const target = room.players[targetId];
    addMessage(room, `🦉 Дворецкий узнал роль ${target.name}: ${roleToRussian(target.currentRole)}`, 'reveal');
    io.to(socket.id).emit('notify', `🦉 Вы узнали роль ${target.name}: ${roleToRussian(target.currentRole)}. Игроки этого не видят.`);
    emitState(roomId);
  });

  socket.on('movement', ({ x, y }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'masquerade') return;
    const player = room.players[socket.id];
    if (!player || room.gameOver) return;

    let nx = Math.max(PLAYER_RADIUS_PIXELS, Math.min(CANVAS_PIXELS.width - PLAYER_RADIUS_PIXELS, x));
    let ny = Math.max(PLAYER_RADIUS_PIXELS, Math.min(CANVAS_PIXELS.height - PLAYER_RADIUS_PIXELS, y));

    if (isObstacleCollision(nx, ny, room.obstacles, PLAYER_RADIUS_PIXELS)) {
      const resolved = resolveObstacleCollision(nx, ny, room.obstacles, PLAYER_RADIUS_PIXELS);
      nx = resolved.x;
      ny = resolved.y;
    }

    player.x = nx;
    player.y = ny;

    const now = Date.now();
    if (!player.lastEmitTime || now - player.lastEmitTime >= 30) {
      player.lastEmitTime = now;
      emitState(roomId);
    }
  });

  socket.on('surveillance', ({ targetId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'masquerade') return;
    const player = room.players[socket.id];
    if (!player || player.currentRole !== 'detective') return;
    if (!room.players[targetId]) return;
    if (room.surveillanceUsedThisRound.has(socket.id)) return;
    room.surveillanceUsedThisRound.add(socket.id);
    room.surveillance = { targetId, endTime: Date.now() + SURVEILLANCE_TIME * 1000 };
    addMessage(room, `🔍 Детектив ${player.name} объявил слежку за ${room.players[targetId].name}!`, 'action');
    room.timers.surveillance = setTimeout(() => {
      room.surveillance = { targetId: null, endTime: null };
      emitState(roomId);
    }, SURVEILLANCE_TIME * 1000);
    emitState(roomId);
  });

  socket.on('offerMask', ({ targetId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'masquerade') return;
    const from = room.players[socket.id];
    const to = room.players[targetId];
    if (!from || !to) return;
    if (room.maskOffer) return;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > metersToPixels(10)) {
      socket.emit('errorMessage', 'Подойдите ближе для обмена масками');
      return;
    }
    room.maskOffer = { fromId: socket.id, toId: targetId, fromName: from.name };
    addMessage(room, `${from.name} предложил обмен масками ${to.name}`, 'action');
    emitState(roomId);
  });

  socket.on('respondMask', ({ accept }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'masquerade' || !room.maskOffer) return;
    if (room.maskOffer.toId !== socket.id) return;
    const from = room.players[room.maskOffer.fromId];
    const to = room.players[room.maskOffer.toId];
    if (!from || !to) return;
    if (accept) {
      const fromWasThief = from.currentRole === 'thief';
      const toWasThief = to.currentRole === 'thief';
      const fromThiefState = {
        thiefTarget: from.thiefTarget,
        stealProgress: from.stealProgress,
        stealStartTime: from.stealStartTime,
        stolenThisRound: from.stolenThisRound
      };
      const toThiefState = {
        thiefTarget: to.thiefTarget,
        stealProgress: to.stealProgress,
        stealStartTime: to.stealStartTime,
        stolenThisRound: to.stolenThisRound
      };

      const temp = from.currentRole;
      from.currentRole = to.currentRole;
      to.currentRole = temp;

      if (fromWasThief && to.currentRole === 'thief') {
        to.thiefTarget = fromThiefState.thiefTarget;
        to.stealProgress = fromThiefState.stealProgress;
        to.stealStartTime = fromThiefState.stealStartTime;
        to.stolenThisRound = fromThiefState.stolenThisRound;
        from.thiefTarget = null;
        from.stealProgress = 0;
        from.stealStartTime = null;
        from.stolenThisRound = false;
      } else if (toWasThief && from.currentRole === 'thief') {
        from.thiefTarget = toThiefState.thiefTarget;
        from.stealProgress = toThiefState.stealProgress;
        from.stealStartTime = toThiefState.stealStartTime;
        from.stolenThisRound = toThiefState.stolenThisRound;
        to.thiefTarget = null;
        to.stealProgress = 0;
        to.stealStartTime = null;
        to.stolenThisRound = false;
      }

      addMessage(room, `✅ ${from.name} и ${to.name} обменялись масками!`, 'action');
      io.to(from.id).emit('notify', `Вы теперь ${roleToRussian(from.currentRole)}`);
      io.to(to.id).emit('notify', `Вы теперь ${roleToRussian(to.currentRole)}`);
    } else {
      addMessage(room, `❌ ${to.name} отказался меняться масками с ${from.name}`, 'action');
    }
    room.maskOffer = null;
    emitState(roomId);
  });

  socket.on('accuse', ({ targetId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'accusation') return;
    if (room.accusation && room.accusation.closed) return;
    if (room.accusation) return;
    const accuser = room.players[socket.id];
    const target = room.players[targetId];
    if (!accuser || !target) return;
    if (room.nextRoundNoVote.has(socket.id)) return;

    room.accusation = {
      accuserId: socket.id,
      targetId,
      votes: {},
      closed: false,
      result: null
    };
    addMessage(room, `⚖️ ${accuser.name} обвиняет ${target.name} в том, что он Вор!`, 'action');
    emitState(roomId);
  });

  socket.on('vote', ({ vote }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'accusation' || !room.accusation || room.accusation.closed) return;
    if (room.nextRoundNoVote.has(socket.id)) return;
    if (socket.id === room.accusation.accuserId || socket.id === room.accusation.targetId) return;
    room.accusation.votes[socket.id] = vote;
    resolveVoteIfNeeded(room);
    emitState(roomId);
  });

  socket.on('officialArrest', ({ targetId }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.phase !== 'accusation') return;
    const detective = room.players[socket.id];
    if (!detective || detective.currentRole !== 'detective') return;
    if (room.officialArrestUsed) return;
    const target = room.players[targetId];
    if (!target) return;

    room.officialArrestUsed = true;
    addMessage(room, `🚨 Официальный арест от ${detective.name}! Арестован ${target.name}`, 'action');
    room.lastArrestResult = { official: true, targetId, targetName: target.name, targetRole: target.currentRole };
    emitState(roomId);

    if (target.currentRole === 'thief') {
      endGame(roomId, 'detectives', `Детектив арестовал Вора (${target.name}). Победа Детективов!`);
    } else {
      endGame(roomId, 'thieves', `Детектив ошибся и арестовал невиновного (${target.name}). Победа Воров!`);
    }
  });

  socket.on('chat', ({ text }) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return;
    addMessage(room, `${p.name}: ${text.slice(0, 200)}`, 'chat');
    emitState(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
      room.players[socket.id].connected = false;
      addMessage(room, `${room.players[socket.id].name} отключился`, 'leave');
      emitState(roomId);
      if (room.phase === 'lobby') {
        delete room.players[socket.id];
      }
      if (Object.keys(room.players).length === 0) {
        Object.values(room.timers).forEach(t => clearTimeout(t));
        delete rooms[roomId];
      }
    }
    delete socketToRoom[socket.id];
  });
});
