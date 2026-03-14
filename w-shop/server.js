const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

// 数据文件路径
const DATA_DIR = './database';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const QRCODES_FILE = path.join(DATA_DIR, 'qrcodes.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 数据操作函数
function loadData(file, defaultData = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`加载${file}失败:`, e);
  }
  return defaultData;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// 初始化数据文件
if (!fs.existsSync(USERS_FILE)) saveData(USERS_FILE, []);
if (!fs.existsSync(PRODUCTS_FILE)) saveData(PRODUCTS_FILE, []);
if (!fs.existsSync(ORDERS_FILE)) saveData(ORDERS_FILE, []);
if (!fs.existsSync(QRCODES_FILE)) saveData(QRCODES_FILE, []);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ============ 用户系统 API ============

// 注册
app.post('/api/register', (req, res) => {
  const { phone, password, name } = req.body;
  
  if (!phone || !password) {
    return res.status(400).json({ error: '请填写手机号和密码' });
  }
  
  const users = loadData(USERS_FILE);
  
  if (users.find(u => u.phone === phone)) {
    return res.status(400).json({ error: '该手机号已注册' });
  }
  
  const newUser = {
    id: uuidv4(),
    phone,
    password,
    name: name || '',
    created_at: Date.now()
  };
  
  users.push(newUser);
  saveData(USERS_FILE, users);
  
  res.json({ success: true, user: { id: newUser.id, phone: newUser.phone, name: newUser.name } });
});

// 登录
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  
  if (!phone || !password) {
    return res.status(400).json({ error: '请填写手机号和密码' });
  }
  
  const users = loadData(USERS_FILE);
  const user = users.find(u => u.phone === phone && u.password === password);
  
  if (!user) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }
  
  res.json({ success: true, user: { id: user.id, phone: user.phone, name: user.name } });
});

// ============ 商品系统 API ============

// 获取商品列表
app.get('/api/products', (req, res) => {
  const products = loadData(PRODUCTS_FILE).filter(p => p.isActive !== false);
  res.json(products);
});

// 后台：添加商品
app.post('/api/admin/products', upload.single('image'), (req, res) => {
  const { name, price, description, stock } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: '请填写商品名称和价格' });
  }
  
  const products = loadData(PRODUCTS_FILE);
  const newProduct = {
    id: uuidv4(),
    name,
    price: parseFloat(price),
    description: description || '',
    stock: parseInt(stock) || 999,
    image: req.file ? req.file.filename : '',
    isActive: true,
    created_at: Date.now()
  };
  
  products.push(newProduct);
  saveData(PRODUCTS_FILE, products);
  
  res.json({ success: true, product: newProduct });
});

// 后台：删除商品
app.delete('/api/admin/products/:id', (req, res) => {
  let products = loadData(PRODUCTS_FILE);
  products = products.map(p => {
    if (p.id === req.params.id) p.isActive = false;
    return p;
  });
  saveData(PRODUCTS_FILE, products);
  res.json({ success: true });
});

// ============ 收款码系统 API ============

// 获取当前有效的收款码
app.get('/api/current-qrcode', (req, res) => {
  const qrcodes = loadData(QRCODES_FILE).filter(q => q.isActive !== false);
  const now = Date.now();
  
  // 找5分钟内上传的收款码
  const validQr = qrcodes.find(q => now - q.uploadTime < 5 * 60 * 1000);
  
  if (validQr) {
    res.json({ 
      success: true, 
      qrcode: validQr,
      expiresIn: 5 * 60 * 1000 - (now - validQr.uploadTime)
    });
  } else {
    res.json({ success: false, error: '暂无有效收款码，请联系商家' });
  }
});

// 上传收款码
app.post('/api/admin/qrcode', upload.single('qrcode'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传收款码图片' });
  }
  
  // 先停用所有旧的收款码
  let qrcodes = loadData(QRCODES_FILE);
  qrcodes = qrcodes.map(q => ({ ...q, isActive: false }));
  
  const newQr = {
    id: uuidv4(),
    filename: req.file.filename,
    uploadTime: Date.now(),
    isActive: true
  };
  
  qrcodes.push(newQr);
  saveData(QRCODES_FILE, qrcodes);
  
  res.json({ success: true, qrcode: newQr, expiresIn: 5 * 60 * 1000 });
});

// ============ 订单系统 API ============

