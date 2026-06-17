const Profile = require("../models/Profile");

const createProfile = async (req, res) => {
  try {
    const profile = await Profile.create(req.body);

    res.status(201).json({
      message: "Profile created successfully",
      profile,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getProfileByUserId = async (req, res) => {
  try {
    const profile = await Profile.findOne({
      userId: req.params.userId,
    });

    if (!profile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    res.json(profile);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createProfile,
  getProfileByUserId,
};