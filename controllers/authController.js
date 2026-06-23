const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  try {
    const {
      userType,
      firstName,
      lastName,
      email,
      password,
    } = req.body;
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecialCharacter = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        const hasMinimumLength = password.length >= 10;

        if (!emailPattern.test(email)) {
          return res.status(400).json({
            message: "Please enter a valid email address.",
          });
        }

        if (
          !hasMinimumLength ||
          !hasUppercase ||
          !hasLowercase ||
          !hasNumber ||
          !hasSpecialCharacter
        ) {
          return res.status(400).json({
            message:
              "Password must be at least 10 characters long and include uppercase, lowercase, number, and special character.",
          });
        }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      userType,
      firstName,
      lastName,
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      message: "User registered successfully",
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    req.session.userId = user._id;

    res.redirect("/dashboard");
    

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
};