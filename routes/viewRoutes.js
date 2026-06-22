const express = require("express");
const router = express.Router();

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

router.get("/transactions", (req, res) => {
  res.render("transactions/transactions");
});

router.post("/register", registerUser);
router.post("/login", loginUser);

module.exports = router;