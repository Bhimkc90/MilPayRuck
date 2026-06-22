const express = require("express");
const router = express.Router();

router.get("/register", (req, res) => {
  const userType = req.query.type || "military";

  res.render("auth/register", {
    userType,
  });
});

module.exports = router;

