const express = require("express");
const router = express.Router();

const { createProfile } = require("../controllers/profileController");

router.post("/", createProfile);

module.exports = router;