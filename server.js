const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

// Папка для загрузки файлов
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Роут для загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('Файл не был загружен.');
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, name: req.file.originalname });
});

// База данных в памяти для никнеймов и комнат
const users = {};

io.on('connection', (socket) => {
  // Установка никнейма
  socket.on('set_nickname', (nickname, callback) => {
    const isTaken = Object.values(users).some(u => u.nickname.toLowerCase() === nickname.toLowerCase());
    if (isTaken) {
      return callback({ success: false, message: "Этот никнейм уже занят" });
    }
    users[socket.id] = { nickname, room: null };
    callback({ success: true });
  });

  // Вход в комнату
  socket.on('join_room', (room) => {
    if (!users[socket.id]) return;
    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(room);
    users[socket.id].room = room;
    broadcastRoomUsers(room);
  });

  // Отправка сообщений
  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  // Отключение
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
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
