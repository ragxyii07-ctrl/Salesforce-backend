const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

// @route GET /api/dashboard/stats
router.get('/stats', auth, async (req, res) => {
  try {
    // Fix: convert ownerId to ObjectId for aggregation
    const ownerId = new mongoose.Types.ObjectId(req.user.ownerId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const todaySales = await Sale.aggregate([
      { $match: { ownerId, status: 'completed', createdAt: { $gte: today, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
    ]);

    const monthlySales = await Sale.aggregate([
      { $match: { ownerId, status: 'completed', createdAt: { $gte: firstDayOfMonth, $lte: lastDayOfMonth } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
    ]);

    const totalSales = await Sale.aggregate([
      { $match: { ownerId, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
    ]);

    console.log('Total agg result:', totalSales);

    const totalProducts = await Product.countDocuments({ ownerId: req.user.ownerId });
    const lowStockProducts = await Product.countDocuments({ ownerId: req.user.ownerId, stock: { $lte: 5, $gt: 0 } });
    const outOfStockProducts = await Product.countDocuments({ ownerId: req.user.ownerId, stock: 0 });

    res.json({
      today: {
        revenue: todaySales[0]?.total || 0,
        orders: todaySales[0]?.count || 0
      },
      monthly: {
        revenue: monthlySales[0]?.total || 0,
        orders: monthlySales[0]?.count || 0
      },
      total: {
        revenue: totalSales[0]?.total || 0,
        orders: totalSales[0]?.count || 0
      },
      products: {
        total: totalProducts,
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts
      }
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/dashboard/monthly-chart
router.get('/monthly-chart', auth, async (req, res) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.user.ownerId);
    const months = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

      const result = await Sale.aggregate([
        { $match: { ownerId, status: 'completed', createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]);

      months.push({
        month: start.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue: result[0]?.total || 0,
        orders: result[0]?.count || 0
      });
    }

    res.json(months);
  } catch (err) {
    console.error('Monthly chart error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/dashboard/top-products
router.get('/top-products', auth, async (req, res) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.user.ownerId);

    const topProducts = await Sale.aggregate([
      { $match: { ownerId, status: 'completed' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productName',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.subtotal' }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 }
    ]);

    res.json(topProducts);
  } catch (err) {
    console.error('Top products error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/dashboard/low-stock
router.get('/low-stock', auth, async (req, res) => {
  try {
    const products = await Product.find({
      ownerId: req.user.ownerId,
      stock: { $lte: 10 }
    }).sort({ stock: 1 }).limit(10);

    res.json(products);
  } catch (err) {
    console.error('Low stock error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;