const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");

// const helmet = require("helmet");

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const budgetRoutes = require("./routes/budgetRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const debugRoutes = require("./routes/debugRoutes");
const viewRoutes = require("./routes/viewRoutes");

dotenv.config();

connectDB();

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// app.use(helmet());

app.use(
session({
secret: process.env.JWT_SECRET,
resave: false,
saveUninitialized: false,
})
);

app.use("/", viewRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/debug", debugRoutes);

app.get("/", (req, res) => {
res.render("index");
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});
