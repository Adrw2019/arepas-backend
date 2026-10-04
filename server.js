require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Set up MongoDB Database
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB database.'))
    .catch(err => console.error('Error connecting to MongoDB', err));
} else {
  console.log('WARNING: MONGODB_URI is not set. Please set it in .env file or environment variables.');
}

// Schemas
const OrderSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: Object, required: true }
});
const Order = mongoose.model('Order', OrderSchema);

const ProductSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: Object, required: true }
});
const Product = mongoose.model('Product', ProductSchema);

// ===== ORDERS API =====
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({});
    res.json(orders.map(o => o.data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function calculateHaversineKm(lat1, lng1, lat2, lng2) {
  const toRad = deg => deg * (Math.PI / 180);
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    if (!order || !order.id) {
      return res.status(400).json({ error: 'Invalid order data' });
    }

    // Validación de cobertura y tarifa para pedidos
    const isPickup = order.deliveryType === 'recogida';
    const loc = order.customer && order.customer.location;

    if (isPickup) {
      order.deliveryCost = 0;
      if (typeof order.subtotal === 'number') {
        const tip = typeof order.tip === 'number' ? order.tip : 0;
        order.total = order.subtotal + tip;
      }
    } else {
      // Domicilio: requiere coordenadas válidas
      if (!loc || loc.lat === null || loc.lat === undefined || loc.lng === null || loc.lng === undefined) {
        return res.status(400).json({
          error: 'El pedido a domicilio requiere una ubicación válida con coordenadas.',
          code: 'LOCATION_REQUIRED'
        });
      }

      const storeLat = 4.6269391;
      const storeLng = -74.1901396;
      const custLat = parseFloat(loc.lat);
      const custLng = parseFloat(loc.lng);

      if (!Number.isFinite(custLat) || !Number.isFinite(custLng) || (custLat === 0 && custLng === 0)) {
        return res.status(400).json({
          error: 'Coordenadas de entrega inválidas.',
          code: 'INVALID_COORDINATES'
        });
      }

      const dist = calculateHaversineKm(storeLat, storeLng, custLat, custLng);
      if (dist > 5.001) {
        return res.status(400).json({
          error: 'Esta dirección está fuera de nuestra zona de domicilios (máximo 5 km). Puedes elegir recoger en el local.',
          distanceKm: dist,
          maxDeliveryDistanceKm: 5
        });
      }

      // Revalidar tarifa según distancia en línea recta
      let expectedFee = 7000;
      if (dist <= 2.001) {
        expectedFee = 3000;
      } else if (dist <= 4.001) {
        expectedFee = 5000;
      } else {
        expectedFee = 7000;
      }

      order.deliveryCost = expectedFee;
      if (typeof order.subtotal === 'number') {
        const tip = typeof order.tip === 'number' ? order.tip : 0;
        order.total = order.subtotal + expectedFee + tip;
      }
    }

    await Order.findByIdAndUpdate(order.id, { _id: order.id, data: order }, { upsert: true });
    res.json({ success: true, id: order.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/bulk', async (req, res) => {
  try {
    const orders = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'Expected an array of orders' });
    }
    await Order.deleteMany({});
    const bulkOps = orders.map(order => ({
      insertOne: { document: { _id: order.id, data: order } }
    }));
    if (bulkOps.length > 0) {
      await Order.bulkWrite(bulkOps);
    }
    res.json({ success: true, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await Order.findByIdAndDelete(id);
    res.json({ success: true, deleted: !!result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PRODUCTS API =====
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(products.map(p => p.data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guardar o actualizar un solo producto (Idempotente)
app.post('/api/products', async (req, res) => {
  try {
    const product = req.body;
    if (!product || !product.id) {
      return res.status(400).json({ error: 'Datos de producto inválidos' });
    }
    await Product.findByIdAndUpdate(product.id, { _id: product.id, data: product }, { upsert: true });
    res.json({ success: true, id: product.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualización o inserción masiva sin borrar otros registros (Idempotente)
app.post('/api/products/upsert-bulk', async (req, res) => {
  try {
    const products = req.body;
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Se esperaba un arreglo de productos' });
    }
    const bulkOps = products.map(p => ({
      updateOne: {
        filter: { _id: p.id },
        update: { $set: { _id: p.id, data: p } },
        upsert: true
      }
    }));
    if (bulkOps.length > 0) {
      await Product.bulkWrite(bulkOps);
    }
    res.json({ success: true, count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reemplazo masivo del catálogo completo
app.post('/api/products/bulk', async (req, res) => {
  try {
    const products = req.body;
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Expected an array of products' });
    }
    await Product.deleteMany({});
    const bulkOps = products.map(p => ({
      insertOne: { document: { _id: p.id, data: p } }
    }));
    if (bulkOps.length > 0) {
      await Product.bulkWrite(bulkOps);
    }
    res.json({ success: true, count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Arepas Backend running on port ${PORT}`);
});
