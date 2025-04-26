const express = require("express");
const router = express.Router();
const { requireLogin } = require("../middleware/authMiddleware");

// Protected route — only accessible if user has a session
router.get("/home", requireLogin, (req, res) => {
  res.json({ message: `Hello, ${req.session.user.email}!` });
});

module.exports = router;
