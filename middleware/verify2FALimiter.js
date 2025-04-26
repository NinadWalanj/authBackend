const { RateLimiterRedis } = require("rate-limiter-flexible");
const redisClient = require("../db/redis");

const twoFALimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "2fa_fail",
  points: 5, // Max 5 attempts
  duration: 600, // Per 10 minutes
});

const limit2FATries = async (req, res, next) => {
  const key = req.ip;

  twoFALimiter
    .consume(key)
    .then(() => {
      next(); // allowed
    })
    .catch(() => {
      res.status(429).json({
        message: "Too many requests. Please try again after 10 minutes.",
      });
    });
};

module.exports = { limit2FATries, twoFALimiter };
