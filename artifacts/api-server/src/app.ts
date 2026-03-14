import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// 404 핸들러 — HTML 대신 JSON
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "요청한 경로를 찾을 수 없습니다.", error: "Not Found" });
});

// 전역 에러 핸들러 — 어떤 에러도 JSON으로 반환
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Global Error]", err);
  res.status(500).json({ success: false, message: err.message || "서버 오류가 발생했습니다.", error: err.message });
});

export default app;
