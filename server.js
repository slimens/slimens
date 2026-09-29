const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*' }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadDir));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Файл не загружен' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, name: req.file.originalname });
});

app.get('/', (req, res) => res.send('Slimens Server Active!'));

// Файл истории
const HISTORY_FILE = path.join(__dirname, 'chat_history.json');
let chatHistory = [];

if (fs.existsSync(HISTORY_FILE)) {
  try {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    chatHistory = [];
  }
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2), 'utf8');
}

// 55 предустановленных аккаунтов (user1: pass1 ... user55: pass55)
const accounts = {};
for (let i = 1; i <= 55; i++) {
  accounts[`user${i}`] = `pass${i}`;
}

const activeSockets = {}; // { socketId: { nickname, room } }
const roomsList = new Set(['Общий чат']);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {

  socket.on('auth_user', ({ nickname, password }, callback) => {
    if (!callback) return;
    const cleanNick = nickname.trim().toLowerCase();

    if (!accounts[cleanNick]) {
      return callback({ 
        success: false, 
        message: 'Неверный логин! Допустимы логины от user1 до user55.' 
      });
    }

    if (accounts[cleanNick] !== password) {
      return callback({ success: false, message: 'Неверный пароль!' });
    }

    // Автоматически завершаем старое зависшее соединение этого пользователя
    for (const [sId, uData] of Object.entries(activeSockets)) {
      if (uData.nickname.toLowerCase() === cleanNick) {
        delete activeSockets[sId];
        const oldSocket = io.sockets.sockets.get(sId);
        if (oldSocket) oldSocket.disconnect(true);
      }
    }

    // Регистрируем новое соединение
    activeSockets[socket.id] = { nickname: cleanNick, room: null };

    callback({ 
      success: true, 
      rooms: Array.from(roomsList),
      history: chatHistory
    });

    broadcastGlobalStats();
  });

  socket.on('join_room', (roomName) => {
    if (!activeSockets[socket.id]) return;
    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(roomName);
    activeSockets[socket.id].room = roomName;
    broadcastRoomUsers(roomName);
  });

  socket.on('create_room', (roomName) => {
    if (!roomName || roomsList.has(roomName)) return;
    roomsList.add(roomName);
    io.emit('room_created', roomName);
  });

  socket.on('send_message', (data) => {
    chatHistory.push(data);
    saveHistory();
    io.to(data.room).emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    if (activeSockets[socket.id]) {
      const room = activeSockets[socket.id].room;
      delete activeSockets[socket.id];
      if (room) broadcastRoomUsers(room);
      broadcastGlobalStats();
    }
  });

  function broadcastRoomUsers(room) {
    const roomUsers = Object.values(activeSockets)
      .filter(u => u.room === room)
      .map(u => u.nickname);
    io.to(room).emit('update_users_list', roomUsers);
  }

  function broadcastGlobalStats() {
    io.emit('global_online_count', Object.keys(activeSockets).length);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
