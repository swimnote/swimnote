import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET ?? "local_dev_secret";
const SUPER_USER_ID = "user_super_1775303066795_yial5wvrm";

const payload = { userId: SUPER_USER_ID, role: "super_admin", poolId: null };
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
console.log(token);
