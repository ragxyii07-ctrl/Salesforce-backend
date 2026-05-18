const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route POST /api/auth/register
// @desc  Register new owner
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, storeName } = req.body;

    if (!name || !email || !password || !storeName) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      storeName,
      role: 'owner'
    });

    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role, ownerId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeName: user.storeName
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route POST /api/auth/login
// @desc  Login user (owner or staff)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const ownerId = user.role === 'owner' ? user._id : user.ownerId;

    const token = jwt.sign(
      { id: user._id, role: user.role, ownerId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get store name
    let storeName = user.storeName;
    if (user.role === 'staff') {
      const owner = await User.findById(user.ownerId);
      storeName = owner ? owner.storeName : '';
    }

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeName
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route POST /api/auth/add-staff
// @desc  Owner adds staff member
router.post('/add-staff', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Only owners can add staff' });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const owner = await User.findById(req.user.id);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const staff = new User({
      name,
      email,
      password: hashedPassword,
      storeName: owner.storeName,
      role: 'staff',
      ownerId: req.user.id
    });

    await staff.save();

    res.status(201).json({
      message: 'Staff added successfully',
      staff: { id: staff._id, name: staff.name, email: staff.email, role: staff.role }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/auth/staff
// @desc  Get all staff for owner
router.get('/staff', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const staffList = await User.find({ ownerId: req.user.id, role: 'staff' })
      .select('-password');

    res.json(staffList);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route DELETE /api/auth/staff/:id
// @desc  Remove staff member
router.delete('/staff/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const staff = await User.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!staff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Staff member removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route GET /api/auth/me
// @desc  Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
