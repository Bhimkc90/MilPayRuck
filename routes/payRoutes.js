const express = require("express");
const rateLimit = require("express-rate-limit");

const { estimateApi, dataStatusApi } = require("../controllers/payController");

const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

router.post("/estimate", limiter, estimateApi);
router.get("/data-status", limiter, dataStatusApi);

module.exports = router;
