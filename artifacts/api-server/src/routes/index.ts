import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth.js";
import poolsRouter from "./pools.js";
import adminRouter from "./admin.js";
import studentsRouter from "./students.js";
import classGroupsRouter from "./class-groups.js";
import attendanceRouter from "./attendance.js";
import noticesRouter from "./notices.js";
import parentRouter from "./parent.js";
import uploadsRouter from "./uploads.js";
import photosRouter from "./photos.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/pools", poolsRouter);
router.use("/admin", adminRouter);
router.use("/students", studentsRouter);
router.use("/class-groups", classGroupsRouter);
router.use("/attendance", attendanceRouter);
router.use("/notices", noticesRouter);
router.use("/parent", parentRouter);
router.use("/uploads", uploadsRouter);
router.use("/", photosRouter);

export default router;
