import { Router } from "express";
import { createStreamToken } from "../controllers/streamContollers";

const router = Router();

router.post("/token", createStreamToken);

export default router;
