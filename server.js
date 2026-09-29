const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*' }));

// Настройка загрузки файлов
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

app.get('/', (req, res) => res.send('Telefaper Chat Server Active!'));

// --- РАБОТА С ИСТОРИЕЙ ЧАТА (history_chat.json) ---
const HISTORY_FILE = path.join(__dirname, 'history_chat.json');
let chatHistory = [];

// Загрузка истории при запуске сервера
if (fs.existsSync(HISTORY_FILE)) {
  try {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    console.error('Ошибка чтения history_chat.json:', e);
    chatHistory = [];
  }
}

// Функция сохранения истории
function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2), 'utf8');
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
  
  // При подключении сразу отправляем клиенту всю историю из history_chat.json
  socket.emit('load_history', chatHistory);

  // Получение нового сообщения
  socket.on('send_message', (data) => {
    // Сохраняем имя телефапера, текст/файл и время
    chatHistory.push(data);
    saveHistory();

    // Отправляем сообщение всем подключенным пользователям
    io.emit('receive_message', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
