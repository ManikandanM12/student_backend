const { verifyToken } = require("../utils/jwt");

function authenticateJWT(req, res, next) {
  const token = req.session?.jwt;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized - No token" });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: "Unauthorized - Invalid token" });
  }

  req.user = decoded; // Add user info to request
  next();
}

module.exports = authenticateJWT;
