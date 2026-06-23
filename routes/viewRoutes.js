const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const Profile = require("../models/Profile");

const {
  registerUser,
  loginUser,
} = require("../controllers/authController");



//Register Page
router.get("/register", (req, res) => {
  const userType = req.query.type || "military";

  res.render("auth/register", {
    userType,
  });
});


//login Page
router.get("/login", (req, res) => {
  res.render("auth/login");
});



// Dashboard
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



//Profile
router.get("/profile", async (req, res) => {
  const userId = req.session.userId;

  const profile = await Profile.findOne({ userId }).lean();

  res.render("profile/profile", {
    profile,
  });
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




//Budget
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


router.post("/edit-budget", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  await Budget.findOneAndUpdate(
    { userId: req.session.userId },
    {
      userId: req.session.userId,
      monthlyNetIncome: req.body.monthlyNetIncome,
      expenses: {
        rentMortgage: req.body.rentMortgage || 0,
        utilities: req.body.utilities || 0,
        groceries: req.body.groceries || 0,
        autoPayment: req.body.autoPayment || 0,
        savings: req.body.savings || 0,
        investments: req.body.investments || 0,
      },
    },
    { upsert: true, new: true }
  );

  res.redirect("/budget");
});


router.get("/edit-budget", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const budget = await Budget.findOne({
    userId: req.session.userId,
  }).lean();

  res.render("budget/editBudget", {
    budget,
  });
});



//Transactions
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





//Pay Calculator

router.get("/pay-calculator", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const profile = await Profile.findOne({
    userId: req.session.userId,
  }).lean();

  res.render("pay/calculator", {
    profile,
  });
});

router.post("/pay-calculator", async (req, res) => {
  const rank = req.body.rank;
  const timeInService = Number(req.body.timeInService);
  const zipCode = req.body.zipCode;
  const dependents = req.body.dependents;

  let basePay = 0;

  if (rank === "E6" && timeInService >= 10) {
    basePay = 4858;
  } else if (rank === "E5" && timeInService >= 8) {
    basePay = 3950;
  } else {
    basePay = 3000;
  }

  const bas = 465;

  let bah = 0;

  if (zipCode === "11368" && dependents === "yes") {
    bah = 5097;
  } else if (zipCode === "11368" && dependents === "no") {
    bah = 4300;
  } else {
    bah = 2500;
  }

  const grossMonthlyPay = basePay + bas + bah;
  
  if (req.session.userId) {
    await Budget.findOneAndUpdate(
      { userId: req.session.userId },
      {
        userId: req.session.userId,
        monthlyNetIncome: grossMonthlyPay,
      },
      { upsert: true, new: true }
    );
  }

  res.render("pay/calculator", {
    profile: null,
    result: {
      rank,
      timeInService,
      zipCode,
      dependents,
      basePay,
      bas,
      bah,
      grossMonthlyPay,
    },
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