// 创建订单
app.post('/api/orders', (req, res) => {
  const { userId, products, customer_name, customer_phone, customer_address } = req.body;
  
  if (!userId || !products || products.length === 0 || !customer_name || !customer_phone || !customer_address) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  
  // 检查收款码
  const qrcodes = loadData(QRCODES_FILE).filter(q => q.isActive !== false);
  const now = Date.now();
  const validQr = qrcodes.find(q => now - q.uploadTime < 5 * 60 * 1000);
  
  if (!validQr) {
    return res.status(500).json({ error: '暂无可用收款码，请稍后再试' });
  }
  
  const orderId = 'W' + Date.now().toString().slice(-10);
  const totalAmount = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  
  const orders = loadData(ORDERS_FILE);
  const newOrder = {
    id: orderId,
    userId,
    products,
    customer_name,
    customer_phone,
    customer_address,
    total_amount: totalAmount,
    status: 'pending', // pending, paid, shipped, delivered
    shipping_company: '',
    tracking_number: '',
    shipped_at: null,
    created_at: now,
    paid_at: null
  };
  
  orders.push(newOrder);
  saveData(ORDERS_FILE, orders);
  
  res.json({ 
    success: true, 
    order: newOrder,
    qrcode: validQr
  });
});

// 确认支付
app.post('/api/orders/:id/paid', (req, res) => {
  let orders = loadData(ORDERS_FILE);
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].status = 'paid';
  orders[orderIndex].paid_at = Date.now();
  saveData(ORDERS_FILE, orders);
  
  res.json({ success: true });
});

// 获取订单详情
app.get('/api/orders/:id', (req, res) => {
  const orders = loadData(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  res.json(order);
});

// 用户查询自己的订单
app.get('/api/user/orders', (req, res) => {
  const userId = req.query.userId;
  
  if (!userId) {
    return res.status(400).json({ error: '请先登录' });
  }
  
  const orders = loadData(ORDERS_FILE)
    .filter(o => o.userId === userId)
    .sort((a, b) => b.created_at - a.created_at);
  
  res.json(orders);
});

// ============ 后台管理 API ============

// 获取所有订单
app.get('/api/admin/orders', (req, res) => {
  const orders = loadData(ORDERS_FILE).sort((a, b) => b.created_at - a.created_at);
  res.json(orders);
});

// 发货
app.post('/api/admin/orders/:id/ship', (req, res) => {
  const { shipping_company, tracking_number } = req.body;
  
  if (!shipping_company || !tracking_number) {
    return res.status(400).json({ error: '请填写快递公司和单号' });
  }
  
  let orders = loadData(ORDERS_FILE);
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].status = 'shipped';
  orders[orderIndex].shipping_company = shipping_company;
  orders[orderIndex].tracking_number = tracking_number;
  orders[orderIndex].shipped_at = Date.now();
  saveData(ORDERS_FILE, orders);
  
  res.json({ success: true });
});

// 标记送达
app.post('/api/admin/orders/:id/delivered', (req, res) => {
  let orders = loadData(ORDERS_FILE);
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].status = 'delivered';
  saveData(ORDERS_FILE, orders);
  
  res.json({ success: true });
});

// 导出订单
app.get('/api/admin/orders/export', (req, res) => {
  const orders = loadData(ORDERS_FILE).sort((a, b) => b.created_at - a.created_at);
  
  let csv = '订单号，商品，姓名，手机，地址，金额，快递公司，单号，状态，时间\n';
  orders.forEach(o => {
    const productsStr = o.products.map(p => `${p.name}x${p.quantity}`).join(';');
    csv += `${o.id},"${productsStr}",${o.customer_name},${o.customer_phone},${o.customer_address},${o.total_amount},${o.shipping_company},${o.tracking_number},${o.status},${new Date(o.created_at).toLocaleString('zh-CN')}\n`;
  });
  
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=w-orders.csv');
  res.send('\ufeff' + csv);
});

// ============ 启动服务器 ============
app.listen(PORT, () => {
  console.log(`🔥 W的店铺 运行中 http://localhost:${PORT}`);
  console.log(`   首页：http://localhost:${PORT}/`);
  console.log(`   登录：http://localhost:${PORT}/login.html`);
  console.log(`   用户中心：http://localhost:${PORT}/user.html`);
  console.log(`   后台管理：http://localhost:${PORT}/admin/`);
});
