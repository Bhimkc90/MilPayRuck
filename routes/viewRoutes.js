const express = require("express");
const router = express.Router();

const { registerUser } = require("../controllers/authController");

router.get("/register", (req, res) => {
  const userType = req.query.type || "military";

  res.render("auth/register", {
    userType,
  });
});

router.post("/register", registerUser);

module.exports = router;