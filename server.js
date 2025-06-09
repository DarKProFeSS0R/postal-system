const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const cors = require('cors');
const app = express();
require('dotenv').config();

const allowedOrigins = ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://192.168.0.103:8080', 'http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

mongoose.connect('mongodb://127.0.0.1:27017/postal_system', {
  serverSelectionTimeoutMS: 5000,
}).then(() => console.log('MongoDB підключено'))
  .catch(err => console.error('Помилка MongoDB:', err));

const UserSchema = new mongoose.Schema({
  login: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Driver'], required: true },
});
const User = mongoose.model('User', UserSchema);

const VehicleSchema = new mongoose.Schema({
  licensePlate: { type: String, unique: true, required: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

const RouteSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  start_point: { type: String, required: true },
  end_point: { type: String, required: true },
  coordinates: {
    start: { type: [Number], index: '2dsphere' },
    end: { type: [Number], index: '2dsphere' },
  },
  distance: Number,
  duration: String,
  weather_data: Object,
  traffic_data: Object,
  cargo_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cargo' },
}, { timestamps: true });
const Route = mongoose.model('Route', RouteSchema);

const CargoSchema = new mongoose.Schema({
  route_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  weight: { type: Number, min: 0, max: 30, required: true },
  destination: { type: String, required: true },
  status: { type: String, enum: ['in_transit', 'delivered', 'retry'], default: 'in_transit' },
  priority: { type: String, enum: ['standard', 'urgent'], default: 'standard' },
}, { timestamps: true });
const Cargo = mongoose.model('Cargo', CargoSchema);

const ReportSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fuel_used: { type: Number, min: 0 },
  duration: String,
  delays: { type: Number, min: 0 },
  created_at: { type: Date, default: Date.now },
});
const Report = mongoose.model('Report', ReportSchema);

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Токен відсутній' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    req.user = decoded;
    console.log('Авторизований користувач:', decoded.id);
    next();
  } catch (error) {
    res.status(401).json({ message: 'Недійсний токен' });
  }
};

app.get('/api/config', (req, res) => {
  res.json({
    googleApiKey: process.env.GOOGLE_API_KEY || 'default_key',
    fontAwesomeKey: process.env.FONTAWESOME_KEY || '',
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { login, password, role } = req.body;
  try {
    if (!['Admin', 'Driver'].includes(role)) return res.status(400).json({ message: 'Недійсна роль' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ login, password: hashedPassword, role });
    await user.save();
    res.status(201).json({ message: 'Користувач створений' });
  } catch (error) {
    res.status(400).json({ message: 'Помилка реєстрації', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const user = await User.findOne({ login });
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ message: 'Недійсні логін або пароль' });
    const token = jwt.sign({ id: user._id, login: user.login, role: user.role }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '24h' });
    res.json({ token, role: user.role });
  } catch (error) {
    res.status(500).json({ message: 'Помилка сервера', error: error.message });
  }
});

app.get('/api/vehicles', authMiddleware, async (req, res) => {
  try {
    console.log('Запит транспортів для користувача:', req.user.id);
    const vehicles = await Vehicle.find({ driverId: req.user.id, status: 'Active' });
    console.log('Знайдено транспортів:', vehicles.length);
    res.json(vehicles);
  } catch (error) {
    console.error('Помилка отримання транспортів:', error.message);
    res.status(400).json({ message: 'Помилка отримання транспортних засобів', error: error.message });
  }
});

app.get('/api/routes', authMiddleware, async (req, res) => {
  const { vehicleId } = req.query;
  try {
    console.log('Запит маршрутів для vehicleId:', vehicleId);
    let query = { user_id: req.user.id };
    if (vehicleId) query.vehicleId = vehicleId;
    const routes = await Route.find(query).populate('cargo_id');
    console.log('Знайдено маршрутів:', routes.length);
    res.json(routes);
  } catch (error) {
    console.error('Помилка отримання маршрутів:', error.message);
    res.status(400).json({ message: 'Помилка отримання маршрутів', error: error.message });
  }
});

app.post('/api/routes', authMiddleware, async (req, res) => {
  const { start_point, end_point, cargo_id, vehicleId, start_coordinates, end_coordinates } = req.body;
  try {
    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) return res.status(404).json({ message: 'Транспорт не знайдено' });
    const cargo = await Cargo.findById(cargo_id);
    if (!cargo) return res.status(404).json({ message: 'Вантаж не знайдено' });
    const distance = 500;
    const duration = '6 годин';
    let weatherResponse;
    try {
      weatherResponse = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(start_point)}&appid=${process.env.OPENWEATHERMAP_API_TOKEN}&units=metric&lang=uk`
      );
    } catch (apiError) {
      console.warn('Помилка API OpenWeatherMap, використовується мок:', apiError.message);
      weatherResponse = { data: { main: { temp: 15 }, weather: [{ description: 'ясно' }] } };
    }
    const route = new Route({
      user_id: req.user.id,
      vehicleId,
      start_point,
      end_point,
      coordinates: { start: start_coordinates || [30.5234, 50.4501], end: end_coordinates || [30.6231, 46.4825] },
      distance,
      duration,
      weather_data: weatherResponse.data,
      traffic_data: { status: 'normal', data: {} },
      cargo_id,
    });
    await route.save();
    res.status(201).json(route);
  } catch (error) {
    res.status(400).json({ message: 'Помилка створення маршруту', error: error.message });
  }
});

app.patch('/api/cargos/:id', authMiddleware, async (req, res) => {
  const { status } = req.body;
  try {
    const cargo = await Cargo.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!cargo) return res.status(404).json({ message: 'Вантаж не знайдено' });
    res.json({ message: 'Статус оновлено', cargo });
  } catch (error) {
    res.status(400).json({ message: 'Помилка оновлення статусу', error: error.message });
  }
});

app.post('/api/cargos', authMiddleware, async (req, res) => {
  const { route_id, weight, destination, priority } = req.body;
  try {
    const route = await Route.findById(route_id);
    if (!route) return res.status(404).json({ message: 'Маршрут не знайдено' });
    const cargo = new Cargo({ route_id, weight, destination, priority });
    await cargo.save();
    res.status(201).json(cargo);
  } catch (error) {
    res.status(400).json({ message: 'Помилка створення вантажу', error: error.message });
  }
});

app.post('/api/reports', authMiddleware, async (req, res) => {
  const { fuel_used, duration, delays } = req.body;
  try {
    const report = new Report({ user_id: req.user.id, fuel_used, duration, delays });
    await report.save();
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ message: 'Помилка створення звіту', error: error.message });
  }
});

app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const reports = await Report.find({ user_id: req.user.id });
    res.json(reports);
  } catch (error) {
    res.status(400).json({ message: 'Помилка отримання звітів', error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Сервер запущено на порту ${PORT}`));