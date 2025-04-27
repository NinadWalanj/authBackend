const dotenv = require("dotenv");
dotenv.config(); // Load first!

const express = require("express");
const session = require("express-session");
const { RedisStore } = require("connect-redis");
const redisClient = require("./db/redis");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

const store = new RedisStore({
  client: redisClient,
  prefix: "session:",
});

app.use(
  session({
    store: store,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 5, //5min
      httpOnly: true,
      sameSite: "None", // "None" in production
      secure: true, // true in production, false in development
    },
  })
);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Health check or root endpoint
app.get("/", (req, res) => {
  res.send("OneLoginLink Backend is running");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on Port:${PORT}`);
});
