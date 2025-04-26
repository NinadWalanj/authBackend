const express = require("express");
const router = express.Router();
const {
  handleMagicLinkRequest,
  registerUser,
  logoutUser,
  verifyMagicLink,
  verifyTwoFA,
  validateTwoFAToken,
  setup2FA,
  confirm2FASetup,
} = require("../controllers/authController");
const rateLimiterMiddleware = require("../middleware/rateLimiter");
const { limit2FATries } = require("../middleware/verify2FALimiter");

//Register process
router.post("/register", rateLimiterMiddleware, registerUser);
router.get("/setup-2fa", setup2FA);
router.post("/confirm-2fa-setup", limit2FATries, confirm2FASetup);

//Login process
router.post("/login", rateLimiterMiddleware, handleMagicLinkRequest);
router.get("/verifyLink", verifyMagicLink);
router.post("/verify2FA", limit2FATries, verifyTwoFA);
router.post("/validate-2fa-token", validateTwoFAToken);

//Logout process
router.post("/logout", logoutUser);

module.exports = router;
