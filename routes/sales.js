const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const User = require('../models/User');
const auth = require('../middleware/auth');
const sfService = require('../services/salesforceService');

// @route GET /api/sales
// @desc  Get all sales
router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate, status, page = 1, limit = 20 } = req.query;
    const query = { ownerId: req.user.ownerId };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (status) query.status = status;

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ sales, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/sales/:id
// @desc  Get single sale
router.get('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findOne({ _id: req.params.id, ownerId: req.user.ownerId })
      .populate('createdBy', 'name');

    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route POST /api/sales
// @desc  Create new sale (auto-deducts stock)
router.post('/', auth, async (req, res) => {
  try {
    const { customerName, items, discount, tax, paymentMethod, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Sale must have at least one item' });
    }

    // Validate stock and calculate totals
    const saleItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await Product.findOne({ _id: item.product, ownerId: req.user.ownerId });
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}`
        });
      }

      const itemSubtotal = product.price * item.quantity;
      subtotal += itemSubtotal;

      saleItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal: itemSubtotal
      });
    }

    const discountAmt = discount || 0;
    const taxAmt = tax || 0;
    const totalAmount = subtotal - discountAmt + taxAmt;

    const sale = new Sale({
      customerName: customerName || 'Walk-in Customer',
      items: saleItems,
      subtotal,
      discount: discountAmt,
      tax: taxAmt,
      totalAmount,
      paymentMethod: paymentMethod || 'cash',
      notes: notes || '',
      status: 'completed',
      createdBy: req.user.id,
      ownerId: req.user.ownerId
    });

    await sale.save();

    // Deduct stock after successful sale save
    for (const item of items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity }
      });
    }

    // Auto-sync to Salesforce if credentials configured (non-blocking)
    if (process.env.SF_CLIENT_ID && process.env.SF_USERNAME && process.env.SF_PASSWORD) {
      try {
        const owner = await User.findById(req.user.ownerId);
        const syncResult = await sfService.pushSaleToSalesforce(sale, owner?.storeName || 'Store');
        if (syncResult.success) {
          sale.sfSynced = true;
          sale.sfOpportunityId = syncResult.opportunityId;
          await sale.save();
          console.log(`✅ Auto-synced to Salesforce: ${sale.saleNumber}`);
        }
      } catch (sfErr) {
        // SF sync failure should NOT fail the sale
        console.error('⚠️ Salesforce auto-sync failed (sale saved locally):', sfErr.message);
      }
    }

    res.status(201).json(sale);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route PUT /api/sales/:id/cancel
// @desc  Cancel a sale (restores stock)
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Only owners can cancel sales' });
    }

    const sale = await Sale.findOne({ _id: req.params.id, ownerId: req.user.ownerId });
    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    if (sale.status === 'cancelled') {
      return res.status(400).json({ message: 'Sale already cancelled' });
    }

    // Restore stock
    for (const item of sale.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity }
      });
    }

    sale.status = 'cancelled';
    await sale.save();

    res.json({ message: 'Sale cancelled and stock restored', sale });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
