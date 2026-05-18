const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const auth = require('../middleware/auth');

// @route GET /api/products
// @desc  Get all products for owner's store
router.get('/', auth, async (req, res) => {
  try {
    const products = await Product.find({ ownerId: req.user.ownerId }).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route POST /api/products
// @desc  Add new product (owner only)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Only owners can add products' });
    }

    const { name, category, price, stock, description } = req.body;

    if (!name || !category || price === undefined || stock === undefined) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const product = new Product({
      name,
      category,
      price,
      stock,
      description,
      ownerId: req.user.ownerId
    });

    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route PUT /api/products/:id
// @desc  Update product (owner only)
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Only owners can update products' });
    }

    const product = await Product.findOne({ _id: req.params.id, ownerId: req.user.ownerId });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const { name, category, price, stock, description } = req.body;
    product.name = name || product.name;
    product.category = category || product.category;
    product.price = price !== undefined ? price : product.price;
    product.stock = stock !== undefined ? stock : product.stock;
    product.description = description !== undefined ? description : product.description;

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// @route DELETE /api/products/:id
// @desc  Delete product (owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Only owners can delete products' });
    }

    const product = await Product.findOne({ _id: req.params.id, ownerId: req.user.ownerId });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
