const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const Profile = require("../models/Profile");

const {
  registerUser,
  loginUser,
} = require("../controllers/authController");

router.get("/register", (req, res) => {
  const userType = req.query.type || "military";

  res.render("auth/register", {
    userType,
  });
});

router.get("/login", (req, res) => {
  res.render("auth/login");
});




router.get("/dashboard", async (req, res) => {
  const userId = "6a30f17842ab4a2c8fc3120b";

  const budget = await Budget.findOne({ userId }).lean();

  let totalExpenses = 0;

  for (let category in budget.expenses) {
    totalExpenses += budget.expenses[category];
  }

  const remainingCash =
    budget.monthlyNetIncome - totalExpenses;

  const savingsRate =
    ((budget.expenses.savings + budget.expenses.investments) /
      budget.monthlyNetIncome) *
    100;

  res.render("dashboard/dashboard", {
    income: budget.monthlyNetIncome,
    totalExpenses,
    remainingCash,
    savingsRate: savingsRate.toFixed(1),
  });
});



router.get("/profile", async (req, res) => {
  const userId = "6a30f17842ab4a2c8fc3120b";

  const profile = await Profile.findOne({ userId }).lean();

  res.render("profile/profile", {
    profile,
  });
});




router.get("/budget", async (req, res) => {
  const userId = "6a30f17842ab4a2c8fc3120b";

  const budget = await Budget.findOne({ userId }).lean();

  res.render("budget/budget", {
    income: budget.monthlyNetIncome,
    expenses: budget.expenses,
  });
});



router.get("/transactions", async (req, res) => {
  const userId = "6a30f17842ab4a2c8fc3120b";

  const transactions = await Transaction.find({ userId }).sort({
    transactionDate: -1,
  });

  res.render("transactions/transactions", {
    transactions,
  });
});

router.post("/register", registerUser);
router.post("/login", loginUser);

module.exports = router;