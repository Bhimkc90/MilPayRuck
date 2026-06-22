const Transaction = require("../models/Transaction");

const createTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.create(req.body);

    res.status(201).json({
      message: "Transaction created successfully",
      transaction,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getTransactionsByUserId = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      userId: req.params.userId,
    }).sort({ transactionDate: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createTransaction,
  getTransactionsByUserId,
};
