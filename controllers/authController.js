const jwt = require("jsonwebtoken");
const { sendMagicLink } = require("../utils/sendEmail");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/postgres"); // Your PostgreSQL connection
const redisClient = require("../db/redis");
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY;
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const { twoFALimiter } = require("../middleware/verify2FALimiter");

/**
 * @desc Register a new user
 * @route POST /api/auth/register
 */
exports.registerUser = async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email)
    return res.status(400).json({ error: "Name and email required" });

  try {
    const userExists = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (userExists.rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const setupToken = jwt.sign({ name, email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRY,
    });

    res.status(201).json({
      message: "Token sent",
      setupToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
};

/**
 * @desc 2FA Setup, sends the setup page to the frontend
 * @route GET /api/auth/setup-2fa?token=""
 */
exports.setup2FA = async (req, res) => {
  const token = req.query.token || req.headers["x-setup-token"];
  if (!token) return res.status(400).json({ message: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({ name: `Authera (${email})` });

    // Generate QR code from secret
    const qrImage = await qrcode.toDataURL(secret.otpauth_url);

    // Send QR and secret (secret used temporarily by frontend to confirm TOTP)
    res.status(200).json({
      qr: qrImage,
      base32: secret.base32,
      email,
    });
  } catch (err) {
    console.error("Failed to setup 2FA:", err);
    let message = "Session expired. Refresh the page.";

    res.status(401).json({ message: message });
  }
};

/**
 * @desc 2FA Setup, receives the 6-digit code and validates
 * and redirects to the /login page.
 *
 * @route POST /api/auth/confirm-2fa-setup
 */

exports.confirm2FASetup = async (req, res) => {
  const { token, code, base32 } = req.body;
  if (!token || !code || !base32) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, email } = decoded;

    const isValid = speakeasy.totp.verify({
      secret: base32,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!isValid) {
      return res.status(401).json({ message: "Invalid 2FA code" });
    }

    // ✅ Insert new user into DB after successful 2FA setup
    await pool.query(
      "INSERT INTO users (name, email, twofa_secret) VALUES ($1, $2, $3)",
      [name, email, base32]
    );
    //Rate limit will reset properly after successful 2FA
    await twoFALimiter.delete(req.ip);

    res.status(200).json({
      message: "2FA setup complete. Kindly log in.",
    });
  } catch (err) {
    console.error("Error during 2FA confirmation:", err);
    res.status(401).json({ message: "Session expired. Refresh the page." });
  }
};

/**
 * @desc Send login link to email
 * @route POST /api/auth/login
 */
exports.handleMagicLinkRequest = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (user.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No account found with that email." });
    }

    const token = jwt.sign({ email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRY,
      jwtid: uuidv4(),
    });

    const magicLink = `${process.env.BACKEND_URL}/api/auth/verifyLink?token=${token}`;
    await sendMagicLink(email, magicLink);

    return res
      .status(200)
      .json({ message: "Login link sent! Check your inbox." });
  } catch (err) {
    console.error("Error sending login link:", err);
    return res
      .status(500)
      .json({ message: "Failed to send login link. Please try again later." });
  }
};

/**
 * @desc Verify token from magic link and create session
 * @route GET /api/auth/verifyLink
 */
exports.verifyMagicLink = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Token is missing");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;

    // Generate short-lived 2FA token
    const twoFAToken = jwt.sign({ email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRY,
    });

    // Redirect to frontend with 2fa token
    res.redirect(`${process.env.CLIENT_URL}/2fa?token=${twoFAToken}`);
  } catch (err) {
    console.error("Invalid or expired login link:", err);
    res.status(401).send("Invalid or expired login link");
  }
};

/**
 * @desc Verify token and code and create session if valid
 * @route POST /api/auth/verify2FA
 */
exports.verifyTwoFA = async (req, res) => {
  const { token, code } = req.body;
  if (!token || !code) {
    return res.status(400).json({ message: "Missing token or 2FA code" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;

    // Fetch the 2FA secret from DB
    const userResult = await pool.query(
      "SELECT twofa_secret FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const base32secret = userResult.rows[0].twofa_secret;
    const isVerified = speakeasy.totp.verify({
      secret: base32secret,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!isVerified) {
      return res.status(401).json({ message: "Invalid 2FA code" });
    }

    // Destroy any old session stored for this user
    const existingSessionId = await redisClient.get(`user_session:${email}`);
    if (existingSessionId) {
      await redisClient.del(`session:${existingSessionId}`);
    }

    // Regenerate the session to get a fresh session ID & cookie
    req.session.regenerate(async (err) => {
      if (err) {
        console.error("Session regeneration error:", err);
        return res
          .status(500)
          .json({ message: "Failed to regenerate session" });
      }

      // Now store the authenticated user
      req.session.user = { email };

      // Clear rate-limiter for 2FA
      await twoFALimiter.delete(req.ip);

      // Persist the new session ID in Redis so we can enforce "one session per user"
      await redisClient.set(`user_session:${email}`, req.sessionID);

      // Express-session will automatically emit Set-Cookie here
      res.status(200).json({
        message: "2FA verified successfully",
        redirectTo: "/dashboard",
      });
    });
  } catch (err) {
    console.error("2FA verification failed:", err);
    res.status(401).json({
      message: "Invalid or expired token. Refresh the page.",
    });
  }
};

/**
 * @desc Validates token when the user refershes the website,
 * if present and valid nothing happens, if present and expired,
 * then redirected to /login
 * @route POST /api/auth/validate-2fa-token
 */

exports.validateTwoFAToken = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message: "Token missing" });

  try {
    jwt.verify(token, JWT_SECRET);
    return res.status(200).json({ valid: true });
  } catch (err) {
    return res.status(401).json({ message: "Token expired or invalid" });
  }
};

/**
 * @desc Logout user
 * @route POST /api/auth/logout
 */
exports.logoutUser = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }

    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Logged out successfully" });
  });
};
