const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*' }));

// --- НАСТРОЙКА ХРАНИЛИЩА ФАЙЛОВ ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use('/uploads', express.static(uploadDir));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Файл не загружен' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, name: req.file.originalname });
});

// --- БАЗА ДАННЫХ И ПОЛЬЗОВАТЕЛИ ---
const accounts = {}; // { nickname: password }
const activeSockets = {}; // { socketId: { nickname, room } }
const roomsList = new Set(['Общий чат']);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {

  // Проверка существования никнейма и запрос пароля / авторизации
  socket.on('auth_user', ({ nickname, password }, callback) => {
    const cleanNick = nickname.trim().toLowerCase();

    // Проверка на повторный вход с другого устройства
    const isAlreadyOnline = Object.values(activeSockets).some(
      u => u.nickname.toLowerCase() === cleanNick
    );

    if (isAlreadyOnline) {
      return callback({ success: false, message: 'Этот аккаунт уже находится в сети на другом устройстве!' });
    }

    if (accounts[cleanNick]) {
      // Пользователь существует -> проверяем пароль
      if (accounts[cleanNick] === password) {
        activeSockets[socket.id] = { nickname, room: null };
        callback({ success: true, action: 'login', rooms: Array.from(roomsList) });
        broadcastGlobalStats();
      } else {
        callback({ success: false, message: 'Неверный пароль!' });
      }
    } else {
      // Новый аккаунт -> регистрируем
      if (!password || password.length < 4) {
        return callback({ success: false, message: 'Пароль должен содержать минимум 4 символа!' });
      }
      accounts[cleanNick] = password;
      activeSockets[socket.id] = { nickname, room: null };
      callback({ success: true, action: 'registered', rooms: Array.from(roomsList) });
      broadcastGlobalStats();
    }
  });

  // Вход в комнату
  socket.on('join_room', (roomName) => {
    if (!activeSockets[socket.id]) return;

    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(roomName);
    activeSockets[socket.id].room = roomName;

    broadcastRoomUsers(roomName);
  });

  // Создание новой комнаты (синхронизируется со всеми)
  socket.on('create_room', (roomName) => {
    if (!roomName || roomsList.has(roomName)) return;
    roomsList.add(roomName);
    io.emit('room_created', roomName); // Рассылаем абсолютно всем
  });

  // Отправка сообщений
  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  // Отключение
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
    const totalOnline = Object.keys(activeSockets).length;
    io.emit('global_online_count', totalOnline);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
