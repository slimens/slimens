const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Разрешаем запросы со всех источников (CORS)
app.use(cors({ origin: '*' }));

// --- НАСТРОЙКА ХРАНИЛИЩА ФАЙЛОВ ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Сохраняем расширение файла и делаем имя уникальным
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Лимит размера файла: 50 МБ
});

// Отдаём файлы из папки uploads по прямой ссылке: /uploads/имя_файла
app.use('/uploads', express.static(uploadDir));

// Эндпоинт загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Файл не был загружен' });
  }

  // Формируем прямую URL-ссылку на файл
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  
  res.json({
    success: true,
    url: fileUrl,
    name: req.file.originalname,
    size: req.file.size
  });
});


// --- НАСТРОЙКА SOCKET.IO (ЧАТ И НИКНЕЙМЫ) ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Хранилище пользователей в памяти: { socketId: { nickname, room } }
const users = {};

io.on('connection', (socket) => {

  // Регистрация никнейма
  socket.on('set_nickname', (nickname, callback) => {
    const isTaken = Object.values(users).some(
      u => u.nickname.toLowerCase() === nickname.toLowerCase()
    );

    if (isTaken) {
      return callback({ success: false, message: 'Этот никнейм уже занят!' });
    }

    users[socket.id] = { nickname, room: null };
    callback({ success: true });
  });

  // Вход в комнату (чат)
  socket.on('join_room', (room) => {
    if (!users[socket.id]) return;

    // Покидаем старые комнаты
    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });

    socket.join(room);
    users[socket.id].room = room;

    // Обновляем список пользователей онлайн в этой комнате
    broadcastRoomUsers(room);
  });

  // Отправка сообщений (текст или файл)
  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const room = users[socket.id].room;
      delete users[socket.id];
      if (room) broadcastRoomUsers(room);
    }
  });

  function broadcastRoomUsers(room) {
    const roomUsers = Object.values(users)
      .filter(u => u.room === room)
      .map(u => u.nickname);

    io.to(room).emit('update_users_list', roomUsers);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Единый сервер запущен на порту ${PORT}`));
