import express from "express";
import newsRoutes from "./news.js";
import taxiRoutes from "./taxi.js";

const router = express.Router();

// Об'єднуємо всі маршрути під одним дахом
router.use("/news", newsRoutes);
router.use("/taxi", taxiRoutes);

export default router;