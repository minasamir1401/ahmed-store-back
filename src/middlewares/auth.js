const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { asyncHandler } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured');
}

const publicUserSelect = { id: true, email: true, name: true, phone: true, role: true };

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: publicUserSelect });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: publicUserSelect });
    if (user) req.user = user;
  } catch (err) {}
  next();
});

const adminAuthenticate = asyncHandler(async (req, res, next) => {
  await authenticate(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'صلاحيات غير كافية - للمسؤولين فقط' });
    }
    next();
  });
});

module.exports = {
  authenticate,
  optionalAuthenticate,
  adminAuthenticate,
  JWT_SECRET,
  publicUserSelect
};
