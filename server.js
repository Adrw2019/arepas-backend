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

app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    if (!order || !order.id) {
      return res.status(400).json({ error: 'Invalid order data' });
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
