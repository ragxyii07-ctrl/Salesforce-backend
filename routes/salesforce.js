// backend/routes/salesforce.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const sfService = require('../services/salesforceService');
const Sale = require('../models/Sale');
const User = require('../models/User');

// @route GET /api/salesforce/test
// @desc  Test Salesforce connection
router.get('/test', auth, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access only' });
  }

  const result = await sfService.testConnection();
  res.json(result);
});

// @route POST /api/salesforce/sync-sale/:saleId
// @desc  Manually sync one sale to Salesforce
router.post('/sync-sale/:saleId', auth, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access only' });
  }

  try {
    const sale = await Sale.findOne({ _id: req.params.saleId, ownerId: req.user.ownerId });
    if (!sale) return res.status(404).json({ message: 'Sale not found' });

    const owner = await User.findById(req.user.id);
    const result = await sfService.pushSaleToSalesforce(sale, owner.storeName);

    if (result.success) {
      // Mark sale as synced
      sale.sfSynced = true;
      sale.sfOpportunityId = result.opportunityId;
      await sale.save();
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Sync failed', error: err.message });
  }
});

// @route POST /api/salesforce/sync-all
// @desc  Sync all unsynced completed sales to Salesforce
router.post('/sync-all', auth, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access only' });
  }

  try {
    const owner = await User.findById(req.user.id);

    // Get all unsynced completed sales
    const unsyncedSales = await Sale.find({
      ownerId: req.user.ownerId,
      status: 'completed',
      sfSynced: { $ne: true }
    }).sort({ createdAt: 1 });

    if (unsyncedSales.length === 0) {
      return res.json({ message: 'All sales already synced!', synced: 0, failed: 0 });
    }

    let synced = 0;
    let failed = 0;
    const errors = [];

    for (const sale of unsyncedSales) {
      const result = await sfService.pushSaleToSalesforce(sale, owner.storeName);
      if (result.success) {
        sale.sfSynced = true;
        sale.sfOpportunityId = result.opportunityId;
        await sale.save();
        synced++;
      } else {
        failed++;
        errors.push({ sale: sale.saleNumber, error: result.error });
      }
    }

    res.json({
      message: `Sync complete: ${synced} synced, ${failed} failed`,
      synced,
      failed,
      errors
    });
  } catch (err) {
    res.status(500).json({ message: 'Sync failed', error: err.message });
  }
});

// @route GET /api/salesforce/status
// @desc  Get sync status summary
router.get('/status', auth, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access only' });
  }

  try {
    const total = await Sale.countDocuments({ ownerId: req.user.ownerId, status: 'completed' });
    const synced = await Sale.countDocuments({ ownerId: req.user.ownerId, status: 'completed', sfSynced: true });
    const unsynced = total - synced;

    const recentSynced = await Sale.find({
      ownerId: req.user.ownerId,
      sfSynced: true
    }).sort({ updatedAt: -1 }).limit(5).select('saleNumber totalAmount sfOpportunityId updatedAt');

    res.json({
      total,
      synced,
      unsynced,
      recentSynced,
      sfEnabled: !!(process.env.SF_CLIENT_ID && process.env.SF_USERNAME)
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
