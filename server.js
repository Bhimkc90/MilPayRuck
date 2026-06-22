const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const budgetRoutes = require("./routes/budgetRoutes");
const transactionRoutes = require("./routes/transactionRoutes");

dotenv.config();


connectDB();

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));

app.use(express.json());
app.use(cors());
app.use(helmet());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/transactions", transactionRoutes);

app.get("/", (req, res) => {
  res.render("index");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
