const express = require("express");
const router = express.Router();

const {
  createProfile,
  getProfileByUserId,
} = require("../controllers/profileController");

router.post("/", createProfile);
router.get("/:userId", getProfileByUserId);

module.exports = router;