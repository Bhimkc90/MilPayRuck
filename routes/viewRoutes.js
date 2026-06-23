const express = require("express");
const router = express.Router();
const Transaction = require("../models/Transaction");

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

router.get("/dashboard", (req, res) => {
  res.render("dashboard/dashboard");
});

router.get("/profile", (req, res) => {
  res.render("profile/profile");
});

router.get("/budget", (req, res) => {
  res.render("budget/budget");
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