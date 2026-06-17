const mongoose = require("mongoose");

const budgetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    monthlyNetIncome: {
      type: Number,
      required: true,
    },

    expenses: {
      rentMortgage: { type: Number, default: 0 },
      utilities: { type: Number, default: 0 },
      internet: { type: Number, default: 0 },
      phone: { type: Number, default: 0 },
      groceries: { type: Number, default: 0 },
      diningOut: { type: Number, default: 0 },
      transportation: { type: Number, default: 0 },
      autoPayment: { type: Number, default: 0 },
      autoInsurance: { type: Number, default: 0 },
      fuel: { type: Number, default: 0 },
      entertainment: { type: Number, default: 0 },
      debtPayments: { type: Number, default: 0 },
      savings: { type: Number, default: 0 },
      investments: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Budget", budgetSchema);