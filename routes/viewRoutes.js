const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const Profile = require("../models/Profile");

const {
  registerUser,
  loginUser,
} = require("../controllers/authController");

const { getBahRate } = require("../services/bahService");


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
  const dependents = req.body.dependents;

  const basePayTable = {
    E1: 2017,
    E2: 2261,
    E3: 2378,
    E4: 2633,
    E5: 3226,
    E6: 4858,
    E7: 5625,
    E8: 6323,
    E9: 7470,

    W1: 3739,
    W2: 4260,
    W3: 4826,
    W4: 5320,
    W5: 7489,

    O1: 3826,
    O2: 4419,
    O3: 5113,
    O4: 5810,
    O5: 6754,
    O6: 8104,
    O7: 10638,
    O8: 12803,
    O9: 18131,
    O10: 18131,
  };

  const bahWithDependents = {
    E1: 3780,
    E2: 3780,
    E3: 3780,
    E4: 3780,
    E5: 4200,
    E6: 5097,
    E7: 5300,
    E8: 5600,
    E9: 5900,

    W1: 5100,
    W2: 5200,
    W3: 5350,
    W4: 5500,
    W5: 5700,

    O1: 4300,
    O2: 4700,
    O3: 5400,
    O4: 5700,
    O5: 6000,
    O6: 6200,
    O7: 6400,
    O8: 6500,
    O9: 6600,
    O10: 6700,
  };

  const bahWithoutDependents = {
    E1: 3300,
    E2: 3300,
    E3: 3300,
    E4: 3300,
    E5: 3900,
    E6: 5070,
    E7: 5000,
    E8: 5300,
    E9: 5600,

    W1: 4800,
    W2: 4900,
    W3: 5050,
    W4: 5200,
    W5: 5400,

    O1: 4000,
    O2: 4400,
    O3: 5100,
    O4: 5400,
    O5: 5700,
    O6: 5900,
    O7: 6100,
    O8: 6200,
    O9: 6300,
    O10: 6400,
  };

  const basePay = basePayTable[rank] || 0;
  const bas = 476;

  const bah =
    dependents === "yes"
      ? bahWithDependents[rank]
      : bahWithoutDependents[rank];

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