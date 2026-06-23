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
  const userId = req.session.userId;

  const budget = await Budget.findOne({ userId }).lean();

  if (!budget) {
    return res.render("dashboard/dashboard", {
      income: 0,
      totalExpenses: 0,
      remainingCash: 0,
      savingsRate: "0.0",
    });
  }

  let totalExpenses = 0;

  for (let category in budget.expenses) {
    totalExpenses += budget.expenses[category];
  }

  const remainingCash = budget.monthlyNetIncome - totalExpenses;

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
  const userId = req.session.userId;

  const profile = await Profile.findOne({ userId }).lean();

  res.render("profile/profile", {
    profile,
  });
});




router.get("/budget", async (req, res) => {
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



router.get("/transactions", async (req, res) => {
  const userId = req.session.userId;

  const transactions = await Transaction.find({ userId }).sort({
    transactionDate: -1,
  });

  res.render("transactions/transactions", {
    transactions,
  });
});

router.get("/add-transaction", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  res.render("transactions/addTransaction");
});


router.post("/add-transaction", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  await Transaction.create({
    userId: req.session.userId,
    category: req.body.category,
    amount: req.body.amount,
    description: req.body.description,
    type: req.body.type,
  });

  res.redirect("/transactions");
});



router.post("/delete-transaction/:id", async (req, res) => {
  await Transaction.findByIdAndDelete(req.params.id);

  res.redirect("/transactions");
});


router.get("/edit-transaction/:id", async (req, res) => {
  const transaction = await Transaction.findById(
    req.params.id
  ).lean();

  res.render("transactions/editTransaction", {
    transaction,
  });
});


router.post("/edit-transaction/:id", async (req, res) => {
  await Transaction.findByIdAndUpdate(
    req.params.id,
    {
      category: req.body.category,
      amount: req.body.amount,
      description: req.body.description,
      type: req.body.type,
    }
  );

  res.redirect("/transactions");
});



router.get("/edit-profile", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const profile = await Profile.findOne({
    userId: req.session.userId,
  }).lean();

  res.render("profile/editProfile", {
    profile,
  });
});

router.post("/edit-profile", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  await Profile.findOneAndUpdate(
    { userId: req.session.userId },
    {
      userId: req.session.userId,
      userType: "military",
      rank: req.body.rank,
      timeInService: req.body.timeInService,
      zipCode: req.body.zipCode,
      dependents: req.body.dependents,
      dutyLocation: req.body.dutyLocation,
    },
    { upsert: true, new: true }
  );

  res.redirect("/profile");
});




router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});


router.post("/register", registerUser);
router.post("/login", loginUser);


module.exports = router;