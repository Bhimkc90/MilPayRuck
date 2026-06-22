const express = require("express");
const router = express.Router();

const {
  createTransaction,
  getTransactionsByUserId,
} = require("../controllers/transactionController");

router.post("/", createTransaction);
router.get("/:userId", getTransactionsByUserId);

module.exports = router;
