const mongoose = require('mongoose');

const SaleItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true
  },
  subtotal: {
    type: Number,
    required: true
  }
});

const SaleSchema = new mongoose.Schema({
  saleNumber: {
    type: String,
    unique: true
  },
  customerName: {
    type: String,
    trim: true,
    default: 'Walk-in Customer'
  },
  items: [SaleItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'other'],
    default: 'cash'
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'cancelled'],
    default: 'completed'
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sfSynced: {
    type: Boolean,
    default: false
  },
  sfOpportunityId: {
    type: String,
    default: null
  }
}, { timestamps: true });

// Auto-generate sale number before saving
SaleSchema.pre('save', async function (next) {
  if (!this.saleNumber) {
    const count = await mongoose.model('Sale').countDocuments({ ownerId: this.ownerId });
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.saleNumber = `SALE-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Sale', SaleSchema);
