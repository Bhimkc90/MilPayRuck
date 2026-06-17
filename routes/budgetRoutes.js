const express = require("express");
const router = express.Router();

const {
  createBudget,
  getBudgetByUserId,
} = require("../controllers/budgetController");

router.post("/", createBudget);
router.get("/:userId", getBudgetByUserId);

module.exports = router;