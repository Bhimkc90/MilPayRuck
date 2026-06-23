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
      default: "military",
    },

    rank: {
      type: String,
      required: true,
    },

    timeInService: {
      type: Number,
      required: true,
    },

    maritalStatus: {
      type: String,
      default: "Single",
    },

    dependents: {
      type: Number,
      default: 0,
    },

    dutyLocation: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Profile", profileSchema);