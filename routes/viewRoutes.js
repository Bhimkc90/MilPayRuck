const express = require("express");
const router = express.Router();

const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const Profile = require("../models/Profile");
const User = require("../models/User");

const {
  registerUser,
  loginUser,
} = require("../controllers/authController");

const {
  showCalculator,
  calculate,
  saveToBudget,
} = require("../controllers/payController");

const {
  getFinancialAdvice,
  askFinancialCoach,
} = require("../services/geminiService");

// Helper middleware
const requireLogin = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  next();
};

// Register Page
router.get("/register", (req, res) => {
  const userType = req.query.type || "military";

  res.render("auth/register", {
    userType,
  });
});

// Login Page
router.get("/login", (req, res) => {
  res.render("auth/login");
});

// Dashboard
router.get("/dashboard", requireLogin, async (req, res) => {
  const userId = req.session.userId;

  const user = await User.findById(userId).lean();

  if (!user) {
    return res.redirect("/login");
  }

  const budget = await Budget.findOne({ userId }).lean();
  const transactions = await Transaction.find({ userId }).lean();

  let monthlyIncome = 0;
  let budgetExpenses = 0;
  let transactionIncome = 0;
  let transactionExpenses = 0;

  if (budget) {
    monthlyIncome = Number(budget.monthlyNetIncome) || 0;

    if (budget.expenses) {
      for (let category in budget.expenses) {
        budgetExpenses += Number(budget.expenses[category]) || 0;
      }
    }
  }

  transactions.forEach((transaction) => {
    if (transaction.type === "income") {
      transactionIncome += Number(transaction.amount) || 0;
    }

    if (transaction.type === "expense") {
      transactionExpenses += Number(transaction.amount) || 0;
    }
  });

  const income = monthlyIncome + transactionIncome;
  const totalExpenses = budgetExpenses + transactionExpenses;
  const remainingCash = income - totalExpenses;

  const savings = budget?.expenses?.savings || 0;
  const investments = budget?.expenses?.investments || 0;

  const savingsRate =
    income > 0 ? ((savings + investments) / income) * 100 : 0;

  let aiAdvice = "AI financial advice is currently unavailable.";

  try {
    aiAdvice = await getFinancialAdvice({
      income,
      totalExpenses,
      remainingCash,
      savingsRate: savingsRate.toFixed(1),
    });
  } catch (error) {
    console.log("Gemini error:", error.message);
  }

  res.render("dashboard/dashboard", {
    user,
    income,
    totalExpenses,
    remainingCash,
    savingsRate: savingsRate.toFixed(1),
    aiAdvice,
  });
});

// Profile
router.get("/profile", requireLogin, async (req, res) => {
  const userId = req.session.userId;

  const user = await User.findById(userId).lean();
  const profile = await Profile.findOne({ userId }).lean();

  res.render("profile/profile", {
    user,
    profile,
  });
});

router.get("/edit-profile", requireLogin, async (req, res) => {
  const profile = await Profile.findOne({
    userId: req.session.userId,
  }).lean();

  res.render("profile/editProfile", {
    profile,
  });
});

router.post("/edit-profile", requireLogin, async (req, res) => {
  await Profile.findOneAndUpdate(
    { userId: req.session.userId },
    {
      userId: req.session.userId,
      userType: "military",
      rank: req.body.rank,
      timeInService: Number(req.body.timeInService),
      maritalStatus: req.body.maritalStatus,
      dependents: Number(req.body.dependents),
      dutyLocation: req.body.dutyLocation,
    },
    { upsert: true, new: true }
  );

  res.redirect("/profile");
});

// Budget
router.get("/budget", requireLogin, async (req, res) => {
  const userId = req.session.userId;

  const budget = await Budget.findOne({ userId }).lean();

  if (!budget) {
    return res.render("budget/budget", {
      income: 0,
      expenses: null,
    });
  }

  res.render("budget/budget", {
    income: budget.monthlyNetIncome,
    expenses: budget.expenses,
  });
});

router.get("/edit-budget", requireLogin, async (req, res) => {
  const budget = await Budget.findOne({
    userId: req.session.userId,
  }).lean();

  res.render("budget/editBudget", {
    budget,
  });
});

router.post("/edit-budget", requireLogin, async (req, res) => {
  await Budget.findOneAndUpdate(
    { userId: req.session.userId },
    {
      userId: req.session.userId,
      monthlyNetIncome: Number(req.body.monthlyNetIncome),
      expenses: {
        rentMortgage: Number(req.body.rentMortgage) || 0,
        utilities: Number(req.body.utilities) || 0,
        transportation: Number(req.body.transportation) || 0,
        groceries: Number(req.body.groceries) || 0,
        diningOut: Number(req.body.diningOut) || 0,
        insurance: Number(req.body.insurance) || 0,
        savings: Number(req.body.savings) || 0,
        investments: Number(req.body.investments) || 0,
        entertainment: Number(req.body.entertainment) || 0,
        miscellaneous: Number(req.body.miscellaneous) || 0,
      },
    },
    { upsert: true, new: true }
  );

  res.redirect("/budget");
});

// Transactions
router.get("/transactions", requireLogin, async (req, res) => {
  const transactions = await Transaction.find({
    userId: req.session.userId,
  }).sort({
    transactionDate: -1,
  });

  res.render("transactions/transactions", {
    transactions,
  });
});

router.get("/add-transaction", requireLogin, (req, res) => {
  res.render("transactions/addTransaction");
});

router.post("/add-transaction", requireLogin, async (req, res) => {
  await Transaction.create({
    userId: req.session.userId,
    category: req.body.category,
    amount: Number(req.body.amount),
    description: req.body.description,
    type: req.body.type,
  });

  res.redirect("/transactions");
});

router.get("/edit-transaction/:id", requireLogin, async (req, res) => {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.session.userId,
  }).lean();

  if (!transaction) {
    return res.redirect("/transactions");
  }

  res.render("transactions/editTransaction", {
    transaction,
  });
});

router.post("/edit-transaction/:id", requireLogin, async (req, res) => {
  await Transaction.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.session.userId,
    },
    {
      category: req.body.category,
      amount: Number(req.body.amount),
      description: req.body.description,
      type: req.body.type,
    }
  );

  res.redirect("/transactions");
});

router.post("/delete-transaction/:id", requireLogin, async (req, res) => {
  await Transaction.findOneAndDelete({
    _id: req.params.id,
    userId: req.session.userId,
  });

  res.redirect("/transactions");
});

// Pay Calculator
router.get("/pay-calculator", requireLogin, showCalculator);
router.post("/pay-calculator", requireLogin, calculate);
router.post("/pay-calculator/save-to-budget", requireLogin, saveToBudget);

// AI Coach Chatbot
router.get("/ai-coach", requireLogin, (req, res) => {
  if (!req.session.chatHistory) {
    req.session.chatHistory = [];
  }

  res.render("chat/coach", {
    chatHistory: req.session.chatHistory,
  });
});

router.post("/ai-coach", requireLogin, async (req, res) => {
  const question = req.body.question;

  if (!req.session.chatHistory) {
    req.session.chatHistory = [];
  }

  let answer = "AI Coach is currently unavailable.";

  try {
    answer = await askFinancialCoach(question);
  } catch (error) {
    console.log("AI Coach error:", error.message);
  }

  req.session.chatHistory.push({
    question,
    answer,
  });

  res.render("chat/coach", {
    chatHistory: req.session.chatHistory,
  });
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

router.post("/register", registerUser);
router.post("/login", loginUser);

module.exports = router;