const express = require("express");
const router = express.Router();

const { createBudget } = require("../controllers/budgetController");

router.post("/", createBudget);

module.exports = router;