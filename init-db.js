const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Підключення до MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/postal_system', {
  serverSelectionTimeoutMS: 5000,
}).then(() => console.log('MongoDB підключено'))
  .catch(err => {
    console.error('Помилка підключення до MongoDB:', err.message);
    process.exit(1);
  });

// Схеми
const UserSchema = new mongoose.Schema({
  login: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Driver'], required: true },
});
const User = mongoose.model('User', UserSchema);

const VehicleSchema = new mongoose.Schema({
  licensePlate: { type: String, required: true, unique: true },
  type: { type: String, enum: ['Truck', 'Van', 'Car'], required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

// Функція ініціалізації
async function initDB() {
  try {
    await mongoose.connection.once('open', () => console.log('З\'єднання з MongoDB встановлено'));

    // Очищення колекцій
    await Promise.all([
      User.deleteMany({}),
      Cargo.deleteMany({}),
      Route.deleteMany({}),
      Report.deleteMany({}),
      Vehicle.deleteMany({}),
    ]);
    console.log('Колекції очищено');

    // Створення користувачів
    const users = [
      { login: 'admin1', password: await bcrypt.hash('admin123', 10), role: 'Admin' },
      { login: 'driver1', password: await bcrypt.hash('driver123', 10), role: 'Driver' },
      { login: 'driver2', password: await bcrypt.hash('driver123', 10), role: 'Driver' },
    ];
    const savedUsers = await User.insertMany(users);
    console.log('Користувачі створено:', savedUsers.map(u => ({ login: u.login, _id: u._id })));

    // Створення транспортних засобів
    const vehicles = [
      {
        licensePlate: "AB1234CD",
        type: "Truck",
        status: "Active",
        driverId: savedUsers[1]._id, // driver1
      },
      {
        licensePlate: "XY5678EF",
        type: "Van",
        status: "Active",
        driverId: savedUsers[1]._id, // driver1
      },
    ];
    const savedVehicles = await Vehicle.insertMany(vehicles);
    console.log('Транспортні засоби створено:', savedVehicles.map(v => ({ licensePlate: v.licensePlate, driverId: v.driverId })));

    // Створення вантажів
    const cargos = [
      { weight: 15, destination: 'Одеса', status: 'in_transit', priority: 'standard' },
      { weight: 25, destination: 'Львів', status: 'delivered', priority: 'urgent' },
      { weight: 10, destination: 'Харків', status: 'retry', priority: 'standard' },
      { weight: 20, destination: 'Дніпро', status: 'in_transit', priority: 'urgent' },
      { weight: 12, destination: 'Одеса', status: 'delivered', priority: 'standard' },
    ];
    const savedCargos = await Cargo.insertMany(cargos);
    console.log('Вантажі створено:', savedCargos.length);

    // Мок погоди та трафіку
    const weatherMock = { main: { temp: 15 }, weather: [{ description: 'ясно' }] };
    const trafficMock = { status: 'normal', details: 'Вільний рух' };

    // Створення маршрутів
    const routes = [
      {
        user_id: savedUsers[1]._id, // driver1
        vehicleId: savedVehicles[0]._id, // AB1234CD
        start_point: 'Київ',
        end_point: 'Одеса',
        coordinates: { start: [30.5234, 50.4501], end: [30.6231, 46.4825] },
        distance: 475,
        duration: '6 годин',
        weather_data: weatherMock,
        traffic_data: trafficMock,
        cargo_id: savedCargos[0]._id,
      },
      {
        user_id: savedUsers[1]._id, // driver1
        vehicleId: savedVehicles[1]._id, // XY5678EF
        start_point: 'Київ',
        end_point: 'Львів',
        coordinates: { start: [30.5234, 50.4501], end: [24.0297, 49.8397] },
        distance: 540,
        duration: '7 годин',
        weather_data: weatherMock,
        traffic_data: trafficMock,
        cargo_id: savedCargos[1]._id,
      },
      {
        user_id: savedUsers[2]._id, // driver2
        vehicleId: savedVehicles[0]._id, // AB1234CD (може бути інший транспорт для driver2)
        start_point: 'Київ',
        end_point: 'Харків',
        coordinates: { start: [30.5234, 50.4501], end: [36.2304, 49.9935] },
        distance: 480,
        duration: '6 годин 30 хвилин',
        weather_data: weatherMock,
        traffic_data: trafficMock,
        cargo_id: savedCargos[2]._id,
      },
      {
        user_id: savedUsers[2]._id, // driver2
        vehicleId: savedVehicles[1]._id, // XY5678EF (може бути інший транспорт для driver2)
        start_point: 'Київ',
        end_point: 'Дніпро',
        coordinates: { start: [30.5234, 50.4501], end: [35.0462, 48.4647] },
        distance: 450,
        duration: '5 годин 45 хвилин',
        weather_data: weatherMock,
        traffic_data: trafficMock,
        cargo_id: savedCargos[3]._id,
      },
      {
        user_id: savedUsers[1]._id, // driver1
        vehicleId: savedVehicles[0]._id, // AB1234CD
        start_point: 'Львів',
        end_point: 'Одеса',
        coordinates: { start: [24.0297, 49.8397], end: [30.6231, 46.4825] },
        distance: 620,
        duration: '8 годин',
        weather_data: weatherMock,
        traffic_data: trafficMock,
        cargo_id: savedCargos[4]._id,
      },
    ];
    const savedRoutes = await Route.insertMany(routes);
    console.log('Маршрути створено:', savedRoutes.length);

    // Оновлення вантажів із route_id
    for (let i = 0; i < savedCargos.length; i++) {
      await Cargo.findByIdAndUpdate(savedCargos[i]._id, { route_id: savedRoutes[i]._id });
    }
    console.log('Вантажі оновлено з route_id');

    // Створення звітів
    const reports = [
      { user_id: savedUsers[1]._id, fuel_used: 45, duration: '6 годин', delays: 5 },
      { user_id: savedUsers[1]._id, fuel_used: 50, duration: '7 годин', delays: 10 },
      { user_id: savedUsers[2]._id, fuel_used: 40, duration: '6 годин 30 хвилин', delays: 0 },
    ];
    const savedReports = await Report.insertMany(reports);
    console.log('Звіти створено:', savedReports.length);

    console.log('База даних ініціалізована успішно');
    await mongoose.connection.close();
  } catch (error) {
    console.error('Помилка ініціалізації:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

initDB();