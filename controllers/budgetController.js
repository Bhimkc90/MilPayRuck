const Budget = require("../models/Budget");

const createBudget = async (req, res) => {
  try {
    const budget = await Budget.create(req.body);

    res.status(201).json({
      message: "Budget created successfully",
      budget,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createBudget,
};