const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    userType: {
      type: String,
      enum: ["military", "non-military"],
      required: true,
    },

    // Military Fields
    rank: String,
    timeInService: Number,
    zipCode: String,
    dependents: Number,
    dutyLocation: String,

    // Civilian Fields
    companyName: String,
    jobTitle: String,
    salary: Number,
    payFrequency: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Profile", profileSchema);