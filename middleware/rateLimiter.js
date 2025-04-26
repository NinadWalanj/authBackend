const { RateLimiterRedis } = require("rate-limiter-flexible");
const redisClient = require("../db/redis");

const limiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "rl",
  points: 4, // max 4 attempts
  duration: 600, // per 600 seconds = 10 minutes
});

const rateLimiterMiddleware = (req, res, next) => {
  const key = req.ip; // or you could also use req.body.email for user-based limit

  limiter
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

module.exports = rateLimiterMiddleware;
