const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    category: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    transactionDate: {
      type: Date,
      default: Date.now,
    },

    type: {
      type: String,
      enum: ["expense", "income"],
      default: "expense",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Transaction", transactionSchema);
